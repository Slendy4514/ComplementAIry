import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Las capas se hacen cumplir con un test, no con buena voluntad:
 *  - El hook de Claude Code corre en CADA herramienta: ni la IA, ni el Agent SDK, ni los flujos que la llaman.
 *  - nucleo/ es puro: no conoce .cai/, ni la IA, ni los flujos.
 *  - proyecto/ (los almacenes) no llama a la IA.
 *  - garantias/ no llama a la IA.
 */
const SRC = path.join(__dirname, "..", "src");

function importsDe(archivo: string): string[] {
  const src = fs.readFileSync(archivo, "utf8");
  const out: string[] = [];
  // Solo imports estáticos (los dinámicos `await import()` se cargan cuando se usan, no al cargar el hook).
  for (const m of src.matchAll(/^(?:import|export)\s[^;]*?from\s+["'](\.[^"']+)["']/gm)) out.push(path.resolve(path.dirname(archivo), m[1]!.replace(/\.js$/, ".ts")));
  return out;
}

function alcanzables(desde: string): Map<string, string> {
  const vistos = new Map<string, string>([[desde, ""]]);
  const cola = [desde];
  while (cola.length) {
    const a = cola.shift()!;
    for (const b of importsDe(a))
      if (!vistos.has(b) && fs.existsSync(b)) {
        vistos.set(b, a);
        cola.push(b);
      }
  }
  return vistos;
}

const rel = (f: string) => path.relative(SRC, f);
function camino(m: Map<string, string>, hasta: string): string {
  const c: string[] = [];
  for (let x: string | undefined = hasta; x; x = m.get(x) || undefined) c.unshift(rel(x));
  return c.join(" → ");
}
const prohibidos = (m: Map<string, string>, re: RegExp) => [...m.keys()].filter((f) => re.test(rel(f))).map((f) => camino(m, f));

/** La IA y lo que la llama: ia/ y flujos/ (y la CLI de comandos, que lo carga todo). */
const IA = /^(ia|flujos)\/.*\.ts$|^cli\/(comandos|v1|mcp|servir|selftest|doctor)\.ts$/;

describe("capas", () => {
  test("el hook (cli.ts → garantias/hook.ts) no carga la IA ni los flujos", () => {
    expect(prohibidos(alcanzables(path.join(SRC, "garantias", "hook.ts")), IA)).toEqual([]);
    expect(prohibidos(alcanzables(path.join(SRC, "cli.ts")), IA)).toEqual([]);
  });
  test("nucleo/ es puro", () => {
    for (const f of fs.readdirSync(path.join(SRC, "nucleo"))) {
      const m = alcanzables(path.join(SRC, "nucleo", f));
      expect(prohibidos(m, /^(proyecto|flujos|ia|garantias|cli)\//), f).toEqual([]);
    }
  });
  test("proyecto/ y garantias/ no llaman a la IA", () => {
    for (const d of ["proyecto", "garantias"])
      for (const f of fs.readdirSync(path.join(SRC, d))) expect(prohibidos(alcanzables(path.join(SRC, d, f)), IA), `${d}/${f}`).toEqual([]);
  });
});
