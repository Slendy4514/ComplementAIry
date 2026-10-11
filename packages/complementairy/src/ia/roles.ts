/**
 * Ruteo POR ROL (manifiesto IV.5): planificar con un modelo de razonamiento, implementar con uno de
 * código, clasificar con uno barato. La IA nunca decide una compuerta sola: los roles baratos aconsejan,
 * las reglas y la ejecución deciden.
 *
 * .cai/config.json → ia.roles: { "planificar": "claude-code:claude-opus-5-5", "clasificar": "ollama:qwen2.5-coder", … }
 */
import type { Config } from "../proyecto/config.js";
import { leerUso } from "./llm.js";
import { consultarMotor, disponible, MOTORES_BASE, type DefMotor, type Pedido, type Respuesta } from "./motores.js";
import { partir, refDeRol, ROLES_POR_DEFECTO, type Rol } from "../proyecto/rolesConfig.js";
import { esLocal } from "./systemone.js";
export { partir, refDeRol, ROLES_POR_DEFECTO, type Rol } from "../proyecto/rolesConfig.js";

/** Roles que piensan a fondo (más esfuerzo de razonamiento). */
const PROFUNDOS = new Set<Rol>(["planificar"]);

export function motoresDe(c: Config): Record<string, DefMotor> {
  return { ...MOTORES_BASE, ...(c.ia.motores ?? {}) };
}

/** ¿Se puede usar este motor con la privacidad del proyecto? Devuelve por qué no, o null. */
export function permitido(c: Config, nombre: string, def: DefMotor): string | null {
  const priv = c.ia.privacidad ?? "normal";
  // "local" solo vale si la url también lo es (un motor mal marcado no se salta la privacidad).
  const local = esLocal(def);
  const externo = !local && !["claude-code", "anthropic"].includes(def.tipo);
  if (priv === "solo-local" && !local) return `${nombre} no es local y el proyecto es solo-local`;
  if (priv === "solo-anthropic" && externo) return `${nombre} no es de Anthropic y el proyecto es solo-anthropic`;
  if (externo && !(c.ia.optIn ?? []).includes(nombre)) return `${nombre} manda tu código a un tercero: habilítalo explícitamente en ia.optIn`;
  return null;
}

/**
 * Consulta la IA del rol. Si su motor no está disponible o no está permitido, usa el respaldo
 * (ia.respaldo, por defecto Claude Code con el modelo del rol por defecto).
 */
export async function consultarRol<T>(c: Config, rol: Rol, p: Omit<Pedido, "modelo">): Promise<Respuesta<T>> {
  const tope = c.ia.presupuestoSemanaUsd ?? 0;
  if (tope > 0) {
    const gastado = leerUso(7).reduce((a, u) => a + (u.costo ?? 0), 0);
    if (gastado >= tope) throw new Error(`el presupuesto de IA de la semana (US$${tope}) se agotó (gastado US$${gastado.toFixed(2)}): sube ia.presupuestoSemanaUsd o sigue a mano`);
  }
  const motores = motoresDe(c);
  const candidatos = [refDeRol(c, rol), ...(c.ia.respaldo ?? []), ROLES_POR_DEFECTO[rol]];
  const errores: string[] = [];
  for (const ref of [...new Set(candidatos)]) {
    const [nombre, modelo] = partir(ref);
    const def = motores[nombre];
    if (!def) {
      errores.push(`no conozco el motor ${nombre} (defínelo en ia.motores)`);
      continue;
    }
    const no = permitido(c, nombre, def) ?? (disponible(def) ? null : `${nombre} no está disponible (falta ${def.claveEnv})`);
    if (no) {
      errores.push(no);
      continue;
    }
    try {
      return await consultarMotor<T>(nombre, def, { ...p, ...(modelo ? { modelo } : {}), ...(PROFUNDOS.has(rol) && !p.effort ? { effort: "high" as const } : {}) });
    } catch (e) {
      errores.push(e instanceof Error ? e.message : String(e));
      if (def.tipo === "claude-code") throw e; // Claude Code es el último respaldo: su error es el real
    }
  }
  throw new Error(`ninguna IA disponible para «${rol}»: ${errores.join(" · ")}`);
}
