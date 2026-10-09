import fs from "node:fs";
import path from "node:path";
import { parse } from "./comments.js";
import { dataDir, makeZoner } from "./config.js";
import { listFiles } from "./files.js";
import { langFor } from "./lang.js";
import { medir } from "./metricas.js";
import { conCandado } from "./ocupado.js";
import { cargarNotas } from "./notas.js";
import { claveFuncion } from "./notasFuncion.js";
import { huella } from "./verificar.js";

/**
 * Índice vivo del proyecto (sin IA): cada función con su firma, quién la llama y a quién llama, el
 * estado de su nota, sus tests y un resumen de una línea. Así "las funciones se conocen": se pasa como
 * contexto a la IA y no hay que volver a pagar por lo que ya se sabe. Se actualiza por archivo, solo
 * si cambió su código (huella).
 */

export interface EntradaIndice {
  archivo: string;
  clave: string;
  nombre: string;
  firma: string;
  linea: number;
  lineas: number;
  exportada: boolean;
  /** Nombres de funciones del proyecto que llama. */
  llama: string[];
  /** Todo lo que llama, sin filtrar (para volver a cruzar cuando aparezca una función nueva en otro archivo). */
  llamadasCrudas?: string[];
  /** "archivo:clave" de las funciones que la llaman (se calcula al cruzar todo el índice). */
  llamadaPor: string[];
  estado: "sin nota" | "abierta" | "lista" | "casi" | "falta";
  tests?: { pasan: number; fallan: number; casos: number };
  resumen: string;
  huella: string;
}

interface ArchivoIndice {
  huella: string;
  funciones: EntradaIndice[];
}

export interface Indice {
  version: 1;
  actualizado: string;
  archivos: Record<string, ArchivoIndice>;
}

const archivo = (root: string) => path.join(dataDir(root), "indice.json");
const CLAVES_LENGUAJE = new Set(["if", "for", "while", "switch", "catch", "function", "return", "typeof", "new", "super", "await", "async", "elif", "print", "def", "class", "with", "not", "and", "or"]);

export function leerIndice(root: string): Indice {
  try {
    return JSON.parse(fs.readFileSync(archivo(root), "utf8")) as Indice;
  } catch {
    return { version: 1, actualizado: "", archivos: {} };
  }
}

/** Nombres de lo que se llama dentro de un código (`x(`, `this.x(`, `obj.x(`), sin palabras del lenguaje. */
export function llamadasEn(codigo: string): string[] {
  const out = new Set<string>();
  for (const m of codigo.matchAll(/(?:^|[^\w$])([A-Za-z_$][\w$]*)\s*\(/g)) if (!CLAVES_LENGUAJE.has(m[1]!)) out.add(m[1]!);
  return [...out];
}

/** Estado, tests y resumen de cada función, según sus notas (lo más reciente). */
function estadoDesdeNotas(root: string, rel: string, src: string): Map<string, Pick<EntradaIndice, "estado" | "tests" | "resumen">> {
  const out = new Map<string, Pick<EntradaIndice, "estado" | "tests" | "resumen">>();
  const notas = cargarNotas(root, rel, src).sort((a, b) => a.actualizada.localeCompare(b.actualizada));
  for (const n of notas) {
    const k = n.ancla.funcion;
    if (!k || n.alcance === "archivo") continue;
    const estado = n.verificacion?.estado ?? (n.estado === "abierta" ? "abierta" : (out.get(k)?.estado ?? "sin nota"));
    const previo = out.get(k);
    out.set(k, {
      estado: n.estado === "abierta" && !n.verificacion ? "abierta" : estado,
      ...(n.ultimaPrueba ? { tests: { pasan: n.ultimaPrueba.pasan, fallan: n.ultimaPrueba.fallan, casos: n.ultimaPrueba.detalle.length } } : previo?.tests ? { tests: previo.tests } : {}),
      resumen: n.verificacion?.resumen || n.accion || previo?.resumen || "",
    });
  }
  return out;
}

/** Resúmenes de módulos del panorama (ya pagados): se reutilizan como resumen del archivo. */
export function resumenesPanorama(root: string): Record<string, string> {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(dataDir(root), "cache", "panorama.json"), "utf8")) as { resumenes?: Record<string, { resumen: string }> };
    return Object.fromEntries(Object.entries(c.resumenes ?? {}).map(([k, v]) => [k, v.resumen]));
  } catch {
    return {};
  }
}

/**
 * Actualiza el índice: solo los archivos indicados (o todos), y SOLO si cambió su código; el estado
 * (notas, tests) se refresca siempre (es barato). Al final se cruzan las llamadas de todo el proyecto.
 */
export function actualizarIndice(root: string, archivos?: string[]): Promise<Indice> {
  // Con candado: dos guardados casi juntos no se pisan (cada uno lee el índice dentro del candado).
  return conCandado(archivo(root), () => actualizarYa(root, archivos));
}

async function actualizarYa(root: string, archivos?: string[]): Promise<Indice> {
  const idx = leerIndice(root);
  const z = makeZoner(root);
  const todos = listFiles(z).filter((f) => {
    const l = langFor(f);
    // Código del proyecto (sin tests ni datos de ComplementAIry).
    return l?.grammar && !/^(markdown|json|yaml|toml|html|css)$/.test(l.id) && !/^\.(cai|aicode)\//.test(f) && !/(\.test\.|\.spec\.|(^|\/)tests?\/|(^|\/)test_)/.test(f);
  });
  const objetivo = archivos ?? todos;
  // Lo que ya no existe, se saca.
  for (const k of Object.keys(idx.archivos)) if (!todos.includes(k)) delete idx.archivos[k];
  for (const rel of objetivo) {
    const abs = path.join(root, rel);
    const lang = langFor(rel);
    if (!lang || !fs.existsSync(abs)) {
      delete idx.archivos[rel];
      continue;
    }
    const src = fs.readFileSync(abs, "utf8");
    const h = huella(src);
    const estados = estadoDesdeNotas(root, rel, src);
    const previo = idx.archivos[rel];
    if (previo && previo.huella === h) {
      for (const f of previo.funciones) Object.assign(f, estados.get(f.clave) ?? { estado: "sin nota", resumen: f.resumen });
      continue;
    }
    let funciones: EntradaIndice[] = [];
    try {
      const fs2 = medir(src, await parse(src, lang)).funciones;
      const lineas = src.split(/\r?\n/);
      funciones = fs2.map((f) => {
        const clave = claveFuncion(fs2, f);
        const codigo = lineas.slice(f.linea - 1, f.linea - 1 + f.lineas).join("\n");
        const cuerpo = lineas.slice(f.linea, f.linea - 1 + f.lineas).join("\n"); // sin la firma (no contar su propio nombre)
        const e = estados.get(clave);
        return {
          archivo: rel,
          clave,
          nombre: f.nombre,
          firma: (lineas[f.linea - 1] ?? "").trim().replace(/\s*\{\s*$/, "").slice(0, 160),
          linea: f.linea,
          lineas: f.lineas,
          exportada: f.exportada,
          llama: llamadasEn(cuerpo),
          llamadasCrudas: llamadasEn(cuerpo),
          llamadaPor: [],
          estado: e?.estado ?? "sin nota",
          ...(e?.tests ? { tests: e.tests } : {}),
          resumen: e?.resumen ?? "",
          huella: huella(codigo),
        };
      });
    } catch {
      /* no se pudo analizar: queda sin funciones */
    }
    idx.archivos[rel] = { huella: h, funciones };
  }
  // Cruce de llamadas en todo el proyecto: `llama` queda solo con funciones conocidas, y se arma `llamadaPor`.
  const porNombre = new Map<string, EntradaIndice[]>();
  for (const a of Object.values(idx.archivos)) for (const f of a.funciones) porNombre.set(f.nombre, [...(porNombre.get(f.nombre) ?? []), f]);
  for (const a of Object.values(idx.archivos)) for (const f of a.funciones) f.llamadaPor = [];
  for (const a of Object.values(idx.archivos))
    for (const f of a.funciones) {
      f.llama = (f.llamadasCrudas ?? f.llama).filter((n) => porNombre.has(n) && n !== f.nombre);
      for (const n of f.llama) {
        // Si el nombre existe en el mismo archivo, es esa; si no, todas las del proyecto con ese nombre.
        const destino = porNombre.get(n)!.filter((g) => g.archivo === f.archivo);
        for (const g of destino.length ? destino : porNombre.get(n)!) g.llamadaPor.push(`${f.archivo}:${f.clave}`);
      }
    }
  idx.actualizado = new Date().toISOString();
  fs.mkdirSync(path.dirname(archivo(root)), { recursive: true });
  const tmp = `${archivo(root)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(idx, null, 2));
  fs.renameSync(tmp, archivo(root));
  return idx;
}

/** Las funciones de un archivo y, si se indica una, sus vecinas (a quién llama y quién la llama). */
export function vecinas(idx: Indice, rel: string, clave?: string): { delArchivo: EntradaIndice[]; llama: EntradaIndice[]; laLlaman: EntradaIndice[] } {
  const delArchivo = idx.archivos[rel]?.funciones ?? [];
  const f = clave ? delArchivo.find((x) => x.clave === clave) : undefined;
  const todas = Object.values(idx.archivos).flatMap((a) => a.funciones);
  const llama = f ? todas.filter((g) => f.llama.includes(g.nombre) && (g.archivo === rel || !delArchivo.some((x) => x.nombre === g.nombre))) : [];
  const laLlaman = f ? todas.filter((g) => f.llamadaPor.includes(`${g.archivo}:${g.clave}`)) : [];
  return { delArchivo, llama, laLlaman };
}

const ICONO: Record<string, string> = { lista: "🟢", casi: "🟡", falta: "🔴", abierta: "📝", "sin nota": "·" };

export const lineaIndice = (f: EntradaIndice, conArchivo = false) =>
  `${ICONO[f.estado] ?? "·"} ${conArchivo ? `${f.archivo}: ` : ""}${f.firma}${f.tests ? ` [tests ${f.tests.pasan}✅ ${f.tests.fallan}❌]` : ""}${f.resumen ? ` — ${f.resumen.slice(0, 120)}` : ""}`;
