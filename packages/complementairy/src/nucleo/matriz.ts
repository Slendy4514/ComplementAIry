/**
 * Marcos de decisión, todo determinista (la IA puede sugerir opciones y rangos; los números los pones tú
 * y la cuenta la hace este módulo):
 *
 * - Matriz ponderada: criterios con pesos (suman 100) × opciones puntuadas 1–5 → total por opción.
 * - Sensibilidad: el menor cambio de UN peso que da vuelta al ganador (si es < 10 puntos, "decisión frágil").
 * - Valor esperado: escenarios con probabilidad × costo (o beneficio) por opción → EV, minimax regret y peor caso.
 */

export interface Criterio {
  nombre: string;
  peso: number;
}

/** puntajes[opcion][criterio] = 1..5 */
export type Puntajes = Record<string, Record<string, number>>;

export interface ResultadoMatriz {
  totales: { opcion: string; total: number }[];
  ganador: string;
  /** Menor cambio de peso (en puntos) que cambia el ganador; Infinity si ningún cambio lo hace. */
  sensibilidad: number;
  /** Qué criterio, con ese cambio, da vuelta el resultado. */
  sensibleA?: { criterio: string; nuevoPeso: number; nuevoGanador: string };
  fragil: boolean;
}

export function validarMatriz(criterios: Criterio[], opciones: string[], puntajes: Puntajes): string[] {
  const e: string[] = [];
  if (criterios.length < 1) e.push("define al menos un criterio");
  if (opciones.length < 2) e.push("hacen falta al menos 2 opciones");
  const suma = criterios.reduce((a, c) => a + c.peso, 0);
  if (Math.abs(suma - 100) > 0.001) e.push(`los pesos deben sumar 100 (suman ${suma})`);
  for (const c of criterios) if (!(c.peso >= 0)) e.push(`peso inválido en ${c.nombre}`);
  for (const o of opciones)
    for (const c of criterios) {
      const v = puntajes[o]?.[c.nombre];
      if (v === undefined) e.push(`falta tu puntaje de «${o}» en «${c.nombre}»`);
      else if (!(v >= 1 && v <= 5)) e.push(`el puntaje de «${o}» en «${c.nombre}» debe ser de 1 a 5`);
    }
  return e;
}

const total = (criterios: Criterio[], p: Record<string, number>) => criterios.reduce((a, c) => a + (c.peso / 100) * (p[c.nombre] ?? 0), 0);

function ranking(criterios: Criterio[], opciones: string[], puntajes: Puntajes) {
  return opciones.map((o) => ({ opcion: o, total: Math.round(total(criterios, puntajes[o] ?? {}) * 1000) / 1000 })).sort((a, b) => b.total - a.total);
}

/** Pesos con uno cambiado y el resto reescalado para seguir sumando 100. */
function conPeso(criterios: Criterio[], i: number, nuevo: number): Criterio[] {
  const resto = 100 - criterios[i]!.peso;
  const nuevoResto = 100 - nuevo;
  return criterios.map((c, k) => (k === i ? { ...c, peso: nuevo } : { ...c, peso: resto > 0 ? (c.peso * nuevoResto) / resto : nuevoResto / (criterios.length - 1) }));
}

export function calcularMatriz(criterios: Criterio[], opciones: string[], puntajes: Puntajes): ResultadoMatriz {
  const errores = validarMatriz(criterios, opciones, puntajes);
  if (errores.length) throw new Error(errores.join("; "));
  const totales = ranking(criterios, opciones, puntajes);
  const ganador = totales[0]!.opcion;
  let mejor: ResultadoMatriz["sensibleA"];
  let sensibilidad = Infinity;
  for (let i = 0; i < criterios.length; i++) {
    for (let delta = 1; delta <= 100; delta++) {
      for (const signo of [1, -1]) {
        const nuevo = criterios[i]!.peso + signo * delta;
        if (nuevo < 0 || nuevo > 100) continue;
        const r = ranking(conPeso(criterios, i, nuevo), opciones, puntajes);
        if (r[0]!.opcion !== ganador && r[0]!.total > r[1]!.total) {
          if (delta < sensibilidad) {
            sensibilidad = delta;
            mejor = { criterio: criterios[i]!.nombre, nuevoPeso: nuevo, nuevoGanador: r[0]!.opcion };
          }
          break;
        }
      }
      if (delta >= sensibilidad) break;
    }
  }
  return { totales, ganador, sensibilidad, ...(mejor ? { sensibleA: mejor } : {}), fragil: sensibilidad < 10 };
}

// --- Valor esperado ------------------------------------------------------------------------------------

export interface Escenario {
  nombre: string;
  probabilidad: number;
}

/** valores[opcion][escenario] = costo (si `minimizar`) o beneficio. */
export type Valores = Record<string, Record<string, number>>;

export interface ResultadoEV {
  ev: { opcion: string; valor: number }[];
  mejorEV: string;
  /** Opción con el menor arrepentimiento máximo. */
  minimaxRegret: string;
  arrepentimiento: { opcion: string; maximo: number }[];
  /** Opción con el mejor resultado en su peor escenario. */
  mejorPeorCaso: string;
}

export function calcularEV(escenarios: Escenario[], opciones: string[], valores: Valores, minimizar = true): ResultadoEV {
  const suma = escenarios.reduce((a, e) => a + e.probabilidad, 0);
  if (Math.abs(suma - 1) > 0.001) throw new Error(`las probabilidades deben sumar 1 (suman ${suma})`);
  if (opciones.length < 2) throw new Error("hacen falta al menos 2 opciones");
  for (const o of opciones) for (const e of escenarios) if (typeof valores[o]?.[e.nombre] !== "number") throw new Error(`falta el valor de «${o}» en el escenario «${e.nombre}»`);
  const v = (o: string, e: string) => valores[o]![e]!;
  const mejorEs = (a: number, b: number) => (minimizar ? a < b : a > b);
  const ev = opciones.map((o) => ({ opcion: o, valor: Math.round(escenarios.reduce((a, e) => a + e.probabilidad * v(o, e.nombre), 0) * 1000) / 1000 }));
  const mejorEV = ev.reduce((a, b) => (mejorEs(b.valor, a.valor) ? b : a)).opcion;
  const optimo = (e: string) => opciones.map((o) => v(o, e)).reduce((a, b) => (mejorEs(b, a) ? b : a));
  const arrepentimiento = opciones.map((o) => ({ opcion: o, maximo: Math.max(...escenarios.map((e) => Math.abs(v(o, e.nombre) - optimo(e.nombre)))) }));
  const minimaxRegret = arrepentimiento.reduce((a, b) => (b.maximo < a.maximo ? b : a)).opcion;
  const peor = (o: string) => escenarios.map((e) => v(o, e.nombre)).reduce((a, b) => (mejorEs(a, b) ? b : a));
  const mejorPeorCaso = opciones.reduce((a, b) => (mejorEs(peor(b), peor(a)) ? b : a));
  return { ev, mejorEV, minimaxRegret, arrepentimiento, mejorPeorCaso };
}

/** Discrepancias de 2 o más puntos entre tus puntajes y los que sugirió la IA (te piden una nota). */
export function discrepancias(tuyos: Puntajes, ia: Puntajes): { opcion: string; criterio: string; tuyo: number; ia: number }[] {
  const out: { opcion: string; criterio: string; tuyo: number; ia: number }[] = [];
  for (const [o, cs] of Object.entries(tuyos))
    for (const [c, v] of Object.entries(cs)) {
      const s = ia[o]?.[c];
      if (s !== undefined && Math.abs(s - v) >= 2) out.push({ opcion: o, criterio: c, tuyo: v, ia: s });
    }
  return out;
}
