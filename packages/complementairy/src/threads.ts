import crypto from "node:crypto";
import { codeOnly, type Comment, type Parsed } from "./comments.js";
import { nombrados } from "./parser.js";

/**
 * Un hilo es una conversación dentro del código: empieza en un `@ia?` y sigue con los
 * comentarios pegados a él (`@guia`, `@yo:`, más `@ia?`). Todo se deduce del archivo:
 * no hay estado oculto que pueda desincronizarse.
 */
export interface Turn {
  quien: "humano" | "ia";
  texto: string;
  /** Mensaje `@yo:`: el humano muestra un intento o explica lo que hizo. */
  intento?: boolean;
}

export interface Thread {
  /** "t3" si la IA ya respondió alguna vez; null si es nuevo. */
  id: string | null;
  comments: Comment[];
  turns: Turn[];
  /** Turnos de la IA ya escritos (cada `@guia[t3.N]` distinto). */
  aiTurns: number;
  /** El humano habló último: hay que responder. */
  pending: boolean;
  /** Primer comentario (el `@ia?` que abre el hilo); sirve de ancla. */
  anchor: Comment;
  /** Último comentario: la respuesta se inserta debajo. */
  last: Comment;
  lastHuman: Comment | null;
}

const GUIA_ID = /^@guia\[([\w-]+)\.(\d+)\]/;

export function guiaId(c: Comment): { thread: string; turn: number } | null {
  const m = GUIA_ID.exec(c.content);
  return m ? { thread: m[1]!, turn: Number(m[2]) } : null;
}

function humanText(c: Comment): string {
  return c.content.replace(/^@ia\?\s*/, "").replace(/^@yo:\s*/, "").trim();
}

function guiaText(c: Comment): string {
  return c.content.replace(/^@guia\[[^\]]*\]\s*/, "").trim();
}

export function findThreads(src: string, comments: Comment[]): Thread[] {
  const cs = [...comments].sort((a, b) => a.start - b.start);
  const threads: Thread[] = [];
  let cur: Thread | null = null;
  let prev: Comment | null = null;
  let inHuman = false; // dentro de un mensaje humano de varias líneas
  for (const c of cs) {
    // Pegado = solo espacios y como mucho un salto de línea (una línea en blanco separa hilos).
    const gap = prev !== null ? src.slice(prev.end, c.start) : "x";
    const adjacent = prev !== null && gap.trim() === "" && (gap.match(/\n/g)?.length ?? 0) <= 1;
    const gid = c.kind === "guia" ? guiaId(c) : null;
    // Un @guia de otro hilo (revisión r*, predicción p*, ADR a*...) no se suma: corta el hilo.
    const own = gid !== null && (cur?.id ? gid.thread === cur.id : gid.thread.startsWith("t"));
    if (cur && adjacent && c.kind === "guia" && own) {
      cur.id ??= gid!.thread;
      cur.comments.push(c);
      inHuman = false;
    } else if (cur && adjacent && (c.kind === "yo" || c.kind === "ia")) {
      cur.comments.push(c);
      inHuman = true;
    } else if (cur && adjacent && c.kind === "otro" && inHuman) {
      cur.comments.push(c); // continuación de un mensaje humano en varias líneas
    } else if (c.kind === "ia") {
      cur = { id: null, comments: [c], turns: [], aiTurns: 0, pending: false, anchor: c, last: c, lastHuman: null };
      threads.push(cur);
      inHuman = true;
    } else {
      cur = null;
      inHuman = false;
    }
    prev = c;
  }

  for (const t of threads) {
    const seen = new Set<number>();
    let lastTurnId: string | null = null;
    for (const c of t.comments) {
      if (c.kind === "guia") {
        const gid = guiaId(c);
        if (gid) {
          t.id ??= gid.thread;
          seen.add(gid.turn);
        }
        const key = gid ? `${gid.thread}.${gid.turn}` : "?";
        const lastTurn = t.turns[t.turns.length - 1];
        if (lastTurn?.quien === "ia" && key === lastTurnId) lastTurn.texto += "\n" + guiaText(c);
        else t.turns.push({ quien: "ia", texto: guiaText(c) });
        lastTurnId = key;
      } else {
        const lastTurn = t.turns[t.turns.length - 1];
        if (c.kind === "otro" && lastTurn?.quien === "humano") lastTurn.texto += " " + c.content;
        else t.turns.push({ quien: "humano", texto: humanText(c), intento: c.kind === "yo" });
        t.lastHuman = c;
        lastTurnId = null;
      }
    }
    t.aiTurns = seen.size ? Math.max(...seen) : 0; // el turno más alto (aunque se hayan borrado anteriores)
    t.last = t.comments[t.comments.length - 1]!;
    t.pending = t.turns[t.turns.length - 1]?.quien === "humano";
  }
  return threads;
}

/** Siguiente id libre en el archivo: t1, t2, ... (o r1, r2... para revisiones). */
export function nextThreadId(comments: Comment[], taken: Set<string>, prefix = "t"): string {
  const used = new Set(taken);
  for (const c of comments) {
    const g = guiaId(c);
    if (g) used.add(g.thread);
  }
  let n = 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

const REGION_TYPES = /function|method|class|declaration|definition|impl|struct|module|block_mapping_pair|instruction/;

/**
 * Región de código que rodea al hilo (función, método, clase...). Su hash sin comentarios
 * permite saber, de forma determinista, si el humano cambió el código desde la última respuesta.
 */
export function regionOf(src: string, parsed: Parsed, offset: number): { start: number; end: number; text: string; hash: string } {
  let start = -1;
  let end = -1;
  if (parsed.root) {
    let n = parsed.root.descendantForIndex(offset) ?? parsed.root;
    // Un comentario suelto entre sentencias: subimos hasta un nodo que lo contenga con código.
    while (n.parent && !REGION_TYPES.test(n.type)) n = n.parent;
    if (n.parent) {
      start = n.startIndex;
      end = n.endIndex;
    }
  }
  if (start < 0) {
    // Sin gramática o a nivel raíz: todo el archivo (insertar comentarios no cambia su código).
    const all = codeOnly(src, parsed.comments);
    return { start: 0, end: src.length, text: src, hash: crypto.createHash("sha1").update(all).digest("hex").slice(0, 12) };
  }
  const text = src.slice(start, end);
  const inside = parsed.comments.filter((c) => c.start >= start && c.end <= end).map((c) => ({ ...c, start: c.start - start, end: c.end - start }));
  const hash = crypto.createHash("sha1").update(codeOnly(text, inside)).digest("hex").slice(0, 12);
  return { start, end, text, hash };
}

export interface RegionTop {
  /** Identificador estable: la primera línea (firma) de la parte. */
  key: string;
  hash: string;
  /** Líneas 1-based, inclusivas. */
  desde: number;
  hasta: number;
  text: string;
}

/**
 * Partes de primer nivel del archivo (funciones, clases, declaraciones) con la huella de su
 * código sin comentarios. Sirve para mandarle a la IA solo lo que cambió.
 */
export function regionesTop(src: string, parsed: Parsed): RegionTop[] {
  const mk = (start: number, end: number, row0: number, row1: number): RegionTop => {
    const text = src.slice(start, end);
    const inside = parsed.comments.filter((c) => c.start >= start && c.end <= end).map((c) => ({ ...c, start: c.start - start, end: c.end - start }));
    const firstLine = text.split("\n").find((l) => l.trim() && !/^\s*(\/\/|#|--|\/\*|\*|<!--)/.test(l)) ?? text.split("\n")[0]!;
    return { key: firstLine.trim().slice(0, 120), hash: crypto.createHash("sha1").update(codeOnly(text, inside)).digest("hex").slice(0, 12), desde: row0 + 1, hasta: row1 + 1, text };
  };
  if (!parsed.root) return src.trim() ? [mk(0, src.length, 0, src.split("\n").length - 1)] : [];
  const out: RegionTop[] = [];
  for (const n of nombrados(parsed.root)) {
    if (n.type.includes("comment")) continue;
    out.push(mk(n.startIndex, n.endIndex, n.startPosition.row, n.endPosition.row));
  }
  // Claves repetidas (p. ej. dos `const x = ...` iguales): se desambiguan por orden.
  const seen = new Map<string, number>();
  for (const r of out) {
    const k = seen.get(r.key) ?? 0;
    seen.set(r.key, k + 1);
    if (k) r.key = `${r.key} #${k + 1}`;
  }
  return out;
}
