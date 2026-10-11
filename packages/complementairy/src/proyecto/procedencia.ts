/**
 * PROCEDENCIA: quién escribió cada línea y si un humano la revisó (y cómo). Es lo que responde
 * "¿qué código no revisó un humano?" (`cai informe`).
 *
 *   .cai/procedencia/<ruta__con__guiones>.json   { archivo, lineas: [{ h, o, n, … }] }   (va al repo)
 *
 * Cada línea guarda la huella de su texto (h), su origen (o) y su nivel de revisión (n). Para atribuir un
 * cambio se compara la secuencia de huellas registrada con la del archivo actual (LCS): las líneas nuevas o
 * cambiadas son de quien hizo el cambio; las que siguen igual conservan su origen y su revisión. Así no hace
 * falta guardar una copia del archivo y un clon nuevo del repo sigue funcionando.
 *
 * Niveles: 0 sin revisar · 1 mostrado (no cuenta) · 2 explicado · 3 predicción ejecutada acertada o mutante
 * detectado · 4 escrito o reescrito por un humano.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import picomatch from "picomatch";
import { escribirJson, leerJson } from "./almacen.js";
import { dataDir, loadConfig } from "./config.js";
import { conCandadoSync } from "./ocupado.js";
import { dividir, huellaLinea, mapearLineas } from "../nucleo/diffLineas.js";

export type Origen = "humano" | "ia" | "snippet" | "heredado" | "previo-propio" | "ia-previa" | "pegado" | "ia-probable" | "herramienta" | "desconocido";

export interface Linea {
  /** Huella del texto (sin espacios de los extremos). */
  h: string;
  o: Origen;
  /** Nivel de revisión 0..4. */
  n: number;
  /** Tarea en la que se escribió. */
  t?: string;
  /** Autor: modelo de IA ("motor:modelo/rol") o email del humano. */
  a?: string;
  /** Evidencias que la revisaron (ids). */
  e?: string[];
  /** Personas que dieron evidencia sobre esta línea (para "no revisado por TI"). */
  p?: string[];
}

export interface Registro {
  version: 1;
  archivo: string;
  actualizado: string;
  lineas: Linea[];
}

/** Orígenes que necesitan evidencia humana para integrarse (nivel ≥ 2). */
export const NECESITAN_EVIDENCIA = new Set<Origen>(["ia", "pegado", "ia-probable", "desconocido"]);
/** Orígenes que necesitan evidencia SOLO si una tarea los toca (entender antes de modificar). */
export const AJENOS = new Set<Origen>(["heredado", "ia-previa", "previo-propio"]);
/** Orígenes que no se revisan por línea (escritos por ti o verificados por una herramienta determinista). */
export const PROPIOS = new Set<Origen>(["humano", "snippet", "herramienta"]);

const NIVEL_INICIAL: Record<Origen, number> = { humano: 4, snippet: 4, herramienta: 4, ia: 0, pegado: 0, "ia-probable": 0, desconocido: 0, heredado: 0, "previo-propio": 0, "ia-previa": 0 };

export const codificar = (rel: string) => rel.replace(/\//g, "__");
const dirProc = (root: string) => path.join(dataDir(root), "procedencia");
const archivoReg = (root: string, rel: string) => path.join(dirProc(root), `${codificar(rel)}.json`);
const fotoDe = (root: string, rel: string) => path.join(dataDir(root), "cache", "foto", codificar(rel));

export function cargarRegistro(root: string, rel: string): Registro | null {
  return leerJson<Registro | null>(archivoReg(root, rel), () => null);
}

export function guardarRegistro(root: string, r: Registro): void {
  escribirJson(archivoReg(root, r.archivo), { ...r, actualizado: new Date().toISOString() });
}

export function listarRegistros(root: string): Registro[] {
  if (!fs.existsSync(dirProc(root))) return [];
  return fs
    .readdirSync(dirProc(root))
    .filter((f) => f.endsWith(".json"))
    .map((f) => leerJson<Registro | null>(path.join(dirProc(root), f), () => null))
    .filter((r): r is Registro => !!r);
}

// --- Clasificación inicial con git blame (cai adoptar) -------------------------------------------------

const IA_TRAILER = /co-authored-by:\s*(claude|copilot|cursor|gemini|chatgpt|codex|devin|aider|github copilot)|generated (with|by) (claude|copilot|cursor|chatgpt)/i;

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
}

export function miEmail(root: string): string {
  try {
    return git(root, ["config", "user.email"]).trim();
  } catch {
    return process.env.GIT_AUTHOR_EMAIL ?? "";
  }
}

/** Origen de cada línea del archivo según git blame (tu email → previo-propio; trailer de IA → ia-previa; resto → heredado). */
export function clasificarConBlame(root: string, rel: string, nLineas: number, sinCommit: Origen = "desconocido"): Origen[] {
  const out = new Array<Origen>(nLineas).fill("heredado");
  const c = loadConfig(root);
  const m = (g: string[]) => g.length > 0 && picomatch(g, { dot: true })(rel);
  let salida: string;
  try {
    salida = git(root, ["blame", "-C", "-M", "--line-porcelain", "--", rel]);
  } catch {
    return out.fill(m(c.autoria.heredado) ? "heredado" : sinCommit);
  }
  const yo = miEmail(root).toLowerCase();
  const mensajes = new Map<string, boolean>();
  const esIa = (sha: string) => {
    if (!mensajes.has(sha)) {
      let msg = "";
      try {
        msg = git(root, ["show", "-s", "--format=%B", sha]);
      } catch {
        /* sin el commit */
      }
      mensajes.set(sha, IA_TRAILER.test(msg));
    }
    return mensajes.get(sha)!;
  };
  let i = 0;
  let sha = "";
  let mail = "";
  for (const l of salida.split("\n")) {
    const cab = /^([0-9a-f]{40}) \d+ (\d+)/.exec(l);
    if (cab) {
      sha = cab[1]!;
      i = Number(cab[2]) - 1;
      continue;
    }
    if (l.startsWith("author-mail ")) mail = l.slice(12).replace(/[<>]/g, "").toLowerCase();
    if (l.startsWith("\t") && i < nLineas) {
      if (/^0+$/.test(sha)) out[i] = sinCommit; // sin commitear: quien asienta ahora (si es humano) o desconocido
      else if (esIa(sha)) out[i] = "ia-previa";
      else if (yo && mail === yo) out[i] = "previo-propio";
      else out[i] = "heredado";
    }
  }
  if (m(c.autoria.heredado)) return out.map((o) => (o === "previo-propio" ? "heredado" : o));
  return out;
}

// --- Inserciones de la IA hechas con tu clic (construir juntos) -------------------------------------------

const archivoPendIa = (root: string, rel: string) => path.join(dataDir(root), "cache", "insercion-ia", `${codificar(rel)}.json`);

/**
 * El código que la IA escribió y entró a tu archivo con tu clic (desde el editor, no con un Edit de Claude
 * Code) queda anotado por huella: cuando se asiente, esas líneas son de la IA, no tuyas.
 */
export function registrarInsercionIa(root: string, rel: string, codigo: string, nivel: number, autor: string): void {
  const f = archivoPendIa(root, rel);
  let prev: { h: string; n: number; a: string }[] = [];
  try {
    prev = JSON.parse(fs.readFileSync(f, "utf8")) as typeof prev;
  } catch {
    /* nada pendiente */
  }
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify([...prev, ...dividir(codigo).filter((l) => l.trim()).map((l) => ({ h: huellaLinea(l), n: nivel, a: autor }))]));
}

function tomarPendientesIa(root: string, rel: string): Map<string, { n: number; a: string }[]> {
  const f = archivoPendIa(root, rel);
  const m = new Map<string, { n: number; a: string }[]>();
  try {
    for (const x of JSON.parse(fs.readFileSync(f, "utf8")) as { h: string; n: number; a: string }[]) m.set(x.h, [...(m.get(x.h) ?? []), x]);
  } catch {
    return m;
  }
  return m;
}

// --- Asentar un cambio ------------------------------------------------------------------------------------

export interface Atribucion {
  origen: Origen;
  autor?: string;
  tarea?: string;
}

/** Sin espacios: dos versiones iguales salvo formato (prettier, ruff) son la misma. */
const sinEspacios = (t: string) => t.replace(/\s+/g, "");

/**
 * Atribuye a `quien` las líneas nuevas o cambiadas desde la última vez. Si no había registro, primero
 * clasifica el archivo (git blame). Si el cambio es SOLO de formato (mismo texto sin espacios), las líneas
 * conservan su origen y su revisión. Devuelve los índices (0-based) atribuidos a `quien`.
 */
export function asentar(root: string, rel: string, contenido: string, quien: Atribucion): number[] {
  return conCandadoSync(archivoReg(root, rel), () => {
    const actuales = dividir(contenido);
    const hs = actuales.map(huellaLinea);
    let reg = cargarRegistro(root, rel);
    if (!reg) {
      // Primera vez: se clasifica con git. Lo no commiteado es tuyo si asientas como humano; si no, desconocido
      // (no se sabe qué escribió quién: necesita evidencia).
      const orig = clasificarConBlame(root, rel, actuales.length, quien.origen === "humano" ? "humano" : "desconocido");
      const pend = quien.origen === "humano" ? tomarPendientesIa(root, rel) : new Map<string, { n: number; a: string }[]>();
      guardarRegistro(root, {
        version: 1,
        archivo: rel,
        actualizado: "",
        lineas: hs.map((h, i) => {
          const deIa = orig[i] === "humano" ? pend.get(h)?.shift() : undefined;
          return deIa ? { h, o: "ia" as Origen, n: deIa.n, a: deIa.a } : { h, o: orig[i]!, n: NIVEL_INICIAL[orig[i]!] };
        }),
      });
      if (pend.size) fs.rmSync(archivoPendIa(root, rel), { force: true });
      guardarFoto(root, rel, contenido);
      return [];
    }
    const foto = leerFoto(root, rel);
    if (foto !== null && foto !== contenido && sinEspacios(foto) === sinEspacios(contenido)) {
      reg = { ...reg, lineas: reformatear(dividir(foto), actuales, reg.lineas) };
      guardarRegistro(root, reg);
      guardarFoto(root, rel, contenido);
      return [];
    }
    const m = mapearLineas(reg.lineas.map((l) => l.h), hs);
    const nuevas: number[] = [];
    const pendIa = quien.origen === "humano" ? tomarPendientesIa(root, rel) : new Map<string, { n: number; a: string }[]>();
    const lineas: Linea[] = hs.map((h, i) => {
      const o = m.origen[i]!;
      if (o >= 0) return reg!.lineas[o]!;
      const deIa = pendIa.get(h)?.shift();
      if (deIa) return { h, o: "ia" as Origen, n: deIa.n, a: deIa.a };
      nuevas.push(i);
      // Una línea en blanco o de solo cierre no cambia de dueño si es trivial: igual se atribuye (es honesto).
      return { h, o: quien.origen, n: NIVEL_INICIAL[quien.origen], ...(quien.tarea ? { t: quien.tarea } : {}), ...(quien.autor ? { a: quien.autor } : {}) };
    });
    guardarRegistro(root, { ...reg, lineas });
    guardarFoto(root, rel, contenido);
    if (pendIa.size) fs.rmSync(archivoPendIa(root, rel), { force: true });
    return nuevas;
  });
}

/** Mapea metadatos línea a línea cuando el cambio fue solo de formato (por posición en el texto sin espacios). */
function reformatear(antes: string[], despues: string[], meta: Linea[]): Linea[] {
  const inicio: number[] = [];
  let acc = 0;
  for (const l of antes) {
    inicio.push(acc);
    acc += sinEspacios(l).length;
  }
  const lineaDe = (off: number) => {
    let k = 0;
    while (k + 1 < inicio.length && inicio[k + 1]! <= off) k++;
    return k;
  };
  let pos = 0;
  return despues.map((l) => {
    const base = meta[lineaDe(pos)] ?? { h: "", o: "desconocido" as Origen, n: 0 };
    pos += sinEspacios(l).length;
    return { ...base, h: huellaLinea(l) };
  });
}

function leerFoto(root: string, rel: string): string | null {
  try {
    return fs.readFileSync(fotoDe(root, rel), "utf8");
  } catch {
    return null;
  }
}

function guardarFoto(root: string, rel: string, contenido: string): void {
  try {
    fs.mkdirSync(path.dirname(fotoDe(root, rel)), { recursive: true });
    fs.writeFileSync(fotoDe(root, rel), contenido);
  } catch {
    /* la foto es solo para detectar formato */
  }
}

// --- Revisión: subir el nivel con evidencia --------------------------------------------------------------

/** Sube a `nivel` las líneas (por índice) del archivo actual, anotando la evidencia y la persona. */
export function registrarRevision(root: string, rel: string, contenido: string, indices: number[], nivel: number, evidencia: string, persona = miEmail(root)): number {
  asentar(root, rel, contenido, { origen: "humano" }); // lo que cambió a mano antes de revisar es tuyo
  return conCandadoSync(archivoReg(root, rel), () => {
    const reg = cargarRegistro(root, rel);
    if (!reg) return 0;
    let n = 0;
    for (const i of indices) {
      const l = reg.lineas[i];
      if (!l) continue;
      if (nivel > l.n) l.n = nivel;
      l.e = [...new Set([...(l.e ?? []), evidencia])];
      if (persona) l.p = [...new Set([...(l.p ?? []), persona])];
      n++;
    }
    guardarRegistro(root, reg);
    return n;
  });
}

/** Marca líneas recién asentadas como tuyas con otro origen (pegado, ia-probable): necesitan evidencia. */
export function marcarOrigen(root: string, rel: string, indices: number[], origen: Origen): number {
  return conCandadoSync(archivoReg(root, rel), () => {
    const reg = cargarRegistro(root, rel);
    if (!reg) return 0;
    let n = 0;
    for (const i of indices) {
      const l = reg.lineas[i];
      if (!l || l.o !== "humano" || !l.h) continue;
      reg.lineas[i] = { ...l, o: origen, n: NIVEL_INICIAL[origen] };
      n++;
    }
    guardarRegistro(root, reg);
    return n;
  });
}

/** Baja el nivel (una predicción fallada en el repaso, una licencia revocada…). */
export function bajarNivel(root: string, rel: string, indices: number[], a: number): void {
  conCandadoSync(archivoReg(root, rel), () => {
    const reg = cargarRegistro(root, rel);
    if (!reg) return;
    for (const i of indices) if (reg.lineas[i] && reg.lineas[i]!.n > a && !PROPIOS.has(reg.lineas[i]!.o)) reg.lineas[i]!.n = a;
    guardarRegistro(root, reg);
  });
}

// --- Consultas -------------------------------------------------------------------------------------------

export interface Tramo {
  archivo: string;
  desde: number; // 1-based
  hasta: number;
  origen: Origen;
  nivel: number;
  tarea?: string;
  autor?: string;
}

/** Tramos (líneas consecutivas con el mismo origen, nivel, tarea y autor) de un registro. */
export function tramos(reg: Registro): Tramo[] {
  const out: Tramo[] = [];
  reg.lineas.forEach((l, i) => {
    const u = out[out.length - 1];
    if (u && u.origen === l.o && u.nivel === l.n && u.tarea === l.t && u.autor === l.a && u.hasta === i) u.hasta = i + 1;
    else out.push({ archivo: reg.archivo, desde: i + 1, hasta: i + 1, origen: l.o, nivel: l.n, ...(l.t ? { tarea: l.t } : {}), ...(l.a ? { autor: l.a } : {}) });
  });
  return out;
}

/** ¿Este tramo necesita evidencia para integrarse? */
export const pendiente = (t: Pick<Tramo, "origen" | "nivel">) => NECESITAN_EVIDENCIA.has(t.origen) && t.nivel < 2;

/** Tramos pendientes de un archivo según el registro (sin asentar). */
export function pendientesDe(root: string, rel: string): Tramo[] {
  const r = cargarRegistro(root, rel);
  return r ? tramos(r).filter(pendiente) : [];
}

export interface Conteo {
  total: number;
  porOrigen: Partial<Record<Origen, { lineas: number; revisadas: number }>>;
  sinRevisar: number;
  /** Cobertura de comprensión de lo que no escribiste tú (0..1). */
  cobertura: number;
}

export function contar(regs: Registro[], persona?: string): Conteo {
  const porOrigen: Conteo["porOrigen"] = {};
  let total = 0;
  let sinRevisar = 0;
  let ajenas = 0;
  let entendidas = 0;
  for (const r of regs)
    for (const l of r.lineas) {
      total++;
      const e = (porOrigen[l.o] ??= { lineas: 0, revisadas: 0 });
      e.lineas++;
      const revisada = l.n >= 2 && (!persona || PROPIOS.has(l.o) || (l.p ?? []).includes(persona));
      if (revisada) e.revisadas++;
      if (NECESITAN_EVIDENCIA.has(l.o) && !revisada) sinRevisar++;
      if (!PROPIOS.has(l.o)) {
        ajenas++;
        if (revisada) entendidas++;
      }
    }
  return { total, porOrigen, sinRevisar, cobertura: ajenas ? entendidas / ajenas : 1 };
}

/** Une dos versiones de un registro (merge driver de git): por huella, gana el nivel más alto. */
export function unirRegistros(base: Registro | null, a: Registro, b: Registro): Registro {
  const meta = new Map<string, Linea>();
  for (const r of [base, a, b]) for (const l of r?.lineas ?? []) {
    const k = l.h;
    const ya = meta.get(k);
    if (!ya || l.n > ya.n) meta.set(k, { ...l, e: [...new Set([...(ya?.e ?? []), ...(l.e ?? [])])], p: [...new Set([...(ya?.p ?? []), ...(l.p ?? [])])] });
  }
  // La secuencia de líneas la decide el archivo real: el pre-commit re-asienta después del merge.
  const lineas = (a.lineas.length >= b.lineas.length ? a : b).lineas.map((l) => meta.get(l.h) ?? l);
  return { version: 1, archivo: a.archivo, actualizado: new Date().toISOString(), lineas };
}
