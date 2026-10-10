import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import { migrarModos } from "./compartido";

/**
 * Lo que comparten los módulos de la extensión: llamar a la CLI `cai`, ubicar el proyecto y
 * leer las notas (.cai/notas/*.json). La extensión LEE los datos directo (rápido) y ESCRIBE
 * siempre a través de la CLI, que es donde están las reglas.
 */

export const output = vscode.window.createOutputChannel("ComplementAIry");

export function cli(): string {
  return vscode.workspace.getConfiguration("cai").get<string>("comando", "cai");
}

/**
 * El comando de la CLI separado en palabras (p. ej. "node /ruta/dist/cli.js"). Se ejecuta SIN shell:
 * nada de lo que haya en el ajuste (`;`, `$(…)`, `|`) se interpreta como otro comando.
 */
export function comandoCli(): { exe: string; base: string[] } {
  const partes = cli().trim().split(/\s+/).filter(Boolean);
  return { exe: partes[0] ?? "cai", base: partes.slice(1) };
}

/** Variables de entorno con las que corre la CLI (el proyecto, para los hooks y las rutas). */
export const entornoCli = (cwd: string): NodeJS.ProcessEnv => ({ ...process.env, CLAUDE_PROJECT_DIR: cwd });

/** Tope por defecto de un pedido a la CLI: las revisiones completas tardan, pero no tanto. */
const TOPE_MS = 10 * 60_000;

export function root(doc?: vscode.TextDocument): string | undefined {
  const folder = doc ? vscode.workspace.getWorkspaceFolder(doc.uri) : vscode.workspace.workspaceFolders?.[0];
  return folder?.uri.fsPath;
}

export const relDe = (cwd: string, fsPath: string) => path.relative(cwd, fsPath).split(path.sep).join("/");

/** La CLI respondió que ya hay otro pedido en curso sobre ese archivo (código 3). */
export class OcupadoError extends Error {}

/**
 * Corre `cai ...`. Devuelve stdout. Si sale con 3 lanza OcupadoError; con otro código distinto de 0
 * (salvo los de `aceptar`, p. ej. el 1 de `check` = "alguna predicción no coincidió") lanza un error.
 */
export function correr(args: string[], cwd: string, o: { silencioso?: boolean; aceptar?: number[]; cancelar?: vscode.CancellationToken; topeMs?: number } = {}): Promise<string> {
  if (!o.silencioso) output.appendLine(`$ ${cli()} ${args.join(" ")}`);
  const { exe, base } = comandoCli();
  const corte = new AbortController();
  const sub = o.cancelar?.onCancellationRequested(() => corte.abort());
  const tope = o.topeMs ?? TOPE_MS;
  return new Promise<string>((resolve, reject) => {
    execFile(exe, [...base, ...args], { cwd, maxBuffer: 16 << 20, env: entornoCli(cwd), signal: corte.signal, timeout: tope, killSignal: "SIGTERM" }, (err, stdout, stderr) => {
      if (err && (err as { name?: string }).name === "AbortError") return reject(new Error("cancelado: detuve el pedido a pedido tuyo"));
      if (err && (err as { killed?: boolean }).killed && !corte.signal.aborted)
        return reject(new Error(`la CLI tardó más de ${Math.round(tope / 60_000)} min y la detuve; revisa "Ver salida" o prueba de nuevo`));
      if (err && (err as { code?: unknown }).code === "ENOENT")
        return reject(new Error(`no encuentro el comando "${exe}" (ajuste cai.comando): ¿está instalada la CLI de ComplementAIry?`));
      if (!o.silencioso) {
        output.append(stdout.length > 4000 ? `${stdout.slice(0, 4000)}…\n` : stdout);
        if (stderr) output.append(stderr);
      }
      const code = err && typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : err ? 1 : 0;
      if (code === 3) {
        let msg = stderr.replace(/^cai:\s*/, "").trim();
        try {
          msg = (JSON.parse(stdout) as { mensaje?: string }).mensaje ?? msg;
        } catch {
          /* salida de texto */
        }
        return reject(new OcupadoError(msg || "la IA ya está trabajando en este archivo"));
      }
      if (err && !o.aceptar?.includes(code)) {
        const detalle = stderr.replace(/^cai:\s*/, "").trim() || stdout.trim().split("\n").slice(-3).join(" · ") || err.message;
        reject(new Error(detalle));
      } else resolve(stdout.trim());
    });
  }).finally(() => sub?.dispose());
}

export const dataDir = (cwd: string) => (fs.existsSync(path.join(cwd, ".aicode")) && !fs.existsSync(path.join(cwd, ".cai")) ? path.join(cwd, ".aicode") : path.join(cwd, ".cai"));

/** Vista efectiva: lo que diga .cai/config.json, si no el ajuste de VSCode, si no "notas". */
export function vista(cwd: string): "notas" | "comentarios" {
  try {
    const v = (JSON.parse(fs.readFileSync(path.join(dataDir(cwd), "config.json"), "utf8")) as { vista?: string }).vista;
    if (v === "notas" || v === "comentarios") return v;
  } catch {
    /* sin config */
  }
  const s = vscode.workspace.getConfiguration("cai").get<string>("vista", "proyecto");
  return s === "comentarios" ? "comentarios" : "notas";
}

/** Para que la CLI use la misma vista que el ajuste de VSCode cuando el proyecto no fija una. */
export function envVista(): void {
  const s = vscode.workspace.getConfiguration("cai").get<string>("vista", "proyecto");
  if (s === "notas" || s === "comentarios") process.env.CAI_VISTA = s;
  else delete process.env.CAI_VISTA;
}

/** Guardados que hace la propia extensión (antes de llamar a la CLI): no disparan el acompañante. */
const propios = new Set<string>();
export const guardadoPropio = (doc: vscode.TextDocument) => propios.has(doc.uri.toString());
export async function guardar(doc: vscode.TextDocument): Promise<void> {
  if (!doc.isDirty) return;
  const k = doc.uri.toString();
  propios.add(k);
  try {
    await doc.save();
  } finally {
    setTimeout(() => propios.delete(k), 500);
  }
}

// --- Notas -------------------------------------------------------------------------------

export interface Mensaje {
  quien: "tu" | "ia";
  texto: string;
  fecha: string;
  meta?: { kind?: string; modelo?: string; costo?: number; pedido?: string };
}

export interface Nota {
  id: string;
  archivo: string;
  ancla: { linea: number; texto: string; funcion?: string };
  tipo: string;
  titulo: string;
  accion: string;
  hilo: Mensaje[];
  snippets: { llamada: string; despues: string; linea?: number; lugar?: "ubicado" | "sin ubicar" }[];
  bloqueante: boolean;
  estado: "abierta" | "resuelta";
  origen: string;
  prediccion?: { expresion: string; funcion: string };
  desanclada?: boolean;
  alcance?: "archivo";
  verificacion?: { estado: "lista" | "casi" | "falta"; resumen: string; fecha: string; hash: string; lineas?: string[] };
  modo?: string;
  dados?: string[];
  explicacion?: { texto: string; coincide: boolean; comentario: string };
  testsProbados?: { funcion: string; fecha: string; archivo?: string };
  impacto?: { funcion: string; archivo: string; fecha: string }[];
  /** Funciones que esta usa y aún no están listas (lo calcula la CLI sin IA; se reemplaza en cada verificación). */
  dependencias?: { funcion: string; archivo: string; estado: string }[];
  ultimaPrueba?: { fecha: string; pasan: number; fallan: number; detalle: { descripcion: string; estado: string; obtenido?: string; esperado: string; llamada: string }[] };
  /** Modo programar (ver la CLI, programar.ts). */
  plan?: { pasos: { texto: string; hecho?: boolean; repertorio?: string }[]; separar?: { nombre: string; proposito: string } | null; fecha: string };
  contrato?: { llamada: string; esperado: string }[];
  programada?: { fecha: string; tipo: string; porciones: number; pruebas: number; aciertosPrimera: number; sinProbar: number; ordenes?: number; prediccion?: { acierto: boolean } };
  objetivo?: { texto: string; criterios: string[]; confirmado?: string; terminada?: string };
  actualizada: string;
}

/** Una propuesta del modo programar (en preparación; nunca en tu archivo hasta tu clic). */
export interface Propuesta {
  tipo: "dirigido" | "pr" | "adaptada" | "construir";
  fecha: string;
  archivo: string;
  funcion: string;
  paso?: number;
  instruccion?: string;
  codigo: string;
  despues?: string;
  linea?: number;
  falta?: string;
  explicacion?: string;
  porciones?: {
    desde: number;
    hasta: number;
    paso: number;
    porque: string;
    aprobada: boolean;
    pruebas: { entrada: string; espero: string; obtenido: string; toca: boolean; acierto: boolean; explicacion?: string }[];
    /** Construir juntos (ver la CLI, construir.ts). */
    entrada?: string;
    incluida?: boolean;
    codigo?: string;
    tipo?: "ya-estaba" | "ajuste";
    orden?: string;
    idea?: string;
    falta?: string;
    explicacion?: string;
    /** La IA chica (a ciegas): lo que agregó sin que lo pidieras, o lo que tu orden pedía y no hizo. */
    verificacion?: { agregado: string[]; falta: string[]; dejado?: boolean };
  }[];
  contrato?: { llamada: string; esperado: string; obtenido: string; pasa: boolean }[];
  original?: { id: string; codigo: string; proyecto: string };
  cambios?: { que: string; porque: string }[];
  construir?: {
    ayuda: "sugerir" | "aprender";
    pasosPlan?: number;
    /** La firma y el cierre de la función (para los campos de cada parámetro al probar). */
    base?: { cabecera: string[]; cierre: string[]; sangria: string };
    /** Los pasos recién escritos (0 = un ajuste): el panel abre ahí. */
    escritos?: number[];
    /** "pedido" (programar: la función entera con lo que pides) o "pasos" (programar · aprender). */
    forma?: "pedido" | "pasos";
    separar?: { pedido: string; motivo: string; auxiliares: { nombre: string; firma: string; proposito: string }[] };
    pedidoPendiente?: string;
    larga?: { lineas: number; max: number; pedido: string };
    historial?: unknown[];
    auditoria?: { estado: "lista" | "casi" | "falta"; resumen: string; casos?: { llamada: string; comentario: string }[]; queHacer?: string[]; hallazgos: { texto: string; porque: string }[]; ideal?: { descripcion: string; codigo: string }; codigo: string; fecha: string };
    /** Lo que la IA ofrece en palabras para los pasos que faltan (cada uno espera tu orden). */
    ofertas?: { paso: number; idea: string; alternativas: string[]; ideaTuya?: string; sobreTuIdea?: string }[];
    /** Sugerencias de la IA sobre el código que la función ya tenía (las decides tú). */
    previo?: { texto: string; porque: string; estado: "pendiente" | "dejado" | "aplicado" }[];
    casos?: { descripcion: string; llamada: string; esperado: string; obtenido?: string; pasa?: boolean; duda?: string; tuyo?: boolean; raro?: string; ajustar?: boolean }[];
    prediccion?: { llamada: string; espero?: string; obtenido?: string; acierto?: boolean; explicacion?: string };
    trampas?: string[];
  };
}

// --- Probar sin escribir llamadas: un campo por parámetro ---------------------------------------------

/** Separa por comas de primer nivel (fuera de paréntesis, corchetes, llaves y textos). */
function partirComas(t: string): string[] {
  const out: string[] = [];
  let prof = 0;
  let cita = "";
  let actual = "";
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!;
    if (cita) {
      actual += ch;
      if (ch === "\\") actual += t[++i] ?? "";
      else if (ch === cita) cita = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") cita = ch;
    else if ("([{".includes(ch)) prof++;
    else if (")]}".includes(ch)) prof--;
    else if (ch === "," && prof === 0) {
      out.push(actual.trim());
      actual = "";
      continue;
    }
    actual += ch;
  }
  if (actual.trim()) out.push(actual.trim());
  return out;
}

/** Lo de adentro del primer paréntesis (respetando anidados). */
function entreParentesis(t: string): string {
  const i = t.indexOf("(");
  if (i < 0) return "";
  let prof = 0;
  for (let j = i; j < t.length; j++) {
    if (t[j] === "(") prof++;
    else if (t[j] === ")" && --prof === 0) return t.slice(i + 1, j);
  }
  return t.slice(i + 1);
}

/** Los nombres de los parámetros de una firma (sin tipos, valores por defecto ni `self`). */
export function parametrosDe(firma: string): string[] {
  return partirComas(entreParentesis(firma))
    .map((x) => x.replace(/^\.\.\./, "…").replace(/\s*=.*$/s, "").replace(/\?\s*:.*$/s, "").replace(/\s*:.*$/s, "").trim())
    .filter((x) => x && x !== "self" && x !== "this");
}

/** Los argumentos de una llamada sugerida ("f(1, 'a')" → ["1", "'a'"]). */
export const argumentosDe = (llamada: string): string[] => partirComas(entreParentesis(llamada));

/**
 * Lo que escribes en un campo, como valor: números, true/false/null, listas, objetos o textos entre
 * comillas quedan tal cual; lo demás se toma como TEXTO (no hace falta poner comillas).
 */
export function aLiteral(v: string, python = false): string {
  const t = v.trim();
  if (!t) return python ? "None" : "undefined";
  if (/^(-?\d+(\.\d+)?(e-?\d+)?|true|false|null|undefined|NaN|-?Infinity|None|True|False)$/.test(t) || /^["'`\[{(]/.test(t)) return t;
  return JSON.stringify(t);
}

/** Lo que esperas: "error: …" tal cual; lo demás como valor (texto sin comillas = texto). */
export const esperadoLiteral = (v: string, python = false) => (/^\s*error\b/i.test(v) ? v.trim() : aLiteral(v, python));

/** Arma la llamada con los valores de los campos (los vacíos del final se omiten). */
export function armarLlamada(nombre: string, valores: string[], python = false): string {
  const vs = [...valores];
  while (vs.length && !vs[vs.length - 1]!.trim()) vs.pop();
  return `${nombre}(${vs.map((v) => aLiteral(v, python)).join(", ")})`;
}

/** Para mostrar un argumento sugerido en un campo: un texto simple sin sus comillas. */
export const valorDeCampo = (arg: string) => (/^"([^"\\]*)"$/.test(arg) || /^'([^'\\]*)'$/.test(arg) ? arg.slice(1, -1) : arg);

export function leerPropuesta(cwd: string, rel: string, funcion: string): Propuesta | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir(cwd), "cache", "propuestas", `${encodeURIComponent(rel)}#${encodeURIComponent(funcion)}.json`), "utf8")) as Propuesta;
  } catch {
    return null;
  }
}

export const archivoNotas = (cwd: string, rel: string) => path.join(dataDir(cwd), "notas", rel.replace(/[\\/]/g, "__") + ".json");

/** Línea (0-based) que DEFINE la función de la clave "nombre" o "nombre#k". Igual que en la CLI (notas.ts). */
function lineaDeDefinicion(lineas: string[], clave: string): number {
  const nombre = clave.replace(/#\d+$/, "");
  const k = Number(/#(\d+)$/.exec(clave)?.[1] ?? 1);
  const esc = nombre.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const inicio = new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?(?:static\\s+)?(?:(?:function\\*?|def|fn|func|fun|const|let|var|private|public|protected|override|get|set)\\s+)*${esc}\\s*(?:[=:(<])`);
  const conPalabra = new RegExp(`\\b(?:function|def|fn|func|fun|const|let|var)\\s+\\*?\\s*${esc}\\b`);
  let vistas = 0;
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i]!;
    if (!inicio.test(l)) continue;
    const sinComentario = l.replace(/\s*(\/\/|#).*$/, "").trimEnd();
    const define = conPalabra.test(l) || (/(\{|=>|:)$/.test(sinComentario) && !/;$/.test(sinComentario));
    if (define && ++vistas === k) return i;
  }
  return -1;
}

/** Clave de una función (símbolo de VSCode): su nombre, o "nombre#k" si se repite (igual que la CLI). */
export function claveDeSimbolo(funciones: vscode.DocumentSymbol[], s: vscode.DocumentSymbol): string {
  const nombre = (x: vscode.DocumentSymbol) => x.name.replace(/\(.*$/, "");
  const mismos = funciones.filter((x) => nombre(x) === nombre(s)).sort((a, b) => a.range.start.line - b.range.start.line);
  return mismos.length > 1 ? `${nombre(s)}#${mismos.indexOf(s) + 1}` : nombre(s);
}

/** Igual que en la CLI (notas.ts): misma línea, la función, o la línea más cercana con el mismo texto. */
export function reanclar(lineas: string[], n: Nota): Nota {
  if (n.alcance === "archivo") return { ...n, ancla: { ...n.ancla, linea: 1 }, desanclada: false };
  const objetivo = n.ancla.texto.trim();
  const i = n.ancla.linea - 1;
  if (objetivo && lineas[i]?.trim() === objetivo) return { ...n, desanclada: false };
  if (n.ancla.funcion) {
    const k = lineaDeDefinicion(lineas, n.ancla.funcion);
    if (k >= 0) return { ...n, ancla: { ...n.ancla, linea: k + 1, texto: lineas[k]!.trim() }, desanclada: false };
  }
  if (objetivo) {
    let mejor = -1;
    for (let k = 0; k < lineas.length; k++) if (lineas[k]!.trim() === objetivo && (mejor < 0 || Math.abs(k - i) < Math.abs(mejor - i))) mejor = k;
    if (mejor >= 0) return { ...n, ancla: { ...n.ancla, linea: mejor + 1 }, desanclada: false };
  }
  return { ...n, ancla: { ...n.ancla, linea: Math.min(Math.max(1, n.ancla.linea), Math.max(1, lineas.length)) }, desanclada: !!objetivo };
}

/**
 * Notas abiertas de un documento, re-ancladas contra el texto ACTUAL del editor (aunque no esté guardado).
 * `undefined` si el archivo de notas no se pudo leer (así no se borran los hilos por un error pasajero).
 */
export function notasDe(cwd: string, doc: vscode.TextDocument, incluirResueltas = false): Nota[] | undefined {
  const f = archivoNotas(cwd, relDe(cwd, doc.uri.fsPath));
  if (!fs.existsSync(f)) return [];
  try {
    const todas = (JSON.parse(fs.readFileSync(f, "utf8")) as { notas: Nota[] }).notas ?? [];
    const lineas = doc.getText().split(/\r?\n/);
    return todas.filter((n) => incluirResueltas || n.estado === "abierta").map((n) => (n.estado === "abierta" ? reanclar(lineas, n) : n));
  } catch {
    return undefined;
  }
}

/** Todas las notas abiertas del proyecto, sin re-anclar (para el panel). */
export function todasLasNotas(cwd: string): Nota[] {
  const d = path.join(dataDir(cwd), "notas");
  if (!fs.existsSync(d)) return [];
  const out: Nota[] = [];
  for (const f of fs.readdirSync(d).filter((x) => x.endsWith(".json"))) {
    try {
      out.push(...((JSON.parse(fs.readFileSync(path.join(d, f), "utf8")) as { notas: Nota[] }).notas ?? []).filter((n) => n.estado === "abierta"));
    } catch {
      /* archivo a medio escribir: se relee en el próximo cambio */
    }
  }
  return out;
}

// --- Qué está haciendo la IA (.cai/cache/ocupado/) ------------------------------------------

export interface Ocupacion {
  pid: number;
  tarea: string;
  archivo: string;
  linea?: number;
  desde: string;
}

function vivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * ¿El pid sigue siendo un proceso de la CLI? Un pid de un archivo de caché puede haberse reusado para
 * otro programa: antes de detenerlo se mira su línea de comando (en Linux, /proc). Sin /proc, se confía
 * en que el registro tiene menos de 15 min.
 */
export function esProcesoCai(pid: number): boolean {
  if (!vivo(pid)) return false;
  try {
    const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ");
    return /\bcai\b|complementairy|aicode|cli\.js/.test(cmd);
  } catch {
    return process.platform !== "linux";
  }
}

/** Detiene un pedido en curso de la CLI (solo si el pid sigue siendo de la CLI). */
export function detenerPedido(pid: number): boolean {
  if (!esProcesoCai(pid)) return false;
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false; // ya terminó
  }
}

export function enCurso(cwd: string): Ocupacion[] {
  const d = path.join(dataDir(cwd), "cache", "ocupado");
  if (!fs.existsSync(d)) return [];
  const out: Ocupacion[] = [];
  for (const f of fs.readdirSync(d).filter((x) => x.endsWith(".json"))) {
    try {
      const o = JSON.parse(fs.readFileSync(path.join(d, f), "utf8")) as Ocupacion;
      if (vivo(o.pid) && Date.now() - Date.parse(o.desde) < 15 * 60_000) out.push(o);
    } catch {
      /* recién borrado */
    }
  }
  return out;
}

// --- Silenciar (para concentrarse) -----------------------------------------------------------

let silencioHasta = 0;
export const silenciado = () => Date.now() < silencioHasta;
export const minutosSilencio = () => Math.ceil((silencioHasta - Date.now()) / 60_000);
export function silenciar(min: number): void {
  silencioHasta = min > 0 ? Date.now() + min * 60_000 : 0;
}

export function mostrarError(e: unknown): void {
  if (e instanceof OcupadoError) vscode.window.showWarningMessage(`ComplementAIry: ${e.message}`);
  else vscode.window.showErrorMessage(`ComplementAIry: ${(e as Error).message}`, "Ver salida").then((v) => v && output.show());
}

// --- Configuración del proyecto (.cai/config.json) ---------------------------------------------

export interface ConfigProyecto {
  vista?: "notas" | "comentarios";
  modo?: string;
  modos?: { porCarpeta?: Record<string, string>; porArchivo?: Record<string, string>; porFuncion?: Record<string, string> };
  ayuda?: { porDefecto?: string };
  rapidas?: { activas?: boolean; esperaMs?: number; procesoAbierto?: boolean; soloConNota?: boolean; maxHora?: number };
  acompanar?: { nivel?: string; revisar?: boolean; verificar?: boolean; esperaAutoguardado?: number; maxLlamadasHora?: number };
  ia?: { modelos?: { chico?: string; mediano?: string; grande?: string } };
  tests?: { carpeta?: string; crearConIa?: boolean; alGuardar?: boolean };
  revisar?: { alSalir?: "nunca" | "ligera" | "completa"; minutosFuera?: number };
  modosVersion?: number;
  chat?: { modelo?: "chico" | "mediano" | "grande" };
  ideas?: { aprender?: boolean };
  repertorio?: { guardar?: boolean; usar?: "siempre" | "preguntar" | "nunca" };
  programar?: { prediccionObligatoria?: boolean };
  [k: string]: unknown;
}

/** Lo que está escrito en .cai/config.json (sin valores por defecto). Con `estricto`, un JSON inválido es un error (no {}). */
export function leerConfig(cwd: string, estricto = false): ConfigProyecto {
  const f = path.join(dataDir(cwd), "config.json");
  if (!fs.existsSync(f)) return {};
  try {
    return migrarModos(JSON.parse(fs.readFileSync(f, "utf8")) as ConfigProyecto);
  } catch (e) {
    if (estricto) throw new Error(`${path.relative(cwd, f)} no es un JSON válido (${(e as Error).message}); arréglalo antes de guardar la configuración para no perder lo que tiene`);
    return {};
  }
}

// --- Modos: la misma lógica que la CLI (compartido.ts se copia al compilar) ------------------------

export { esModo, MODOS, migrarModos, modoDe, modoEfectivo, type Ayuda, type Escribe, type Modo } from "./compartido";

// --- Decisiones (.cai/decisiones.json; decidir y retractar pasan por la CLI) --------------------------

export interface Decision {
  id: string;
  pregunta: string;
  opciones: { opcion: string; consecuencia: string }[];
  recomendada?: string;
  alcance: { archivo?: string; funcion?: string };
  estado: "pendiente" | "vigente" | "retractada";
  eleccion?: string;
  decidida?: string;
  anterior?: { eleccion: string; fecha: string }[];
}

export function leerDecisiones(cwd: string): Decision[] {
  try {
    return (JSON.parse(fs.readFileSync(path.join(dataDir(cwd), "decisiones.json"), "utf8")) as { decisiones: Decision[] }).decisiones ?? [];
  } catch {
    return [];
  }
}

/** La última guía rápida que se mostró (para el panel "Nota" y el hover): texto completo. */
export const guiaActual: { uri?: string; linea?: number; texto?: string } = {};
