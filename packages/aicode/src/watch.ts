import fs from "node:fs";
import path from "node:path";
import { makeZoner } from "./config.js";
import { langFor } from "./lang.js";
import { acompanar } from "./acompanante.js";

/**
 * Modo watch: cada vez que guardás un archivo con un `@ia?` (o `@yo:`) sin responder,
 * se responde solo. Funciona con cualquier editor.
 */
export function watch(root: string, log: (s: string) => void = console.log): fs.FSWatcher {
  const z = makeZoner(root);
  const timers = new Map<string, NodeJS.Timeout>();
  const running = new Set<string>();

  const handle = async (rel: string) => {
    if (running.has(rel)) return;
    const lang = langFor(rel);
    const abs = path.join(root, rel);
    if (!lang || !fs.existsSync(abs)) return;
    running.add(rel);
    try {
      const r = await acompanar(root, rel, log);
      for (const a of r.acciones) log(`✓ ${rel}: ${a.tipo} — ${a.detalle}`);
      if (r.costoUsd) log(`  · US$${r.costoUsd.toFixed(3)}`);
    } catch (e) {
      log(`✗ ${rel}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      running.delete(rel);
    }
  };

  log(`aicode watch: escuchando ${root} (Ctrl+C para salir)`);
  return fs.watch(root, { recursive: true }, (_ev, name) => {
    if (!name) return;
    const rel = name.split(path.sep).join("/");
    if (z.isIgnored(rel) || z.zoneOf(path.join(root, rel)) === "protegida") return;
    clearTimeout(timers.get(rel));
    timers.set(rel, setTimeout(() => void handle(rel), 700));
  });
}
