/**
 * Diferencia por líneas entre dos versiones de un texto (sin IA). Base de la procedencia: qué líneas de
 * la versión nueva son nuevas o cambiadas (y por lo tanto de quien hizo el cambio) y cuáles vienen de antes.
 *
 * LCS clásico con recorte de prefijo y sufijo comunes (los cambios típicos son locales, así que la parte
 * cuadrática queda chica). Para archivos enormes con cambios dispersos cae a una aproximación por huella.
 */

export interface Mapeo {
  /** Para cada línea de `despues` (índice), la línea de `antes` de la que viene, o -1 si es nueva/cambiada. */
  origen: number[];
  /** Líneas de `antes` que ya no están (borradas). */
  borradas: number[];
}

const MAX_CELDAS = 4_000_000;

export function dividir(t: string): string[] {
  if (t === "") return [];
  const ls = t.split(/\r?\n/);
  if (ls[ls.length - 1] === "") ls.pop();
  return ls;
}

export function mapearLineas(antes: string[], despues: string[]): Mapeo {
  const origen = new Array<number>(despues.length).fill(-1);
  let ini = 0;
  while (ini < antes.length && ini < despues.length && antes[ini] === despues[ini]) {
    origen[ini] = ini;
    ini++;
  }
  let fa = antes.length - 1;
  let fd = despues.length - 1;
  while (fa >= ini && fd >= ini && antes[fa] === despues[fd]) {
    origen[fd] = fa;
    fa--;
    fd--;
  }
  const a = antes.slice(ini, fa + 1);
  const d = despues.slice(ini, fd + 1);
  const usadas = new Set<number>();
  if (a.length && d.length) {
    if (a.length * d.length <= MAX_CELDAS) {
      // LCS por programación dinámica (filas de Uint32 para ahorrar memoria).
      const m = a.length;
      const n = d.length;
      const tabla: Uint32Array[] = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
      for (let i = m - 1; i >= 0; i--) {
        const fila = tabla[i]!;
        const sig = tabla[i + 1]!;
        for (let j = n - 1; j >= 0; j--) fila[j] = a[i] === d[j] ? sig[j + 1]! + 1 : Math.max(sig[j]!, fila[j + 1]!);
      }
      let i = 0;
      let j = 0;
      while (i < m && j < n) {
        if (a[i] === d[j]) {
          origen[ini + j] = ini + i;
          usadas.add(ini + i);
          i++;
          j++;
        } else if (tabla[i + 1]![j]! >= tabla[i]![j + 1]!) i++;
        else j++;
      }
    } else {
      // Aproximación: una línea idéntica no usada, en orden.
      const pos = new Map<string, number[]>();
      a.forEach((l, i) => pos.set(l, [...(pos.get(l) ?? []), ini + i]));
      let minimo = ini - 1;
      d.forEach((l, j) => {
        const cand = (pos.get(l) ?? []).find((x) => x > minimo && !usadas.has(x));
        if (cand !== undefined) {
          origen[ini + j] = cand;
          usadas.add(cand);
          minimo = cand;
        }
      });
    }
  }
  for (let k = 0; k < ini; k++) usadas.add(k);
  for (let k = fa + 1; k < antes.length; k++) usadas.add(k);
  const borradas: number[] = [];
  for (let k = 0; k < antes.length; k++) if (!usadas.has(k)) borradas.push(k);
  return { origen, borradas };
}

/** Índices (0-based) de las líneas nuevas o cambiadas de `despues`. */
export function lineasNuevas(antes: string, despues: string): number[] {
  const m = mapearLineas(dividir(antes), dividir(despues));
  return m.origen.flatMap((o, i) => (o === -1 ? [i] : []));
}

/** Agrupa índices en rangos consecutivos [desde, hasta] (inclusive). */
export function rangos(indices: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const i of [...indices].sort((x, y) => x - y)) {
    const u = out[out.length - 1];
    if (u && i === u[1] + 1) u[1] = i;
    else out.push([i, i]);
  }
  return out;
}

/** Huella corta de una línea normalizada (sin espacios de los extremos), para anclar sin depender del número. */
export function huellaLinea(l: string): string {
  let h = 2166136261;
  const s = l.trim();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
