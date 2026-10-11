/**
 * Lectura de argumentos de la CLI. Un solo lugar para las reglas: un flag con valor necesita un valor
 * de verdad (`--texto --json` es un error de uso, no el texto "--json"), y los errores de uso se
 * distinguen de las fallas (código 64 en vez de 2).
 */

export class ErrorUso extends Error {}

/** Lanza un error de uso (la CLI sale con 64 y muestra el mensaje). */
export function uso(mensaje: string): never {
  throw new ErrorUso(mensaje.startsWith("uso:") ? mensaje : `uso: ${mensaje}`);
}

const pareceFlag = (x: string | undefined) => x !== undefined && /^--[a-z]/i.test(x);

/** El valor de `flag` (el argumento siguiente), o `undefined` si el flag no está. */
export function valor(args: readonly string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined || pareceFlag(v)) uso(`${flag} necesita un valor${v ? ` (vino "${v}", que es otro flag; si tu texto empieza con "--", ponle un espacio delante)` : ""}`);
  return v;
}

/** Todos los valores de un flag que se puede repetir (`--opcion a --opcion b`). */
export function valores(args: readonly string[], flag: string): string[] {
  const out: string[] = [];
  args.forEach((a, i) => {
    if (a !== flag) return;
    const v = args[i + 1];
    if (v === undefined || pareceFlag(v)) uso(`${flag} necesita un valor`);
    out.push(v);
  });
  return out;
}

/** Un número entero positivo (p. ej. `--linea 12`), con error de uso si no lo es. */
export function entero(args: readonly string[], flag: string): number | undefined {
  const v = valor(args, flag);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) uso(`${flag} espera un número entero desde 1 (vino "${v}")`);
  return n;
}

/** El comando conocido más parecido (para "¿quisiste decir…?"). */
export function parecido(palabra: string, conocidas: readonly string[]): string | undefined {
  const d = (a: string, b: string) => {
    const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) m[0]![j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++) m[i]![j] = Math.min(m[i - 1]![j]! + 1, m[i]![j - 1]! + 1, m[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    return m[a.length]![b.length]!;
  };
  const mejor = conocidas.map((c) => ({ c, n: d(palabra, c) })).sort((x, y) => x.n - y.n)[0];
  return mejor && mejor.n <= Math.max(2, Math.floor(palabra.length / 3)) ? mejor.c : undefined;
}
