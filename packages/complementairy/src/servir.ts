import path from "node:path";
import { createInterface } from "node:readline";
import { loadConfig } from "./config.js";
import { llmActual, setLLM } from "./llm.js";
import { rapida } from "./rapida.js";
import { conSesion, fijarPlazo } from "./sesion.js";
import { iaOpts } from "./tutor.js";

/**
 * `cai servir`: proceso de larga vida para la extensión. Recibe un pedido JSON por línea en stdin y
 * responde una línea JSON en stdout (mismo `id`). Las sugerencias rápidas van al proceso de Claude
 * Code abierto (rápido); si falla, a la llamada normal. Solo responde: no escribe tu código.
 */

export interface Pedido {
  id: number | string;
  tipo: "rapida" | "ping";
  archivo?: string;
  linea?: number;
  /** Hasta cuándo le sirve la respuesta a quien pidió (ms desde 1970): después no se gasta en él. */
  vence?: number;
}

export async function atender(root: string, linea: string): Promise<string> {
  let p: Pedido;
  try {
    p = JSON.parse(linea) as Pedido;
    if (!p || typeof p !== "object") throw new Error("no es un objeto");
  } catch {
    return JSON.stringify({ id: null, ok: false, error: "pedido inválido (se espera un objeto JSON por línea)" });
  }
  try {
    if (p.tipo === "ping") return JSON.stringify({ id: p.id, ok: true });
    if (p.tipo === "rapida") {
      if (!p.archivo || !p.linea) throw new Error("falta archivo o línea");
      // Si quien pidió ya no espera la respuesta, no se gasta en ella.
      const queda = typeof p.vence === "number" ? p.vence - Date.now() : 15_000;
      if (queda < 500) throw new Error("vencido: la extensión ya no espera esta respuesta");
      fijarPlazo(queda - 300);
      const r = await rapida(root, path.relative(root, path.resolve(root, p.archivo)), p.linea);
      return JSON.stringify({ id: p.id, ok: true, ...r });
    }
    throw new Error(`tipo de pedido desconocido: ${String(p.tipo)}`);
  } catch (e) {
    return JSON.stringify({ id: p?.id ?? null, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}

export async function servir(root: string): Promise<void> {
  const cfg = loadConfig(root);
  // Sin respaldo aquí: si el proceso abierto no llega a tiempo, la extensión usa SU respaldo (una sola llamada extra).
  const llm = conSesion(llmActual(), ["rapida"], undefined, { respaldo: false });
  process.stdout.on("error", () => process.exit(0)); // la extensión se cerró
  setLLM(llm);
  // Precalentar: el arranque de Claude Code se paga ahora, no en la primera sugerencia.
  if (cfg.rapidas.procesoAbierto) {
    const modelo = iaOpts(cfg, "chico").model;
    const { Sesion } = await import("./sesion.js");
    const s = new Sesion(modelo);
    llm.sesiones.set(modelo ?? "", s);
    s.precalentar();
  }
  const rl = createInterface({ input: process.stdin });
  let cola: Promise<void> = Promise.resolve();
  rl.on("line", (l) => {
    if (!l.trim()) return;
    cola = cola
      .then(async () => {
        process.stdout.write(`${await atender(root, l)}\n`);
      })
      .catch((e: unknown) => {
        process.stderr.write(`cai servir: ${e instanceof Error ? e.message : String(e)}\n`);
      });
  });
  await new Promise<void>((r) => rl.on("close", () => r()));
  await cola;
  for (const s of llm.sesiones.values()) s.cerrar();
}
