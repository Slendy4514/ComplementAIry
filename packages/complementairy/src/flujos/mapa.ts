/**
 * MODELO MENTAL del proyecto (propio o heredado) — manifiesto VI.2 (onboarding) y II.2:
 *
 *   mapa        grafo determinista (índice): módulos, llamadas, puntos de entrada, % IA / revisado / ajeno.
 *               Mermaid. Los resúmenes de la IA se marcan "hipótesis sin verificar".
 *   tarjetas    .cai/mapa/<modulo>.md escritas por ti (propósito, invariantes, a quién llama, quién lo llama,
 *               una predicción). Se verifican contra el grafo y ejecutando; CADUCAN si el código cambia.
 *   recorrido   paradas ordenadas por centralidad y riesgo. En cada una: tu hipótesis (solo nombre y firma)
 *               → la IA explica → escribes la diferencia → (opcional) predicción. Deja evidencia de nivel 2/3.
 */
import crypto from "node:crypto";
import os from "node:os";
import { langFor as langForMapa } from "../nucleo/lang.js";
import { coincide, ejecutar as ejecutarParaTraza } from "./predict.js";
import { ejecutarLlamada, partirCriterio, raizDeLlamada } from "./ejecutarLlamada.js";
import fs from "node:fs";
import path from "node:path";
import { dataDir, loadConfig } from "../proyecto/config.js";
import { leerIndice, type EntradaIndice, type Indice } from "../proyecto/indice.js";
import { consultarRol } from "../ia/roles.js";
import { comoDato } from "../ia/decisor.js";
import { conContenido, copiado, referencias, similitud } from "../nucleo/especificidad.js";
import { cargarRegistro, contar, listarRegistros, miEmail, registrarRevision, asentar, AJENOS } from "../proyecto/procedencia.js";
import { guardarEvidencia } from "../proyecto/evidencias.js";

const modulo = (rel: string) => (rel.includes("/") ? rel.split("/").slice(0, -1).join("/") : ".");

export interface Nodo {
  id: string;
  archivo: string;
  nombre: string;
  centralidad: number;
  riesgo: number;
  entrada: boolean;
}

/** Centralidad (quién la llama + a quién llama) y riesgo (ajeno sin entender × centralidad × sin tests). */
export function nodos(root: string, idx: Indice = leerIndice(root)): Nodo[] {
  const out: Nodo[] = [];
  for (const [rel, a] of Object.entries(idx.archivos)) {
    const reg = cargarRegistro(root, rel);
    for (const f of a.funciones) {
      const ls = reg?.lineas.slice(f.linea - 1, f.linea - 1 + f.lineas) ?? [];
      const sinEntender = ls.filter((l) => (AJENOS.has(l.o) || l.o === "ia" || l.o === "pegado" || l.o === "desconocido") && l.n < 2).length / Math.max(1, ls.length);
      const centralidad = f.llamadaPor.length * 2 + f.llama.length;
      const sinTests = f.tests ? 0 : 1;
      out.push({ id: `${rel}#${f.clave}`, archivo: rel, nombre: f.nombre, centralidad, riesgo: Math.round((sinEntender * (1 + centralidad) * (1 + sinTests)) * 100) / 100, entrada: f.exportada && f.llamadaPor.length === 0 });
    }
  }
  return out;
}

/** El mapa en Mermaid (módulos → archivos → llamadas entre funciones), con lo que sabes de cada módulo. */
export function mapaMermaid(root: string, o: { modulo?: string; max?: number } = {}): string {
  const idx = leerIndice(root);
  const ns = nodos(root, idx).filter((n) => !o.modulo || n.archivo.startsWith(o.modulo));
  const top = new Set(ns.sort((a, b) => b.centralidad - a.centralidad).slice(0, o.max ?? 40).map((n) => n.id));
  const san = (s: string) => s.replace(/[^\w]/g, "_");
  const lineas = ["flowchart LR"];
  const porModulo = new Map<string, Nodo[]>();
  for (const n of ns.filter((x) => top.has(x.id))) porModulo.set(modulo(n.archivo), [...(porModulo.get(modulo(n.archivo)) ?? []), n]);
  for (const [m, xs] of porModulo) {
    const regs = listarRegistros(root).filter((r) => modulo(r.archivo) === m);
    const c = contar(regs);
    const ia = (c.porOrigen.ia?.lineas ?? 0) / Math.max(1, c.total);
    lineas.push(`  subgraph ${san(m)}["${m} · IA ${Math.round(ia * 100)}% · entendido ${Math.round(c.cobertura * 100)}%${tarjetaVigente(root, m) ? " · tarjeta ✔" : ""}"]`);
    for (const n of xs) lineas.push(`    ${san(n.id)}["${n.nombre}${n.entrada ? " ⇢" : ""}${n.riesgo > 1 ? " ⚠" : ""}"]`);
    lineas.push("  end");
  }
  for (const [rel, a] of Object.entries(idx.archivos))
    for (const f of a.funciones) {
      const de = `${rel}#${f.clave}`;
      if (!top.has(de)) continue;
      for (const llamada of f.llama) {
        const destino = Object.entries(idx.archivos).flatMap(([r, x]) => x.funciones.filter((g) => g.nombre === llamada).map((g) => `${r}#${g.clave}`))[0];
        if (destino && top.has(destino)) lineas.push(`  ${san(de)} --> ${san(destino)}`);
      }
    }
  return lineas.join("\n");
}

// --- Tarjetas de comprensión ------------------------------------------------------------------------------------

const dirTarjetas = (root: string) => path.join(dataDir(root), "mapa");
const archivoTarjeta = (root: string, m: string) => path.join(dirTarjetas(root), `${m.replace(/\//g, "__") || "_raiz"}.md`);

/** Huella del módulo (firmas de sus funciones): si cambia, la tarjeta caduca. */
export function huellaModulo(root: string, m: string, idx: Indice = leerIndice(root)): string {
  const firmas = Object.entries(idx.archivos)
    .filter(([r]) => modulo(r) === m)
    .flatMap(([, a]) => a.funciones.map((f) => `${f.firma}|${f.huella}`))
    .sort();
  return crypto.createHash("sha1").update(firmas.join("\n")).digest("hex").slice(0, 12);
}

export const PLANTILLA_TARJETA = (m: string, huella: string) => `---
modulo: ${m}
huella: ${huella}
---
# ${m}

## Propósito
<!-- Para qué existe este módulo, con tus palabras. -->

## Invariantes
<!-- Lo que siempre debe cumplirse (ej.: "el total nunca es negativo"). -->

## Llama a
<!-- Funciones de otros módulos que usa (nombres exactos). -->

## Lo llaman
<!-- Quién lo usa. -->

## Predicción
<!-- Una llamada y su resultado: \`calcularTotal([{precio: 2, cantidad: 3}]) → 6\` -->
`;

export function tarjetaVigente(root: string, m: string): boolean {
  const f = archivoTarjeta(root, m);
  if (!fs.existsSync(f)) return false;
  const h = /^huella:\s*(\w+)/m.exec(fs.readFileSync(f, "utf8"))?.[1];
  return h === huellaModulo(root, m);
}

export function crearTarjeta(root: string, m: string): string {
  const f = archivoTarjeta(root, m);
  if (!fs.existsSync(f)) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, PLANTILLA_TARJETA(m, huellaModulo(root, m)));
  }
  return path.relative(root, f);
}

/**
 * Verifica una tarjeta sin IA: secciones con contenido, los nombres citados existen, "llama a" coincide con el
 * grafo, y la predicción (si es de una función exportada) se ejecuta. Si pasa, refresca la huella.
 */
export async function verificarTarjeta(root: string, m: string): Promise<{ ok: boolean; motivos: string[] }> {
  const f = archivoTarjeta(root, m);
  if (!fs.existsSync(f)) throw new Error(`no hay tarjeta de ${m}: \`cai mapa --tarjeta ${m}\``);
  const md = fs.readFileSync(f, "utf8").replace(/<!--[\s\S]*?-->/g, "");
  const sec = (t: string) => new RegExp(`^##\\s+${t}\\s*\\n([\\s\\S]*?)(?=^##\\s|$(?![\\s\\S]))`, "m").exec(md)?.[1]?.trim() ?? "";
  const motivos: string[] = [];
  for (const s of ["Propósito", "Invariantes", "Llama a", "Predicción"]) if (conContenido(sec(s)).length < 2) motivos.push(`completa «${s}»`);
  const idx = leerIndice(root);
  const nombres = new Set(Object.values(idx.archivos).flatMap((a) => a.funciones.map((x) => x.nombre)));
  const citados = referencias(sec("Llama a")).concat((sec("Llama a").match(/\b[A-Za-z_]\w{2,}\b/g) ?? []).filter((w) => /[A-Z_]/.test(w.slice(1))));
  const inexistentes = [...new Set(citados)].filter((c) => !nombres.has(c) && !/[/.]/.test(c));
  if (inexistentes.length) motivos.push(`no existen en el proyecto: ${inexistentes.join(", ")}`);
  const propias = Object.entries(idx.archivos).filter(([r]) => modulo(r) === m).flatMap(([, a]) => a.funciones);
  const reales = new Set(propias.flatMap((x) => x.llama).filter((n) => !propias.some((p) => p.nombre === n)));
  const dice = new Set([...new Set(citados)].filter((c) => nombres.has(c)));
  const faltan = [...reales].filter((r) => !dice.has(r));
  if (faltan.length && dice.size) motivos.push(`según el grafo también llama a: ${faltan.slice(0, 6).join(", ")}`);
  // La predicción se EJECUTA (no se le cree a la tarjeta: se comprueba).
  const pred = partirCriterio(sec("Predicción").split("\n").find((l) => l.trim()) ?? "");
  if (!pred) motivos.push("la predicción tiene que ser una llamada y su resultado: `f(1, 2) → 3`");
  else {
    const nombre = raizDeLlamada(pred.llamada);
    const archivo = Object.entries(idx.archivos).find(([r, a]) => modulo(r) === m && a.funciones.some((x) => x.nombre === nombre))?.[0];
    if (!archivo) motivos.push(`la predicción llama a ${nombre}, que no está en el módulo ${m}`);
    else {
      const r = await ejecutarLlamada(root, archivo, pred.llamada);
      if (r.infra) motivos.push(`no pude ejecutar la predicción: ${r.error}`);
      else if (!coincide(pred.esperado, r)) motivos.push(`tu predicción falló: ${pred.llamada} da ${r.ok ? JSON.stringify(r.valor) : r.error}, no ${pred.esperado} (relee el módulo)`);
    }
  }
  if (!motivos.length) fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/^huella:\s*\w+/m, `huella: ${huellaModulo(root, m)}`));
  return { ok: !motivos.length, motivos };
}

export function tarjetasCaducas(root: string): string[] {
  if (!fs.existsSync(dirTarjetas(root))) return [];
  return fs
    .readdirSync(dirTarjetas(root))
    .filter((x) => x.endsWith(".md"))
    .map((x) => /^modulo:\s*(.+)$/m.exec(fs.readFileSync(path.join(dirTarjetas(root), x), "utf8"))?.[1]?.trim() ?? "")
    .filter((m) => m && !tarjetaVigente(root, m));
}

// --- Recorrido ---------------------------------------------------------------------------------------------------

export interface Parada {
  n: number;
  id: string;
  archivo: string;
  nombre: string;
  firma: string;
  riesgo: number;
}

const archivoRecorrido = (root: string) => path.join(dataDir(root), "cache", "recorrido.json");

/** Paradas: lo más central y riesgoso primero; con `hacia`, lo que lleva a ese archivo. */
export function recorrido(root: string, o: { hacia?: string; max?: number } = {}): Parada[] {
  const idx = leerIndice(root);
  let ns = nodos(root, idx).filter((n) => n.riesgo > 0);
  if (o.hacia) {
    const objetivo = new Set(Object.entries(idx.archivos).filter(([r]) => r.startsWith(o.hacia!)).flatMap(([r, a]) => a.funciones.map((f) => `${r}#${f.clave}`)));
    ns = ns.filter((n) => objetivo.has(n.id) || n.archivo.startsWith(o.hacia!));
  }
  const entradas = (id: string): EntradaIndice | undefined => {
    const [r, k] = id.split("#");
    return idx.archivos[r!]?.funciones.find((f) => f.clave === k);
  };
  const paradas = ns
    .sort((a, b) => b.riesgo - a.riesgo || b.centralidad - a.centralidad)
    .slice(0, o.max ?? 5)
    .map((n, i) => ({ n: i + 1, id: n.id, archivo: n.archivo, nombre: n.nombre, firma: entradas(n.id)?.firma ?? n.nombre, riesgo: n.riesgo }));
  fs.mkdirSync(path.dirname(archivoRecorrido(root)), { recursive: true });
  fs.writeFileSync(archivoRecorrido(root), JSON.stringify({ paradas, hipotesis: {} }));
  return paradas;
}

interface EstadoRecorrido {
  paradas: Parada[];
  hipotesis: Record<number, { tuya: string; ia?: string }>;
}
const leerRecorrido = (root: string): EstadoRecorrido => {
  try {
    return JSON.parse(fs.readFileSync(archivoRecorrido(root), "utf8")) as EstadoRecorrido;
  } catch {
    throw new Error("primero arma el recorrido: `cai mapa --recorrido`");
  }
};

/** Paso 1: tu hipótesis (viste solo el nombre y la firma). Paso 2: la IA explica. Devuelve su explicación. */
export async function hipotesisParada(root: string, n: number, tuya: string): Promise<{ ia: string; codigo: string }> {
  if (conContenido(tuya).length < 4) throw new Error("di qué crees que hace (una oración con contenido), antes de leerla");
  const e = leerRecorrido(root);
  const p = e.paradas.find((x) => x.n === n);
  if (!p) throw new Error(`no hay parada ${n}`);
  const idx = leerIndice(root);
  const f = idx.archivos[p.archivo]?.funciones.find((x) => `${p.archivo}#${x.clave}` === p.id);
  const src = fs.readFileSync(path.join(root, p.archivo), "utf8").split(/\r?\n/);
  const codigo = f ? src.slice(f.linea - 1, f.linea - 1 + f.lineas).join("\n") : "";
  const r = await consultarRol<{ explicacion: string }>(loadConfig(root), "explicar", {
    kind: "mapa:recorrido",
    system: "Explicas qué hace una función de un proyecto que el programador está conociendo: propósito, entradas y salidas, efectos, casos especiales y con qué se conecta. Concreto, sin código. Es una HIPÓTESIS para que él la contraste.",
    prompt: comoDato("codigo", codigo),
    schema: { type: "object", required: ["explicacion"], properties: { explicacion: { type: "string" } } },
    cwd: root,
  });
  e.hipotesis[n] = { tuya, ia: r.data.explicacion };
  fs.writeFileSync(archivoRecorrido(root), JSON.stringify(e));
  return { ia: r.data.explicacion, codigo };
}

/** Paso 3: escribes la diferencia entre tu hipótesis y lo que hace (con tus palabras) → evidencia de nivel 2. */
export function diferenciaParada(root: string, n: number, diferencia: string): { ok: boolean; mensaje: string } {
  const e = leerRecorrido(root);
  const h = e.hipotesis[n];
  const p = e.paradas.find((x) => x.n === n);
  if (!p || !h?.ia) throw new Error(`primero tu hipótesis de la parada ${n}: \`cai mapa --parada ${n} --hipotesis "…"\``);
  if (conContenido(diferencia).length < 5) return { ok: false, mensaje: "escribe la diferencia: qué acertaste, qué no y qué te sorprendió (con tus palabras)" };
  if (copiado(diferencia, h.ia, 5) >= 0.3) return { ok: false, mensaje: "eso está copiado de la explicación de la IA: dilo con tus palabras" };
  const idx = leerIndice(root);
  const f = idx.archivos[p.archivo]?.funciones.find((x) => `${p.archivo}#${x.clave}` === p.id);
  const contenido = fs.readFileSync(path.join(root, p.archivo), "utf8");
  asentar(root, p.archivo, contenido, { origen: "humano" });
  const reg = cargarRegistro(root, p.archivo);
  const indices = f ? Array.from({ length: f.lineas }, (_, i) => f.linea - 1 + i) : [];
  const ev = guardarEvidencia(root, { tipo: "explicacion", archivo: p.archivo, funcion: p.nombre, huellas: indices.map((i) => reg?.lineas[i]?.h ?? ""), persona: miEmail(root), texto: `hipótesis: ${h.tuya} | diferencia: ${diferencia}`, resultado: h.ia, ok: true });
  registrarRevision(root, p.archivo, contenido, indices, 2, ev.id);
  const acerto = similitud(h.tuya, h.ia);
  return { ok: true, mensaje: `✔ ${p.nombre}: queda entendida (nivel 2). Tu hipótesis coincidía ${acerto > 0.3 ? "bastante" : acerto > 0.15 ? "en parte" : "poco"} con lo que hace.` };
}

// --- Traza real (VI.2: rastreo de datos) --------------------------------------------------------------------

/**
 * Predices el camino de llamadas desde una entrada y se EJECUTA con la cobertura de V8 (instrumentación real,
 * sin IA): qué funciones del proyecto corrieron de verdad. Se compara con tu predicción.
 */
export function trazaReal(root: string, rel: string, expresion: string, prediccion: string[]): { corrieron: string[]; acertaste: string[]; noCorrieron: string[]; sorpresa: string[]; resultado: string } {
  const lang = langForMapa(rel);
  if (!lang || !["typescript", "javascript", "tsx"].includes(lang.id)) throw new Error("la traza real funciona con JavaScript/TypeScript");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cai-traza-"));
  try {
    const raiz = /^([A-Za-z_$][\w$]*)/.exec(expresion.trim())?.[1] ?? "";
    const r = ejecutarParaTraza(root, rel, lang.id, { funcion: raiz, expresion }, { cobertura: dir });
    if (r.infra) throw new Error(r.error ?? "no se pudo ejecutar");
    const corrieron = new Set<string>();
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      const cov = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as { result: { url: string; functions: { functionName: string; ranges: { count: number }[] }[] }[] };
      for (const s of cov.result) {
        if (!s.url.startsWith("file://") || s.url.includes("node_modules") || s.url.includes("/.cai/") || !s.url.includes(root)) continue;
        for (const fn of s.functions) if (fn.functionName && fn.ranges[0] && fn.ranges[0].count > 0) corrieron.add(fn.functionName);
      }
    }
    const pred = new Set(prediccion.map((x) => x.trim()).filter(Boolean));
    const lista = [...corrieron];
    return { corrieron: lista, acertaste: lista.filter((x) => pred.has(x)), noCorrieron: [...pred].filter((x) => !corrieron.has(x)), sorpresa: lista.filter((x) => !pred.has(x)), resultado: r.ok ? JSON.stringify(r.valor) : `error: ${r.error}` };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
