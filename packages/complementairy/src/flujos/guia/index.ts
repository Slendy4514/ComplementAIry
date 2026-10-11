/**
 * LA GUÍA: un solo punto de entrada para todo el acompañamiento a TU código (Plan C 4.2 y 4.9), con las mismas
 * reglas para todos los canales:
 *
 *   canal "nota"        una pregunta o un pedido sobre una línea o función (botones, `cai responder`)
 *   canal "comentario"  tus @ia? escritos en el archivo (vista comentarios, `cai guia`)
 *   canal "rapida"      una sugerencia corta en la línea, SOLO a pedido salvo que la actives (II.3)
 *   canal "al-guardar"  el acompañante: corrige y sugiere en pausas naturales (al guardar, al terminar una parte)
 *
 * Reglas comunes (aplicadas antes de cada canal): carpeta sin IA → nada; el modo de ayuda sale de la intención de
 * la tarea activa (II.5: en "aprender" no se da código) y de tu configuración; las respuestas pasan por los
 * filtros deterministas de cada canal (sin soluciones escritas fuera de construir; snippets apagados).
 */
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../../proyecto/config.js";
import { modoEfectivo } from "../../proyecto/modos.js";
import { acompanar } from "./acompanante.js";
import { rapida } from "./rapida.js";
import { responderNota, type PedidoNota } from "./responder.js";
import { runGuia } from "./tutor.js";

export type Canal = "nota" | "comentario" | "rapida" | "al-guardar";

export interface Guia {
  canal: Canal;
  modo: string;
  resultado: unknown;
}

export async function guiar(root: string, canal: Canal, pedido: { archivo: string; linea?: number; texto?: string; aPedido?: boolean; nota?: Omit<PedidoNota, "archivo"> }, log: (s: string) => void = () => {}): Promise<Guia> {
  if (fs.existsSync(path.join(root, ".cai", "cache", "sin-ia.json"))) throw new Error("esta carpeta es SIN IA (kata o reconstrucción): aquí no hay guía");
  const modo = modoEfectivo(loadConfig(root), pedido.archivo).modo;
  switch (canal) {
    case "nota":
      return { canal, modo, resultado: await responderNota(root, { archivo: pedido.archivo, ...(pedido.linea ? { linea: pedido.linea } : {}), ...(pedido.texto ? { texto: pedido.texto } : {}), ...pedido.nota } as PedidoNota, log) };
    case "comentario":
      return { canal, modo, resultado: await runGuia(root, pedido.archivo, log) };
    case "rapida":
      return { canal, modo, resultado: await rapida(root, pedido.archivo, pedido.linea ?? 1, { ...(pedido.texto ? { texto: pedido.texto } : {}), ...(pedido.aPedido ? { aPedido: true } : {}) }) };
    case "al-guardar":
      return { canal, modo, resultado: await acompanar(root, pedido.archivo, log) };
  }
}
