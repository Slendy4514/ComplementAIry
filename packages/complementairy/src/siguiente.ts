import fs from "node:fs";
import path from "node:path";
import { parse } from "./comments.js";
import { dataDir, makeZoner } from "./config.js";
import { listFiles } from "./files.js";
import { langFor } from "./lang.js";
import { medir } from "./metricas.js";
import { todasLasNotas } from "./notas.js";
import { leerMemoria } from "./panorama.js";
import { escribirJson, leerJson } from "./almacen.js";
import { conCandadoSync } from "./ocupado.js";

/**
 * "▶ Siguiente paso": una sola cosa que hacer ahora, elegida SIN IA con un orden fijo:
 *   1. lo que espera tu respuesta (predicciones, preguntas de la memoria)
 *   2. verificaciones que fallan (tipos, lint, tests, reglas)
 *   3. tareas del plano sin hacer
 *   4. notas bloqueantes
 *   5. el resto de las notas abiertas
 */

export interface Diagnostico {
  archivo: string;
  linea: number;
  msg: string;
}

export interface Tarea {
  id: string;
  titulo: string;
  archivo?: string;
  /** Si se indica, la tarea se marca hecha sola cuando la función aparece en el archivo. */
  funcion?: string;
  /** Si es true, se marca hecha sola cuando el archivo existe (archivos que propone la estructura). */
  crear?: boolean;
  /** Por qué y cómo (en palabras), para el tooltip del panel. */
  detalle?: string;
  hecha: boolean;
  /** Cuándo se marcó hecha (las hechas hace más de un día se archivan). */
  hechaEn?: string;
  /** Archivada (hecha hace rato o descartada): no aparece en el panel ni en "siguiente". */
  archivada?: boolean;
  descartada?: boolean;
  origen: "plano" | "estructura" | "panorama" | "manual";
  creada: string;
}

export interface Paso {
  prioridad: number;
  tipo: "responder" | "arreglar" | "tarea" | "bloqueante" | "nota";
  titulo: string;
  accion: string;
  archivo?: string;
  linea?: number;
  ref?: string;
}

const diagFile = (root: string) => path.join(dataDir(root), "cache", "diagnosticos.json");
export const tareasFile = (root: string) => path.join(dataDir(root), "tareas.json");

export function guardarDiagnosticos(root: string, rel: string, diags: Diagnostico[]): void {
  let todo: Record<string, { fecha: string; diags: Diagnostico[] }> = {};
  try {
    todo = JSON.parse(fs.readFileSync(diagFile(root), "utf8")) as typeof todo;
  } catch {
    /* primera vez */
  }
  if (diags.length) todo[rel] = { fecha: new Date().toISOString(), diags };
  else delete todo[rel];
  fs.mkdirSync(path.dirname(diagFile(root)), { recursive: true });
  fs.writeFileSync(diagFile(root), JSON.stringify(todo, null, 2));
}

/**
 * Rutas de verdad a partir de lo que escribió la IA: "src/a.js (y src/b.ts)", "a.js, b.js" o
 * "`a.js` y `b.js`" → ["src/a.js", "src/b.ts"]. Lo que no parece una ruta con extensión se descarta.
 */
export function rutasDe(texto: string): string[] {
  const partes = texto
    .replace(/[`"'*]/g, " ")
    .split(/\s*(?:,|;|\(|\)|\s+y\s+|\s+and\s+|\s+o\s+|\s+or\s+|\s+)\s*/i)
    .map((x) => x.trim().replace(/^\.\//, "").replace(/[.:]+$/, ""))
    .filter((x) => !x.startsWith("/") && !x.split("/").includes(".."))
    .filter((x) => {
      const base = x.split("/").pop()!;
      // Con extensión, un archivo conocido sin extensión (Dockerfile, Makefile…) o un dotfile (.env, .gitignore).
      return /^[\w@.\-/]+$/.test(x) && (/\.[A-Za-z0-9]{1,8}$/.test(base) || /^(Dockerfile|Makefile|Procfile|Gemfile|Rakefile|Jenkinsfile|Vagrantfile|LICENSE|README)$/.test(base) || /^\.[\w.-]+$/.test(base));
    });
  return [...new Set(partes)];
}

export function cargarTareas(root: string): Tarea[] {
  return leerJson<{ tareas?: Tarea[] }>(tareasFile(root), () => ({})).tareas ?? [];
}

export function guardarTareas(root: string, tareas: Tarea[]): void {
  escribirJson(tareasFile(root), { version: 1, tareas });
}

export function agregarTareas(root: string, nuevas: Omit<Tarea, "id" | "hecha" | "creada">[]): number {
  return conCandadoSync(tareasFile(root), () => {
    const tareas = cargarTareas(root);
    let n = 0;
    for (const t of nuevas) {
      if (tareas.some((x) => x.titulo === t.titulo && x.archivo === t.archivo)) continue;
      const max = Math.max(0, ...tareas.map((x) => Number(/^t(\d+)$/.exec(x.id)?.[1] ?? 0)));
      tareas.push({ ...t, id: `t${max + 1}`, hecha: false, creada: new Date().toISOString() });
      n++;
    }
    guardarTareas(root, tareas);
    return n;
  });
}

/** Un cambio de tareas (lo propone el chat o Claude Code; se aplica solo con tu clic o tu respuesta). */
export interface CambioTarea {
  accion: "crear" | "editar" | "hecha" | "reabrir" | "descartar";
  id?: string;
  titulo?: string;
  archivo?: string;
  detalle?: string;
}

/** Aplica un cambio de tareas y dice qué pasó (con un error explicativo si no se puede). */
export function aplicarCambioTarea(root: string, c: CambioTarea): string {
  return conCandadoSync(tareasFile(root), () => {
    if (c.accion === "crear") {
      if (!c.titulo?.trim()) throw new Error("para crear una tarea hace falta un título");
      const n = agregarTareas(root, [{ titulo: c.titulo.trim(), ...(c.archivo ? { archivo: c.archivo } : {}), ...(c.detalle ? { detalle: c.detalle } : {}), origen: "manual" }]);
      return n ? `tarea agregada: ${c.titulo.trim()}` : `ya existía: ${c.titulo.trim()}`;
    }
    const tareas = cargarTareas(root);
    const t = tareas.find((x) => x.id === c.id);
    if (!t) throw new Error(`no existe la tarea ${c.id ?? "(sin id)"} (míralas con: cai tareas)`);
    if (c.accion === "editar") {
      if (c.titulo?.trim()) t.titulo = c.titulo.trim();
      if (c.detalle !== undefined) t.detalle = c.detalle;
      if (c.archivo !== undefined) t.archivo = c.archivo || undefined;
    } else if (c.accion === "descartar") Object.assign(t, { archivada: true, descartada: true }); // no vuelve a proponerse
    else Object.assign(t, { hecha: c.accion === "hecha", archivada: false, descartada: false, ...(c.accion === "hecha" ? { hechaEn: new Date().toISOString() } : { hechaEn: undefined }) });
    guardarTareas(root, tareas);
    return `${t.id}: ${{ editar: "editada", descartar: "descartada", hecha: "hecha", reabrir: "pendiente otra vez" }[c.accion]} (${t.titulo})`;
  });
}

/** Marca hechas, sin IA, las tareas cuya función ya existe en su archivo. */
export async function actualizarTareas(root: string): Promise<Tarea[]> {
  const tareas = cargarTareas(root);
  const antes = new Map(tareas.map((t) => [t.id, JSON.stringify(t)]));
  let cambio = false;
  const ahora = new Date().toISOString();
  // Tareas viejas con varias rutas en una ("a.js (y b.ts)"): se separan; sin ruta válida, se archivan.
  for (const t of [...tareas].filter((x) => x.crear && x.archivo && !x.hecha && !x.archivada)) {
    const rutas = rutasDe(t.archivo!);
    if (rutas.length === 1 && rutas[0] === t.archivo) continue;
    cambio = true;
    if (!rutas.length) {
      t.archivada = true;
      continue;
    }
    // Si solo había que ordenar la ruta ("./a.js"), el título y la descripción se conservan.
    if (rutas.length > 1 || !t.titulo.includes(rutas[0]!)) t.titulo = `Crear ${rutas[0]}`;
    t.archivo = rutas[0]!;
    for (const r of rutas.slice(1)) {
      if (tareas.some((x) => x.archivo === r && x.crear)) continue;
      const max = Math.max(0, ...tareas.map((x) => Number(/^t(\d+)$/.exec(x.id)?.[1] ?? 0)));
      tareas.push({ ...t, id: `t${max + 1}`, archivo: r, titulo: `Crear ${r}` });
    }
  }
  let todos: string[] | null = null;
  for (const t of tareas.filter((x) => !x.hecha && !x.archivada && x.crear && x.archivo)) {
    if (fs.existsSync(path.join(root, t.archivo!))) {
      Object.assign(t, { hecha: true, hechaEn: ahora });
      cambio = true;
      continue;
    }
    // ¿Lo creaste con el mismo nombre en otra carpeta? También cuenta (y se dice dónde).
    todos ??= listFiles(makeZoner(root));
    // Solo si ese nombre es único en el proyecto (un "index.ts" o "utils.ts" en otro lado no cuenta).
    const mismos = todos.filter((f) => path.basename(f) === path.basename(t.archivo!));
    const otro = mismos.length === 1 && !/^(index|main|utils?|helpers?|types|config|app|mod|__init__)\./i.test(path.basename(t.archivo!)) ? mismos[0] : undefined;
    if (otro) {
      Object.assign(t, { hecha: true, hechaEn: ahora, detalle: `${t.detalle ?? ""} (lo creaste en ${otro})`.trim() });
      cambio = true;
    }
  }
  // Las hechas hace más de un día se archivan: el panel no se llena.
  for (const t of tareas.filter((x) => x.hecha && !x.archivada))
    if (!t.hechaEn) {
      t.hechaEn = ahora;
      cambio = true;
    } else if (Date.now() - Date.parse(t.hechaEn) > 24 * 3600_000) {
      t.archivada = true;
      cambio = true;
    }
  for (const t of tareas.filter((x) => !x.hecha && !x.archivada && x.funcion && x.archivo)) {
    const abs = path.join(root, t.archivo!);
    const lang = langFor(t.archivo!);
    if (!lang || !fs.existsSync(abs)) continue;
    const src = fs.readFileSync(abs, "utf8");
    const parsed = await parse(src, lang).catch(() => null); // si no se puede analizar, la tarea sigue pendiente
    if (parsed && medir(src, parsed).funciones.some((f) => f.nombre === t.funcion)) {
      t.hecha = true;
      t.hechaEn = ahora;
      cambio = true;
    }
  }
  if (!cambio) return tareas;
  // Mientras se analizaba el código otro proceso pudo cambiar tareas: se guarda sobre lo que hay ahora,
  // y solo se pisa una tarea si nadie la tocó en el medio.
  return conCandadoSync(tareasFile(root), () => {
    const ahoraEnDisco = cargarTareas(root);
    const nuestras = new Map(tareas.map((t) => [t.id, t]));
    const final = ahoraEnDisco.map((t) => (antes.get(t.id) === JSON.stringify(t) ? (nuestras.get(t.id) ?? t) : t));
    for (const t of tareas)
      if (!antes.has(t.id) && !final.some((x) => x.archivo === t.archivo && x.titulo === t.titulo)) {
        const max = Math.max(0, ...final.map((x) => Number(/^t(\d+)$/.exec(x.id)?.[1] ?? 0)));
        final.push({ ...t, id: `t${max + 1}` });
      }
    guardarTareas(root, final);
    return final;
  });
}

export async function siguiente(root: string): Promise<Paso[]> {
  const pasos: Paso[] = [];
  const notas = todasLasNotas(root).filter((n) => n.estado === "abierta");

  // 1. Lo que espera tu respuesta.
  for (const n of notas.filter((x) => x.prediccion && x.hilo[x.hilo.length - 1]?.quien === "ia"))
    pasos.push({ prioridad: 1, tipo: "responder", titulo: n.titulo, accion: "Responde la predicción en la nota (sin ejecutar el código)", archivo: n.archivo, linea: n.ancla.linea, ref: n.id });
  const mem = leerMemoria(path.join(dataDir(root), "conocimiento.md"));
  if (mem.abiertas.length)
    pasos.push({ prioridad: 1, tipo: "responder", titulo: `${mem.abiertas.length} pregunta(s) sobre el proyecto`, accion: `Responde: ${mem.abiertas[0]!.p.replace(/\s*\(sugerencia: [^)]*\)\s*$/, "")}`, archivo: path.relative(root, path.join(dataDir(root), "conocimiento.md")) });

  // 2. Verificaciones que fallan.
  try {
    const diags = JSON.parse(fs.readFileSync(diagFile(root), "utf8")) as Record<string, { diags: Diagnostico[] }>;
    for (const [rel, d] of Object.entries(diags))
      for (const x of d.diags.slice(0, 3)) pasos.push({ prioridad: 2, tipo: "arreglar", titulo: x.msg.slice(0, 80), accion: `Arregla esto en ${x.archivo || rel}:${x.linea}`, archivo: x.archivo || rel, linea: x.linea });
  } catch {
    /* sin diagnósticos */
  }

  // 3. Tareas del plano.
  for (const t of (await actualizarTareas(root)).filter((x) => !x.hecha && !x.archivada))
    pasos.push({
      prioridad: 3,
      tipo: "tarea",
      titulo: t.detalle ? `${t.titulo} — ${t.detalle}` : t.titulo,
      accion: t.funcion ? `Crea \`${t.funcion}\` en ${t.archivo}` : t.crear ? `Crea el archivo ${t.archivo}` : t.titulo,
      ...(t.archivo ? { archivo: t.archivo } : {}),
      ref: t.id,
    });

  // 4 y 5. Notas.
  for (const n of notas.filter((x) => !x.prediccion))
    pasos.push({
      prioridad: n.bloqueante ? 4 : 5,
      tipo: n.bloqueante ? "bloqueante" : "nota",
      titulo: n.titulo,
      accion: n.accion || "Lee la nota y decide qué hacer",
      archivo: n.archivo,
      linea: n.ancla.linea,
      ref: n.id,
    });

  return pasos.sort((a, b) => a.prioridad - b.prioridad);
}
