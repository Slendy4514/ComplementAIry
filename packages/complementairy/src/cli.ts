#!/usr/bin/env node
/**
 * Punto de entrada de `cai`. `cai hook` corre en CADA herramienta de Claude Code: carga solo lo suyo
 * (sin la IA ni el resto de los comandos). Todo lo demás está en comandos.ts.
 *
 * Códigos de salida: 0 ok · 1 una verificación no pasó · 2 falla · 3 ocupado (otro pedido en curso) ·
 * 64 error de uso (argumentos).
 */
import { ErrorUso } from "./args.js";

async function hook(): Promise<number> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const { runHook } = await import("./hook.js");
  const out = await runHook(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Parameters<typeof runHook>[0], process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
  if (out) process.stdout.write(JSON.stringify(out));
  return 0;
}

const argv = process.argv.slice(2);
(argv[0] === "hook" ? hook() : import("./comandos.js").then((m) => m.main(argv))).then(
  (code) => process.exit(code),
  (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`cai: ${msg}`);
    process.exit(err instanceof ErrorUso || /^uso:/.test(msg) ? 64 : 2);
  },
);
