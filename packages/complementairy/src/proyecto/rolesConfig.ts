/**
 * Qué motor y modelo usa cada rol (configuración pura, sin llamar a la IA): lo leen el hook (para avisar si la
 * sesión no usa el modelo de la fase) y la capa de IA (para consultar).
 */
import type { Config } from "./config.js";

export type Rol = "planificar" | "implementar" | "revisar" | "interrogar" | "clasificar" | "resumir" | "traducirGit" | "traspaso" | "verificarFiel" | "explicar";

export const ROLES_POR_DEFECTO: Record<Rol, string> = {
  planificar: "claude-code:claude-opus-5-5",
  implementar: "claude-code:claude-sonnet-5-5",
  revisar: "claude-code:claude-sonnet-5-5",
  interrogar: "claude-code:claude-sonnet-5-5",
  explicar: "claude-code:claude-sonnet-5-5",
  clasificar: "claude-code:claude-haiku-5-5",
  resumir: "claude-code:claude-haiku-5-5",
  traducirGit: "claude-code:claude-haiku-5-5",
  traspaso: "claude-code:claude-haiku-5-5",
  verificarFiel: "claude-code:claude-haiku-5-5",
};

/** "motor:modelo" → [motor, modelo]. Sin ":" = motor claude-code con ese modelo. */
export function partir(ref: string): [string, string] {
  const i = ref.indexOf(":");
  return i < 0 ? ["claude-code", ref] : [ref.slice(0, i), ref.slice(i + 1)];
}

/** El "motor:modelo" que usa un rol (configurado o por defecto). */
export function refDeRol(c: Config, rol: Rol): string {
  return c.ia.roles?.[rol] || ROLES_POR_DEFECTO[rol];
}

