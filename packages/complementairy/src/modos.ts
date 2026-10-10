import type { Config } from "./config.js";
import { modoEfectivo as efectivo, type Comportamiento, type Modo, type Origen } from "./compartido.js";

/**
 * Modos de trabajo: cambian CÓMO se da la ayuda nueva, nunca lo que ya existe (notas, tareas,
 * estructura, panorama y memoria quedan igual). Se eligen por proyecto, carpeta, archivo o función;
 * gana el más específico. Dos ejes: quién escribe (tú / la IA, construyendo juntos) y cuánta ayuda
 * (sugerir / aprender). La tabla y las reglas viven en compartido.ts (las usa también la extensión).
 */

export { carpetaIncluye, esModo, migrarModos, modoDe, MODOS, type Ayuda, type Comportamiento, type Escribe, type Modo, type Origen } from "./compartido.js";

export function modoEfectivo(cfg: Config, rel: string, funcion?: string): { modo: Modo; origen: Origen; c: Comportamiento } {
  return efectivo(cfg, rel, funcion);
}
