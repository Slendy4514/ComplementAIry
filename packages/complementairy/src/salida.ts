import fs from "node:fs";
import path from "node:path";
import { parse } from "./comments.js";
import { loadConfig } from "./config.js";
import { langFor } from "./lang.js";
import { cargarNotas, guardarNotas, mensaje, nuevaNota, type Nota, type Snippet } from "./notas.js";
import { eolOf, insertAboveLine, renderReply, separarListas } from "./render.js";
import { nextThreadId } from "./threads.js";

/**
 * Salida única: todo lo que dice la IA pasa por acá. Según `vista`:
 * - "notas": se guarda como nota (el archivo NO se toca; adiós choques con el autoguardado).
 * - "comentarios": comentarios @guia encima de la línea; o, con `ediciones`, se devuelven las
 *   inserciones para que la extensión las aplique sobre el editor (no en disco).
 */

export interface Aporte {
  ancla: { linea: number; texto?: string; funcion?: string };
  tipo: string;
  texto: string;
  links?: string[];
  titulo?: string;
  accion?: string;
  bloqueante?: boolean;
  snippets?: Snippet[];
  origen: string;
  /** Responde dentro de una nota existente. */
  notaId?: string;
  fuente?: string;
  alcance?: "archivo";
}

export interface Edicion {
  /** Insertar ANTES de esta línea (1-based), solo si su texto sigue siendo `texto`. */
  linea: number;
  texto: string;
  lineas: string[];
}

export interface ResultadoSalida {
  notas: string[];
  insertados: number;
  ediciones: Edicion[];
}

const ETIQUETA: Record<string, string> = {
  pista: "💡 Pista",
  pieza: "🧩 Piezas",
  plano: "🗺️ Plano",
  pregunta: "❓ Pregunta",
  revision: "🔎 Revisión",
  ejemplo: "🔁 Ejemplo",
  snippet: "🧩 Snippet",
  nota: "📝 Nota",
  prediccion: "🎯 Predicción",
  tests: "🧪 Tests",
};

/** Mensaje en markdown para una nota: título, "Qué hacer", texto con listas en líneas, docs. */
export function markdown(a: Pick<Aporte, "tipo" | "texto" | "links" | "accion" | "snippets">): string {
  const partes = [`**${ETIQUETA[a.tipo] ?? a.tipo}** · ${separarListas(a.texto).replace(/\n/g, "  \n")}`];
  if (a.snippets?.length) partes.push(`Snippets sugeridos (botón **Insertar aquí**): ${a.snippets.map((s) => `\`${s.llamada}\``).join(", ")}`);
  if (a.links?.length) partes.push(a.links.map((l) => `📖 [${l.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60)}](${l})`).join("  \n"));
  return partes.join("\n\n");
}

export async function publicar(root: string, rel: string, aportes: Aporte[], o: { vista?: "notas" | "comentarios"; ediciones?: boolean } = {}): Promise<ResultadoSalida> {
  const res: ResultadoSalida = { notas: [], insertados: 0, ediciones: [] };
  if (!aportes.length) return res;
  const vista = o.vista ?? loadConfig(root).vista;
  const abs = path.join(root, rel);
  const src = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
  const lineas = src.split(/\r?\n/);

  if (vista === "notas") {
    const notas = cargarNotas(root, rel, src);
    for (const a of aportes) {
      const texto = (a.ancla.texto ?? lineas[a.ancla.linea - 1] ?? "").trim();
      const existente = a.notaId ? notas.find((n) => n.id === a.notaId) : undefined;
      if (existente) {
        existente.hilo.push(mensaje("ia", markdown(a)));
        existente.snippets.push(...(a.snippets ?? []));
        if (a.accion) existente.accion = a.accion;
        existente.estado = "abierta";
        existente.actualizada = new Date().toISOString();
        res.notas.push(existente.id);
        continue;
      }
      // Sin duplicados: el mismo texto en la misma línea no se vuelve a agregar.
      if (notas.some((n) => n.estado === "abierta" && n.ancla.texto === texto && n.hilo.some((m) => m.texto === markdown(a)))) continue;
      const n: Nota = nuevaNota(notas, {
        archivo: rel,
        ancla: { linea: a.ancla.linea, texto, ...(a.ancla.funcion ? { funcion: a.ancla.funcion } : {}) },
        tipo: a.tipo,
        titulo: (a.titulo ?? a.texto.split(/[.:\n]/)[0] ?? a.tipo).slice(0, 80),
        accion: a.accion ?? "",
        bloqueante: !!a.bloqueante,
        snippets: a.snippets ?? [],
        origen: a.origen,
        ...(a.fuente ? { fuente: a.fuente } : {}),
        ...(a.alcance ? { alcance: a.alcance } : {}),
        hilo: [mensaje("ia", markdown(a))],
      });
      res.notas.push(n.id);
    }
    guardarNotas(root, rel, notas);
    return res;
  }

  // Comentarios en el archivo.
  const lang = langFor(rel);
  if (!lang) return res;
  const parsed = await parse(src, lang);
  const id = nextThreadId(parsed.comments, new Set(), "c");
  let k = 0;
  const bloques = aportes.map((a) => {
    const texto = (a.ancla.texto ?? lineas[a.ancla.linea - 1] ?? "").trim();
    const conAccion = a.accion ? `${a.texto} Qué hacer: ${a.accion}` : a.texto;
    const snip = (a.snippets ?? []).map((s) => renderReply(lang, "", `${id}.${k + 1}`, { tipo: "snippet", texto: s.llamada, breve: true })).flat();
    return { a, texto, lineas: [...renderReply(lang, "", `${id}.${++k}`, { tipo: a.tipo, texto: conAccion, links: a.links ?? [] }), ...snip] };
  });
  if (o.ediciones) {
    for (const b of bloques) res.ediciones.push({ linea: b.a.ancla.linea, texto: b.texto, lineas: b.lineas });
    return res;
  }
  let actual = src;
  for (const b of [...bloques].sort((x, y) => y.a.ancla.linea - x.a.ancla.linea)) {
    const ls = actual.split(eolOf(actual) === "\r\n" ? "\r\n" : "\n");
    const line = b.texto && ls[b.a.ancla.linea - 1]?.trim() !== b.texto ? ls.findIndex((l) => l.trim() === b.texto) + 1 : b.a.ancla.linea;
    const next = line > 0 ? await insertAboveLine(actual, lang, line, b.lineas) : null;
    if (next) {
      actual = next;
      res.insertados++;
    }
  }
  if (actual !== src) fs.writeFileSync(abs, actual);
  return res;
}
