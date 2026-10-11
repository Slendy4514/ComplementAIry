/**
 * EXPEDIENTE DEL PROGRAMADOR (global, entre proyectos): ~/.cai/expediente/. Todo sale de EVIDENCIA, sin IA.
 *
 *   licencias.json     construcciones que dominas (I.6): las escribiste a mano y quedaron en verde, o hiciste la kata
 *   calibracion.json   qué tan seguro dijiste estar vs. si acertaste (II.2: ilusión de competencia)
 *   proyectos.json     cada proyecto: stack, % tuyo, dominios, licencias ganadas ahí, qué aprendiste
 *   practica.json      katas, repasos y reconstrucciones
 *   logros.json        lo que resolviste por tu cuenta después de trabarte (II.4), sobrio
 * El nivel por dominio es el perfil de siempre (~/.cai/perfil.json, ajustado por eventos).
 *
 * Decaimiento: una licencia sin usar en `SEMANAS_VIGENCIA` semanas queda "por repasar" (no vigente) y una
 * predicción fallida sobre esa construcción la revoca hasta otra kata.
 */
import fs from "node:fs";
import path from "node:path";
import { escribirJson, leerJson } from "./almacen.js";
import { conCandadoSync } from "./ocupado.js";
import { home, loadPerfil } from "./profile.js";
import { describir, SIN_LICENCIA } from "../nucleo/construcciones.js";

export const SEMANAS_VIGENCIA = 8;
const dir = () => path.join(home(), "expediente");
const archivo = (n: string) => path.join(dir(), `${n}.json`);

export interface Licencia {
  id: string;
  ganada: string;
  ultimoUso: string;
  origen: "codigo" | "kata" | "reconstruccion";
  proyecto: string;
  /** Dónde la ganaste (archivo#función o kata). */
  donde: string;
  revocada?: { cuando: string; motivo: string };
}

export interface Calibracion {
  fecha: string;
  seguridad: number;
  acierto: boolean;
  dominio: string;
  proyecto: string;
}

export interface ProyectoExp {
  ruta: string;
  nombre: string;
  stack: string[];
  desde: string;
  ultima: string;
  lineasTuyas: number;
  lineasIa: number;
  dominios: string[];
  licenciasGanadas: string[];
  aprendido: string[];
}

export interface Practica {
  fecha: string;
  tipo: "kata" | "repaso" | "reconstruccion";
  que: string;
  ok: boolean;
  proyecto: string;
  nota?: string;
  segundos?: number;
}

export interface Logro {
  fecha: string;
  proyecto: string;
  que: string;
  /** Por qué cuenta: fallos previos, gate en rojo, desconexión de la IA… */
  porque: string;
}

const leer = <T>(n: string, d: () => T) => leerJson<T>(archivo(n), d);
const escribir = (n: string, v: unknown) => escribirJson(archivo(n), v);
const conArchivo = <T>(n: string, d: () => T, f: (v: T) => T): T => conCandadoSync(archivo(n), () => {
  const v = f(leer(n, d));
  escribir(n, v);
  return v;
});

// --- Licencias ---------------------------------------------------------------------------------------------

export const cargarLicencias = () => leer<Record<string, Licencia>>("licencias", () => ({}));

export function vigente(l: Licencia | undefined, ahora = Date.now()): boolean {
  if (!l || l.revocada) return false;
  return ahora - Date.parse(l.ultimoUso) <= SEMANAS_VIGENCIA * 7 * 86400_000;
}

/** Las construcciones que la IA quiere escribir y que no tienes vigentes. */
export function licenciasFaltantes(construcciones: Iterable<string>): string[] {
  const ls = cargarLicencias();
  return [...construcciones].filter((c) => !SIN_LICENCIA.has(c) && !vigente(ls[c])).sort();
}

/** Ganas (o renuevas) licencias: escribiste esas construcciones a mano y quedaron en verde, o hiciste la kata. */
export function ganarLicencias(ids: Iterable<string>, origen: Licencia["origen"], proyecto: string, donde: string): string[] {
  const nuevas: string[] = [];
  conArchivo("licencias", () => ({}) as Record<string, Licencia>, (ls) => {
    const ahora = new Date().toISOString();
    for (const id of ids) {
      if (SIN_LICENCIA.has(id)) continue;
      const ya = ls[id];
      if (!ya || ya.revocada) nuevas.push(id);
      ls[id] = { id, ganada: ya && !ya.revocada ? ya.ganada : ahora, ultimoUso: ahora, origen: ya && !ya.revocada ? ya.origen : origen, proyecto, donde };
    }
    return ls;
  });
  if (nuevas.length) registrarEnProyecto(proyecto, (p) => ({ ...p, licenciasGanadas: [...new Set([...p.licenciasGanadas, ...nuevas])] }));
  return nuevas;
}

/** Usar una licencia (la IA la usó en una tarea que revisaste) la mantiene vigente. */
export function usarLicencias(ids: Iterable<string>): void {
  conArchivo("licencias", () => ({}) as Record<string, Licencia>, (ls) => {
    const ahora = new Date().toISOString();
    for (const id of ids) if (ls[id] && !ls[id].revocada) ls[id].ultimoUso = ahora;
    return ls;
  });
}

export function revocarLicencia(id: string, motivo: string): void {
  conArchivo("licencias", () => ({}) as Record<string, Licencia>, (ls) => {
    if (ls[id]) ls[id] = { ...ls[id], revocada: { cuando: new Date().toISOString(), motivo } };
    return ls;
  });
}

/** Licencias por repasar (vencidas por no usarlas), para `cai repaso`. */
export function porRepasar(): Licencia[] {
  return Object.values(cargarLicencias()).filter((l) => !l.revocada && !vigente(l));
}

// --- Calibración --------------------------------------------------------------------------------------------

export function registrarCalibracion(c: Omit<Calibracion, "fecha">): void {
  conArchivo("calibracion", () => [] as Calibracion[], (cs) => [...cs.slice(-999), { fecha: new Date().toISOString(), ...c }]);
}

/** Por dominio: cuántas veces dijiste estar seguro (4–5) y cuántas acertaste. */
export function resumenCalibracion(): Record<string, { seguro: number; aciertoSeguro: number; total: number; aciertos: number }> {
  const out: Record<string, { seguro: number; aciertoSeguro: number; total: number; aciertos: number }> = {};
  for (const c of leer<Calibracion[]>("calibracion", () => [])) {
    const d = (out[c.dominio] ??= { seguro: 0, aciertoSeguro: 0, total: 0, aciertos: 0 });
    d.total++;
    if (c.acierto) d.aciertos++;
    if (c.seguridad >= 4) {
      d.seguro++;
      if (c.acierto) d.aciertoSeguro++;
    }
  }
  return out;
}

/** ¿Te sobreestimas en este dominio? (dijiste "seguro" y acertaste menos del 70 %, con al menos 5 casos). */
export function sobreconfiado(dominio: string): boolean {
  const d = resumenCalibracion()[dominio];
  return !!d && d.seguro >= 5 && d.aciertoSeguro / d.seguro < 0.7;
}

// --- Proyectos, práctica y logros ----------------------------------------------------------------------------

export const cargarProyectos = () => leer<Record<string, ProyectoExp>>("proyectos", () => ({}));

export function registrarEnProyecto(ruta: string, f: (p: ProyectoExp) => ProyectoExp): ProyectoExp {
  return conArchivo("proyectos", () => ({}) as Record<string, ProyectoExp>, (ps) => {
    const ahora = new Date().toISOString();
    const base: ProyectoExp = ps[ruta] ?? { ruta, nombre: path.basename(ruta), stack: [], desde: ahora, ultima: ahora, lineasTuyas: 0, lineasIa: 0, dominios: [], licenciasGanadas: [], aprendido: [] };
    ps[ruta] = { ...f(base), ultima: ahora };
    return ps;
  })[ruta]!;
}

export function registrarPractica(p: Omit<Practica, "fecha">): void {
  conArchivo("practica", () => [] as Practica[], (ps) => [...ps.slice(-1999), { fecha: new Date().toISOString(), ...p }]);
}

export const cargarPractica = () => leer<Practica[]>("practica", () => []);

export function registrarLogro(l: Omit<Logro, "fecha">): void {
  conArchivo("logros", () => [] as Logro[], (ls) => [...ls.slice(-499), { fecha: new Date().toISOString(), ...l }]);
}

export const cargarLogros = () => leer<Logro[]>("logros", () => []);

/** Última reconstrucción semanal (en cualquier proyecto). */
export function ultimaReconstruccion(): string | null {
  const r = cargarPractica().filter((p) => p.tipo === "reconstruccion" && p.ok);
  return r.length ? r[r.length - 1]!.fecha : null;
}

// --- Vista (`cai yo`), exportar e importar ---------------------------------------------------------------------

export function resumenExpediente(): string[] {
  const out: string[] = [];
  const perfil = loadPerfil();
  const temas = Object.entries(perfil.temas ?? {}).sort((a, b) => b[1].puntaje - a[1].puntaje);
  if (temas.length) out.push(`Dominios: ${temas.map(([t, v]) => `${t} ${(v.puntaje * 100).toFixed(0)}%${sobreconfiado(t) ? " (te sobreestimas)" : ""}`).join(" · ")}`);
  const ls = Object.values(cargarLicencias());
  const vig = ls.filter((l) => vigente(l));
  out.push(`Licencias vigentes: ${vig.length}${vig.length ? ` (${vig.slice(0, 12).map((l) => l.id).join(", ")}${vig.length > 12 ? "…" : ""})` : ""}`);
  const rep = porRepasar();
  if (rep.length) out.push(`Por repasar: ${rep.map((l) => `${l.id} — ${describir(l.id)}`).join("; ")}`);
  const rev = ls.filter((l) => l.revocada);
  if (rev.length) out.push(`Revocadas (kata pendiente): ${rev.map((l) => `${l.id} (${l.revocada!.motivo})`).join("; ")}`);
  const ps = Object.values(cargarProyectos());
  if (ps.length) out.push(`Proyectos (${ps.length}): ${ps.map((p) => `${p.nombre}${p.stack.length ? ` [${p.stack.join(", ")}]` : ""} ${p.lineasTuyas + p.lineasIa ? `${Math.round((100 * p.lineasTuyas) / (p.lineasTuyas + p.lineasIa))}% tuyo` : ""}`).join(" · ")}`);
  const pr = cargarPractica();
  const ult = ultimaReconstruccion();
  out.push(`Práctica: ${pr.filter((p) => p.tipo === "kata").length} katas · ${pr.filter((p) => p.tipo === "repaso").length} repasos · última reconstrucción: ${ult ? ult.slice(0, 10) : "nunca"}`);
  const lg = cargarLogros().slice(-3);
  if (lg.length) out.push(`Logros recientes: ${lg.map((l) => l.que).join(" · ")}`);
  return out;
}

const PARTES = ["licencias", "calibracion", "proyectos", "practica", "logros"];

export function exportarExpediente(destino: string): void {
  const datos: Record<string, unknown> = { version: 1, exportado: new Date().toISOString(), perfil: loadPerfil() };
  for (const p of PARTES) datos[p] = leer(p, () => null);
  fs.writeFileSync(destino, JSON.stringify(datos, null, 2));
}

/** Importa un expediente: une (no pisa) licencias y listas; lo más reciente gana. */
export function importarExpediente(origen: string): void {
  const datos = JSON.parse(fs.readFileSync(origen, "utf8")) as Record<string, unknown>;
  if (datos.version !== 1) throw new Error("el archivo no es un expediente de ComplementAIry (version 1)");
  conArchivo("licencias", () => ({}) as Record<string, Licencia>, (ls) => {
    for (const [k, v] of Object.entries((datos.licencias ?? {}) as Record<string, Licencia>)) if (!ls[k] || Date.parse(v.ultimoUso) > Date.parse(ls[k].ultimoUso)) ls[k] = v;
    return ls;
  });
  for (const p of ["calibracion", "practica", "logros"]) conArchivo(p, () => [] as { fecha: string }[], (xs) => {
    const ya = new Set(xs.map((x) => JSON.stringify(x)));
    return [...xs, ...((datos[p] ?? []) as { fecha: string }[]).filter((x) => !ya.has(JSON.stringify(x)))].sort((a, b) => a.fecha.localeCompare(b.fecha));
  });
  conArchivo("proyectos", () => ({}) as Record<string, ProyectoExp>, (ps) => ({ ...((datos.proyectos ?? {}) as Record<string, ProyectoExp>), ...ps }));
}
