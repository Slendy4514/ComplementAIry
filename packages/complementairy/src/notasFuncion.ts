import { parse } from "./comments.js";
import type { LangSpec } from "./lang.js";
import { medir, type Funcion } from "./metricas.js";
import { mensaje, nuevaNota, type Nota } from "./notas.js";

/**
 * Una nota por función (y una por archivo para lo que está fuera de funciones). Todo lo que se
 * dice de una función se agrega al hilo de SU nota en vez de crear otra: sin duplicados.
 * Se decide sin IA, con el árbol de sintaxis.
 */

export const ARCHIVO = "__archivo__";

export async function funcionesDe(src: string, lang: LangSpec | null): Promise<Funcion[]> {
  if (!lang) return [];
  try {
    return medir(src, await parse(src, lang)).funciones;
  } catch {
    return [];
  }
}

/** La función más interna que contiene la línea (1-based). */
export function funcionEn(funciones: Funcion[], linea: number): Funcion | undefined {
  return funciones.filter((f) => f.linea <= linea && linea < f.linea + f.lineas).sort((a, b) => a.lineas - b.lineas)[0];
}

/**
 * Clave de una función: su nombre, o "nombre#k" si hay varias con el mismo nombre (dos `render` en
 * clases distintas, dos `constructor`): cada una tiene SU nota.
 */
export function claveFuncion(funciones: Funcion[], f: Funcion): string {
  const mismos = funciones.filter((x) => x.nombre === f.nombre).sort((a, b) => a.linea - b.linea);
  return mismos.length > 1 ? `${f.nombre}#${mismos.indexOf(f) + 1}` : f.nombre;
}

export const nombreDeClave = (clave: string) => clave.replace(/#\d+$/, "");

export function funcionPorClave(funciones: Funcion[], clave: string): Funcion | undefined {
  return funciones.find((f) => claveFuncion(funciones, f) === clave) ?? (clave.includes("#") ? undefined : funciones.find((f) => f.nombre === clave));
}

/** A qué nota pertenece algo: la clave de su función, o ARCHIVO. */
export function claveDe(funciones: Funcion[], o: { linea: number; funcion?: string | undefined; alcance?: "archivo" | undefined }): string {
  if (o.alcance === "archivo") return ARCHIVO;
  const porNombre = o.funcion ? funcionPorClave(funciones, o.funcion) : undefined;
  if (porNombre) return claveFuncion(funciones, porNombre);
  const f = funcionEn(funciones, o.linea);
  return f ? claveFuncion(funciones, f) : (o.funcion ?? ARCHIVO);
}

/** Los @ia? respondidos de una nota (incluye el formato viejo: fuente + turnos). */
export function fuentesDe(n: Nota): Record<string, number> {
  return { ...(n.fuente ? { [n.fuente]: n.turnos ?? 1 } : {}), ...n.fuentes };
}

const fusionable = (n: Nota) => n.estado === "abierta" && !n.prediccion;
const claveNota = (funciones: Funcion[], n: Nota) => claveDe(funciones, { linea: n.ancla.linea, funcion: n.ancla.funcion, alcance: n.alcance });

/** Ubica la nota en la firma de su función (o arriba si es del archivo). */
function anclar(n: Nota, clave: string, funciones: Funcion[], lineas: string[]): void {
  if (clave === ARCHIVO) {
    n.alcance = "archivo";
    n.ancla = { linea: 1, texto: (lineas[0] ?? "").trim() };
    return;
  }
  const f = funcionPorClave(funciones, clave);
  if (f) n.ancla = { linea: f.linea, texto: (lineas[f.linea - 1] ?? "").trim(), funcion: clave };
  else n.ancla = { ...n.ancla, funcion: clave };
}

/** Fusiona las notas abiertas de una misma función en la más vieja (migra lo que ya había). */
export function consolidar(notas: Nota[], funciones: Funcion[], src: string): { notas: Nota[]; fusionadas: number; destino: Map<string, string> } {
  const lineas = src.split(/\r?\n/);
  const grupos = new Map<string, Nota[]>();
  for (const n of notas.filter(fusionable)) {
    const k = claveNota(funciones, n);
    grupos.set(k, [...(grupos.get(k) ?? []), n]);
  }
  const quitar = new Set<string>();
  const destino = new Map<string, string>(); // id fusionado → id de la nota que lo recibió
  for (const [k, g] of grupos) {
    g.sort((a, b) => a.creada.localeCompare(b.creada));
    const base = g[0]!;
    for (const otra of g.slice(1)) {
      for (const m of otra.hilo) if (!base.hilo.some((x) => x.quien === m.quien && x.fecha === m.fecha && x.texto === m.texto)) base.hilo.push(m);
      for (const s of otra.snippets) if (!base.snippets.some((x) => x.llamada === s.llamada)) base.snippets.push(s);
      base.bloqueante ||= otra.bloqueante;
      // Lo que lleva cada hilo: qué @ia? ya se respondieron, el escalón de ayuda y la última verificación.
      const fuentes = { ...fuentesDe(base) };
      for (const [k, v] of Object.entries(fuentesDe(otra))) fuentes[k] = Math.max(fuentes[k] ?? 0, v);
      if (Object.keys(fuentes).length) base.fuentes = fuentes;
      if (otra.nivel !== undefined) base.nivel = Math.max(base.nivel ?? 0, otra.nivel);
      if (otra.verificacion && (!base.verificacion || otra.verificacion.fecha > base.verificacion.fecha)) base.verificacion = otra.verificacion;
      if (otra.accion && otra.actualizada >= base.actualizada) base.accion = otra.accion;
      base.actualizada = otra.actualizada > base.actualizada ? otra.actualizada : base.actualizada;
      quitar.add(otra.id);
      destino.set(otra.id, base.id);
    }
    base.hilo.sort((a, b) => a.fecha.localeCompare(b.fecha));
    if (g.length > 1 || !base.titulo || base.tipo === "revision" || base.tipo === "plano") base.titulo = k === ARCHIVO ? "Este archivo" : k;
    anclar(base, k, funciones, lineas);
  }
  return { notas: notas.filter((n) => !quitar.has(n.id)), fusionadas: quitar.size, destino };
}

/** La nota (abierta) de esa función o del archivo; si no hay, la crea. */
export function notaPara(notas: Nota[], rel: string, funciones: Funcion[], src: string, o: { linea: number; funcion?: string | undefined; alcance?: "archivo" | undefined; tipo?: string; origen?: string }): Nota {
  const clave = claveDe(funciones, o);
  const existente = notas.find((n) => fusionable(n) && claveNota(funciones, n) === clave);
  if (existente) return existente;
  // Si la función ya tuvo una nota (cerrada: "lista" o resuelta), se reabre esa en vez de crear otra.
  const cerrada = notas.filter((n) => n.estado === "resuelta" && !n.prediccion && claveNota(funciones, n) === clave).sort((a, b) => b.actualizada.localeCompare(a.actualizada))[0];
  if (cerrada) {
    cerrada.estado = "abierta";
    anclar(cerrada, clave, funciones, src.split(/\r?\n/));
    return cerrada;
  }
  const n = nuevaNota(notas, { archivo: rel, ancla: { linea: 1, texto: "" }, tipo: o.tipo ?? "nota", titulo: clave === ARCHIVO ? "Este archivo" : clave, origen: o.origen ?? "nota" });
  anclar(n, clave, funciones, src.split(/\r?\n/));
  return n;
}

/** Agrega un mensaje de la IA al hilo (sin repetir uno idéntico). */
export function agregar(n: Nota, texto: string): boolean {
  if (n.hilo.some((m) => m.quien === "ia" && m.texto === texto)) return false;
  n.hilo.push(mensaje("ia", texto));
  n.estado = "abierta";
  n.actualizada = new Date().toISOString();
  return true;
}

/** Esquema común: de qué función habla cada cosa que dice la IA (para que cada nota hable solo de lo suyo). */
export const CAMPO_FUNCION = {
  type: "string",
  description: 'De qué habla este punto: "" si es sobre ESTA función; el nombre de OTRA función si habla de ella; "archivo" si es algo general del archivo.',
};

/**
 * En la nota de una función va solo lo de esa función. Lo que la IA dijo sobre OTRA función o sobre
 * el archivo se manda a la nota del archivo ("Sobre `x`: …"). Devuelve lo que sí es de esta función.
 */
export function repartir<T extends { funcion?: string }>(notas: Nota[], rel: string, funciones: Funcion[], src: string, actual: { clave: string; nombre: string }, items: T[], kind: string, texto: (x: T) => string): T[] {
  const propios: T[] = [];
  const ajenos: string[] = [];
  for (const it of items) {
    const f = (it.funcion ?? "").trim().replace(/\(\)$/, "").replace(/^`|`$/g, "");
    if (!f || f === actual.nombre || f === actual.clave || f === "esta") propios.push(it);
    else ajenos.push(f.toLowerCase() === "archivo" ? texto(it) : `Sobre \`${f}\`: ${texto(it)}`);
  }
  if (ajenos.length) {
    const n = notaPara(notas, rel, funciones, src, { linea: 1, alcance: "archivo", origen: kind });
    agregar(n, `**Visto al revisar \`${actual.nombre}\`** (no es de esa función)\n${ajenos.map((a) => `- ${a}`).join("\n")}`);
  }
  return propios;
}
