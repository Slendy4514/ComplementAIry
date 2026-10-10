import fs from "node:fs";
import path from "node:path";
import { parse } from "./comments.js";
import { dataDir, makeZoner } from "./config.js";
import { aplicarAResumenes } from "./correcciones.js";
import { listFiles } from "./files.js";
import { langFor } from "./lang.js";
import { medir } from "./metricas.js";
import { conCandado } from "./ocupado.js";
import { cargarNotas } from "./notas.js";
import { claveFuncion } from "./notasFuncion.js";
import { huella } from "./verificar.js";
import { escribirJson, leerCache } from "./almacen.js";
import { cargarTareas } from "./siguiente.js";

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
  /** Para qué es (su objetivo, o lo que decía el plano del archivo al proponerla). */
  proposito?: string;
  /** Está declarada pero vacía (sin cuerpo, solo comentarios, `pass`, `TODO`…): planeada, por hacer. */
  porHacer?: boolean;
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
  // Se regenera desde el código: dañado o ausente, se arma de nuevo.
  return leerCache<Indice>(archivo(root), () => ({ version: 1, actualizado: "", archivos: {} }));
}

/** Nombres de lo que se llama dentro de un código (`x(`, `this.x(`, `obj.x(`), sin palabras del lenguaje. */
export function llamadasEn(codigo: string): string[] {
  const out = new Set<string>();
  for (const m of codigo.matchAll(/(?:^|[^\w$])([A-Za-z_$][\w$]*)\s*\(/g)) if (!CLAVES_LENGUAJE.has(m[1]!)) out.add(m[1]!);
  return [...out];
}

/** Estado, tests y resumen de cada función, según sus notas (lo más reciente). */
function estadoDesdeNotas(root: string, rel: string, src: string): Map<string, Pick<EntradaIndice, "estado" | "tests" | "resumen" | "proposito">> {
  const out = new Map<string, Pick<EntradaIndice, "estado" | "tests" | "resumen" | "proposito">>();
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
      ...propositoDe(n, previo?.proposito),
    });
  }
  return out;
}

/** El propósito según su nota: el objetivo (si lo hay) o lo que decía el plano del archivo. */
function propositoDe(n: ReturnType<typeof cargarNotas>[number], previo?: string): { proposito?: string } {
  const plano = n.origen === "plano" && n.titulo.includes(": ") ? n.titulo.slice(n.titulo.indexOf(": ") + 2) : "";
  const p = n.objetivo?.texto || plano || previo;
  return p ? { proposito: p } : {};
}

/**
 * ¿La función está vacía (planeada, por hacer)? Sin cuerpo, o solo comentarios, `pass`, `...`, `TODO`,
 * un `return` pelado o un "no implementado". Sin IA: la IA la ve como ⬜ y puede decir "usa X" y
 * dejar lo que le falta a X en su propia nota.
 */
export function esPorHacer(codigo: string, langId: string): boolean {
  const py = langId === "python";
  let s = codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  if (py) s = s.replace(/#.*$/gm, "").replace(/("""|''')[\s\S]*?\1/g, "");
  let cuerpo: string;
  if (py) {
    const dosPuntos = s.indexOf(":", s.indexOf(")") + 1);
    if (dosPuntos < 0) return false;
    cuerpo = s.slice(dosPuntos + 1);
  } else {
    const llave = s.indexOf("{");
    if (llave < 0 || !s.trimEnd().endsWith("}")) return false; // flecha con expresión: tiene cuerpo
    cuerpo = s.slice(llave + 1, s.lastIndexOf("}"));
  }
  const resto = cuerpo.replace(/[\s;]+/g, " ").trim();
  return resto === "" || /^(pass|\.\.\.|return|todo|throw new Error\(.*\)|raise NotImplementedError(\(.*\))?|unimplemented!\(\)|todo!\(\))$/i.test(resto);
}

/** El propósito que el plano del archivo le dio a cada función ("Crear X en a.ts: qué hace"). */
function propositosDelPlano(root: string, rel: string): Map<string, string> {
  const out = new Map<string, string>();
  let tareas: ReturnType<typeof cargarTareas> = [];
  try {
    tareas = cargarTareas(root);
  } catch {
    return out; // tareas.json dañado: el índice sigue (el error lo verás al usar las tareas)
  }
  for (const t of tareas)
    if (t.archivo === rel && t.funcion && !t.descartada) {
      const p = t.detalle || (t.titulo.includes(": ") ? t.titulo.slice(t.titulo.indexOf(": ") + 2) : "");
      if (p) out.set(t.funcion, p);
    }
  return out;
}

/** Resúmenes de módulos del panorama (ya pagados): se reutilizan como resumen del archivo. */
export function resumenesPanorama(root: string): Record<string, string> {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(dataDir(root), "cache", "panorama.json"), "utf8")) as { resumenes?: Record<string, { resumen: string }> };
    return Object.fromEntries(Object.entries(aplicarAResumenes(root, c.resumenes ?? {})).map(([k, v]) => [k, v.resumen]));
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
    const delPlano = propositosDelPlano(root, rel);
    const previo = idx.archivos[rel];
    if (previo && previo.huella === h) {
      for (const f of previo.funciones) {
        Object.assign(f, estados.get(f.clave) ?? { estado: "sin nota", resumen: f.resumen });
        const p = estados.get(f.clave)?.proposito ?? delPlano.get(f.nombre);
        if (p) f.proposito = p;
      }
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
          ...((e?.proposito ?? delPlano.get(f.nombre)) ? { proposito: e?.proposito ?? delPlano.get(f.nombre)! } : {}),
          ...(esPorHacer(codigo, lang.id) ? { porHacer: true } : {}),
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
  escribirJson(archivo(root), idx);
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

/**
 * Las funciones que `clave` usa y que aún no están listas: vacías (⬜), 🔴 falta o 🟡 casi. Sin IA.
 * Es lo único que la nota de una función dice de las otras: un aviso para ir a mirar SU nota.
 */
export function dependenciasPendientes(idx: Indice, rel: string, clave: string): { funcion: string; archivo: string; estado: string }[] {
  const v = vecinas(idx, rel, clave);
  return v.llama
    .filter((g) => g.porHacer || g.estado === "falta" || g.estado === "casi")
    .map((g) => ({ funcion: g.clave, archivo: g.archivo, estado: g.porHacer ? "por hacer" : g.estado }));
}

/**
 * Mapa del archivo para una IA que trabaja en UNA función: cada otra función con su firma, para qué
 * es y su estado (⬜ si está vacía), más las que el plano prevé y aún no existen. Así la IA puede decir
 * "usa normalize" en vez de resolverlo dentro de esta función. `max` acota el largo (para la guía gris).
 */
export function mapaArchivo(root: string, idx: Indice, rel: string, clave?: string, max = 2500): string {
  const corta = max < 2000;
  const linea = (f: EntradaIndice) => {
    const para = f.proposito || f.resumen;
    const estado = f.porHacer ? "⬜ por hacer" : ICONO[f.estado] ?? "·";
    return `- ${estado} ${f.firma}${para ? ` — ${para.slice(0, corta ? 70 : 140)}` : ""}${!corta && f.llama.length ? ` (usa: ${f.llama.slice(0, 5).join(", ")})` : ""}`;
  };
  const otras = (idx.archivos[rel]?.funciones ?? []).filter((f) => f.clave !== clave);
  const existentes = new Set((idx.archivos[rel]?.funciones ?? []).map((f) => f.nombre));
  const previstas = [...propositosDelPlano(root, rel)].filter(([n]) => !existentes.has(n)).map(([n, p]) => `- ⬜ (aún no existe) ${n} — ${p.slice(0, corta ? 70 : 140)}`);
  const lineas = [...otras.map(linea), ...previstas];
  if (!lineas.length) return "";
  let texto = "";
  for (const l of lineas) {
    if (texto.length + l.length > max) {
      texto += `- (…y ${lineas.length - texto.split("\n").length + 1} más)\n`;
      break;
    }
    texto += `${l}\n`;
  }
  return `MAPA DEL ARCHIVO (${rel}; las otras funciones; ⬜ = vacía o prevista, por hacer):\n${texto.trimEnd()}`;
}
