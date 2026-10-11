/**
 * INFORMES: "¿qué código no revisó un humano?" y cómo vas (manifiesto I.3, II.1, II.4, II.5).
 *
 *   sinRevisar   por archivo y función: líneas por origen, revisadas, ordenadas por riesgo
 *   semana       tareas, tiempo por etapa, código tuyo/IA/herramienta, autonomía por dominio, calibración,
 *                retrabajo, atajos cognitivos, logros propios, pendientes (reconstrucción, repaso, pedidos)
 *   adoptar      clasifica un proyecto existente con git blame (tuyo / heredado / IA previa)
 */
import fs from "node:fs";
import path from "node:path";
import { makeZoner } from "../proyecto/config.js";
import { listFiles } from "../proyecto/files.js";
import { langFor } from "../nucleo/lang.js";
import { leerIndice } from "../proyecto/indice.js";
import { leerUso } from "../ia/llm.js";
import { loadPerfil } from "../proyecto/profile.js";
import { asentar, cargarRegistro, contar, listarRegistros, miEmail, NECESITAN_EVIDENCIA, AJENOS, type Origen } from "../proyecto/procedencia.js";
import { cargarLogros, cargarPractica, porRepasar, resumenCalibracion, cargarLicencias, ultimaReconstruccion } from "../proyecto/expediente.js";
import { listarPedidos, listarTareas, rastroPedido, temasSinDestino, sesionDeHoy } from "../proyecto/tareas.js";
import { nodos, tarjetasCaducas } from "./mapa.js";
import { reconstruccionAtrasada } from "./tarea.js";

export interface FilaSinRevisar {
  archivo: string;
  funcion: string;
  lineas: number;
  origen: Origen;
  riesgo: number;
}

/** Lo que no revisó un humano (o no revisaste TÚ, con `soloYo`), ordenado por riesgo. */
export function sinRevisar(root: string, o: { soloYo?: boolean; incluirAjeno?: boolean } = {}): { filas: FilaSinRevisar[]; resumen: string[] } {
  const yo = o.soloYo ? miEmail(root) : undefined;
  const idx = leerIndice(root);
  const riesgo = new Map(nodos(root, idx).map((n) => [n.id, n.riesgo]));
  const filas: FilaSinRevisar[] = [];
  const regs = listarRegistros(root);
  for (const reg of regs) {
    const fs_ = idx.archivos[reg.archivo]?.funciones ?? [];
    const cuenta = new Map<string, { n: number; o: Origen; id: string }>();
    reg.lineas.forEach((l, i) => {
      const pend = (NECESITAN_EVIDENCIA.has(l.o) || (o.incluirAjeno && AJENOS.has(l.o))) && (l.n < 2 || (yo && !(l.p ?? []).includes(yo)));
      if (!pend) return;
      const f = fs_.find((x) => i + 1 >= x.linea && i + 1 < x.linea + x.lineas);
      const k = f ? f.nombre : "(fuera de funciones)";
      const c = cuenta.get(k) ?? { n: 0, o: l.o, id: f ? `${reg.archivo}#${f.clave}` : "" };
      c.n++;
      cuenta.set(k, c);
    });
    for (const [funcion, c] of cuenta) filas.push({ archivo: reg.archivo, funcion, lineas: c.n, origen: c.o, riesgo: (riesgo.get(c.id) ?? 0) + (makeZoner(root).isCritical(path.join(root, reg.archivo)) ? 5 : 0) });
  }
  filas.sort((a, b) => b.riesgo - a.riesgo || b.lineas - a.lineas);
  const c = contar(regs, yo);
  const fmt = (x?: { lineas: number; revisadas: number }) => (x ? `${x.lineas} (${x.revisadas} revisadas)` : "0");
  const resumen = [
    `Líneas: ${c.total} · tuyas ${fmt(c.porOrigen.humano)} · IA ${fmt(c.porOrigen.ia)} · pegado ${fmt(c.porOrigen.pegado)} · ia-probable ${fmt(c.porOrigen["ia-probable"])} · desconocido ${fmt(c.porOrigen.desconocido)}`,
    `Ajeno: heredado ${fmt(c.porOrigen.heredado)} · IA previa ${fmt(c.porOrigen["ia-previa"])} · tuyo previo ${fmt(c.porOrigen["previo-propio"])} · herramienta ${c.porOrigen.herramienta?.lineas ?? 0} · snippets ${c.porOrigen.snippet?.lineas ?? 0}`,
    `Sin revisar por ${yo ? "ti" : "un humano"} (IA, pegado, desconocido): ${c.sinRevisar} líneas · cobertura de comprensión de lo que no escribiste: ${Math.round(c.cobertura * 100)}%`,
  ];
  if (!regs.length) resumen.push("Todavía no hay procedencia registrada: `cai adoptar` clasifica el proyecto con git.");
  return { filas, resumen };
}

/** `cai adoptar`: clasifica todos los archivos de código con git blame (empieza todo en nivel 0). */
export function adoptar(root: string): { archivos: number; resumen: string[] } {
  const z = makeZoner(root);
  let n = 0;
  for (const rel of listFiles(z)) {
    if (!langFor(rel) || rel.startsWith(".cai/") || z.zoneOf(path.join(root, rel)) === "protegida") continue;
    if (cargarRegistro(root, rel)) continue;
    asentar(root, rel, fs.readFileSync(path.join(root, rel), "utf8"), { origen: "humano" });
    n++;
  }
  return { archivos: n, resumen: sinRevisar(root, { incluirAjeno: true }).resumen };
}

// --- Informe semanal ---------------------------------------------------------------------------------------------

export function informeSemana(root: string): string[] {
  const semana = Date.now() - 7 * 86400_000;
  const ts = listarTareas(root);
  const cerradas = ts.filter((t) => t.estado === "cerrada" && Date.parse(t.actualizada) >= semana);
  const out: string[] = [];
  const dur = (t: (typeof ts)[number]) => (Date.parse(t.actualizada) - Date.parse(t.creada)) / 60000;
  const medio = cerradas.length ? Math.round(cerradas.reduce((a, t) => a + dur(t), 0) / cerradas.length) : 0;
  out.push(`Tareas cerradas: ${cerradas.length} (${cerradas.filter((t) => t.intencion === "producir").length} producir · ${cerradas.filter((t) => t.intencion === "aprender").length} aprender) · tiempo medio ${medio} min`);
  // Tiempo por etapa (desde el historial de transiciones).
  const etapas = new Map<string, number[]>();
  for (const t of cerradas)
    t.historial.forEach((h, i) => {
      const prev = i ? Date.parse(t.historial[i - 1]!.cuando) : Date.parse(t.creada);
      etapas.set(h.de, [...(etapas.get(h.de) ?? []), (Date.parse(h.cuando) - prev) / 60000]);
    });
  if (etapas.size) out.push(`Tiempo por etapa (min): ${[...etapas].map(([e, xs]) => `${e} ${Math.round(xs.reduce((a, b) => a + b, 0) / xs.length)}`).join(" · ")}`);
  const regs = listarRegistros(root);
  const c = contar(regs);
  out.push(`Código: tuyo ${c.porOrigen.humano?.lineas ?? 0} · IA ${c.porOrigen.ia?.lineas ?? 0} (${Math.round((100 * (c.porOrigen.ia?.revisadas ?? 0)) / Math.max(1, c.porOrigen.ia?.lineas ?? 0))}% con evidencia) · herramienta ${c.porOrigen.herramienta?.lineas ?? 0} · pegado ${c.porOrigen.pegado?.lineas ?? 0}`);
  // Autonomía por dominio.
  const perfil = loadPerfil();
  const ls = Object.values(cargarLicencias());
  const nuevas = ls.filter((l) => Date.parse(l.ganada) >= semana && !l.revocada);
  const revocadas = ls.filter((l) => l.revocada && Date.parse(l.revocada.cuando) >= semana);
  out.push(`Autonomía: ${Object.entries(perfil.temas).map(([t, v]) => `${t} ${Math.round(v.puntaje * 100)}%`).join(" · ") || "(sin datos)"} · licencias nuevas ${nuevas.length}${nuevas.length ? ` (${nuevas.map((l) => l.id).join(", ")})` : ""}${revocadas.length ? ` · revocadas ${revocadas.map((l) => l.id).join(", ")}` : ""}`);
  const cal = resumenCalibracion();
  const calTxt = Object.entries(cal).filter(([, v]) => v.seguro).map(([d, v]) => `${d}: dijiste "seguro" ${v.seguro} veces y acertaste ${v.aciertoSeguro}`);
  if (calTxt.length) out.push(`Calibración: ${calTxt.join(" · ")}`);
  const retrabajo = cerradas.reduce((a, t) => a + t.historial.filter((h) => h.a === "ejecutando" && h.de !== "aprobada").length, 0);
  out.push(`Retrabajo: ${retrabajo} vuelta(s) a ejecutar · desconexiones: ${ts.filter((t) => t.historial.some((h) => h.a === "desconectada" && Date.parse(h.cuando) >= semana)).length}`);
  // Atajos cognitivos (II.5): % de IA en tareas producir sin revisar por dominio.
  const uso = leerUso(7);
  const costo = uso.reduce((a, u) => a + (u.costo ?? 0), 0);
  out.push(`IA: ${uso.filter((u) => u.tipo === "llamada").length} llamadas · US$${costo.toFixed(2)} · ${uso.filter((u) => u.tipo === "evitada").length} evitadas`);
  const logros = cargarLogros().filter((l) => Date.parse(l.fecha) >= semana);
  if (logros.length) out.push(`Logros propios: ${logros.map((l) => `${l.que} (${l.porque})`).join(" · ")}`);
  // Pendientes.
  const pend: string[] = [];
  if (reconstruccionAtrasada(root)) pend.push("reconstrucción semanal atrasada (`cai reconstruir`)");
  else if (!ultimaReconstruccion()) pend.push("reconstrucción semanal: todavía ninguna");
  const rep = porRepasar();
  if (rep.length) pend.push(`licencias por repasar: ${rep.map((l) => l.id).join(", ")}`);
  const prac = cargarPractica().filter((p) => p.tipo === "repaso" && Date.parse(p.fecha) >= semana);
  pend.push(`repasos esta semana: ${prac.length}`);
  for (const p of listarPedidos(root)) if (temasSinDestino(p).length || rastroPedido(root, p).some((x) => /sin empezar|sin tarea/.test(x))) pend.push(`pedido ${p.id}: ${rastroPedido(root, p).filter((x) => /sin empezar|sin tarea|borrador/.test(x)).join(" · ")}`);
  const cad = tarjetasCaducas(root);
  if (cad.length) pend.push(`tarjetas caducas: ${cad.join(", ")}`);
  out.push(`Pendiente: ${pend.join(" · ")}`);
  return out;
}

/** `cai hoy`: tu foco, lo que quedó de ayer y lo olvidado. */
export function hoy(root: string): string[] {
  const s = sesionDeHoy(root);
  const out = [s ? `Foco de hoy: ${s.foco}${s.tareas.length ? ` (${s.tareas.join(", ")})` : ""}` : "Hoy todavía no dijiste qué buscas: `cai hoy --foco \"…\"` (una frase, o ids de tareas)"];
  const ts = listarTareas(root).filter((t) => !["cerrada", "descartada"].includes(t.estado));
  if (ts.length) out.push(`Tareas activas: ${ts.map((t) => `${t.id} ${t.estado}`).join(" · ")}`);
  for (const p of listarPedidos(root)) {
    const r = rastroPedido(root, p).filter((x) => /sin empezar|sin tarea/.test(x));
    if (r.length) out.push(`Pedido ${p.id}: ${r.join(" · ")}`);
  }
  return out;
}
