import { describe, expect, test } from "vitest";
import { chequearExplicacion, copiado, esAprobacionVacia, fragmentosInventados, ordenValida, pedidoEspecifico, referencias, respuestaValida, sinCubrir } from "../../src/nucleo/especificidad.js";
import { lineasNuevas, mapearLineas, rangos } from "../../src/nucleo/diffLineas.js";
import { calcularEV, calcularMatriz, discrepancias } from "../../src/nucleo/matriz.js";
import { criterioVerificable, faltantes, preguntasEntrevista, RESTRICCIONES_VACIAS, siguienteEstado, transicionar, type Tarea } from "../../src/nucleo/flujo.js";
import { construccionesDe } from "../../src/nucleo/construcciones.js";
import { detectar } from "../../src/nucleo/detectores.js";
import { langFor } from "../../src/nucleo/lang.js";

describe("especificidad (piso objetivo)", () => {
  test("«sí», «dale», «lo que digas» no deciden nada", () => {
    for (const t of ["sí", "dale", "ok, hazlo", "lo que digas", "como sugieres", "todo eso", "me da igual", "sí a todo"]) expect(esAprobacionVacia(t), t).toBe(true);
    expect(respuestaValida("sí")).toMatch(/no dicen qué decidiste/);
  });
  test("una respuesta corta con contenido vale (también con «tal cual» si dice algo)", () => {
    expect(respuestaValida("src/export/, el comando lo registro yo")).toBeNull();
    expect(respuestaValida("sin dependencias, salvo PDF que lo decido ahí")).toBeNull();
    expect(respuestaValida("si no me pasan texto, que lance un TypeError")).toBeNull(); // "si" condicional
    expect(respuestaValida("calcularCuota no cambia, se usa tal cual")).toBeNull();
  });
  test("copiar la sugerencia se rechaza", () => {
    const sug = "Solo en la carpeta src/export porque ahí vive la exportación y no toca el resto del código";
    expect(respuestaValida(sug, sug)).toMatch(/copiaste/);
    expect(copiado("haz que quite las barras del final", "haz que quite las barras del final por favor")).toBeGreaterThan(0.5);
  });
  test("orden de un paso: vaga, amplia o copiada se rechaza", () => {
    expect(ordenValida("dale, haz eso", [])).not.toBeNull();
    expect(ordenValida("haz el paso 1 y lo demás también", [])).not.toBeNull();
    expect(ordenValida("si no me pasan un texto, que tire un TypeError diciendo qué llegó", [])).toBeNull();
  });
  test("pedido específico: verbos vacíos y sin referencias", () => {
    expect(pedidoEspecifico("arréglalo")).toMatch(/vagas/);
    expect(pedidoEspecifico("mejora el buscador para que ande mejor")).toMatch(/nombra algo concreto/);
    expect(pedidoEspecifico("agrega un campo `editable` en users y exponlo en src/api/users.ts")).toBeNull();
    expect(referencias("usa calcularTotal en src/billing/invoice.ts")).toEqual(expect.arrayContaining(["src/billing/invoice.ts", "calcularTotal"]));
  });
  test("cobertura de un pedido: la IA no inventa temas y nada queda sin destino", () => {
    const p = "agrega exportar a PDF, arregla que el buscador se cuelga y cambia el color del tema oscuro";
    expect(fragmentosInventados(p, ["exportar a PDF", "buscador se cuelga", "mandar emails"])).toEqual(["mandar emails"]);
    expect(sinCubrir(p, ["exportar a PDF", "buscador se cuelga"])).toEqual(expect.arrayContaining(["color", "oscuro"]));
    expect(sinCubrir(p, ["exportar a PDF", "el buscador se cuelga", "el color del tema oscuro"])).toEqual([]);
  });
  test("explicación: corta, sin identificadores, copiada o plantilla", () => {
    const ia = "La función recorre los items y suma el precio por la cantidad, aplicando el descuento al final del cálculo total";
    const r = chequearExplicacion("suma cosas", { identificadores: ["calcularTotal"], complejidad: 2, fuentesIa: [ia] });
    expect(r.ok).toBe(false);
    const buena = "calcularTotal multiplica precio por cantidad de cada item y después resta el cupón; si el cupón supera el total el resultado podría quedar negativo";
    expect(chequearExplicacion(buena, { identificadores: ["calcularTotal"], complejidad: 2, fuentesIa: [ia] }).ok).toBe(true);
    expect(chequearExplicacion(buena, { identificadores: ["calcularTotal"], complejidad: 2, anteriores: [buena] }).ok).toBe(false);
  });
});

describe("diffLineas", () => {
  test("detecta líneas nuevas y cambiadas", () => {
    expect(lineasNuevas("a\nb\nc\n", "a\nX\nb\nc\nY\n")).toEqual([1, 4]);
    expect(lineasNuevas("a\nb\n", "a\nb2\n")).toEqual([1]);
    expect(lineasNuevas("", "a\nb\n")).toEqual([0, 1]);
  });
  test("mapea líneas movidas por inserciones arriba", () => {
    const m = mapearLineas(["x", "y", "z"], ["nuevo", "x", "y", "z"]);
    expect(m.origen).toEqual([-1, 0, 1, 2]);
    expect(mapearLineas(["a", "b"], ["b"]).borradas).toEqual([0]);
  });
  test("rangos", () => expect(rangos([5, 1, 2, 3, 7])).toEqual([[1, 3], [5, 5], [7, 7]]));
});

describe("matriz y valor esperado", () => {
  const criterios = [{ nombre: "compatibilidad", peso: 50 }, { nombre: "simplicidad", peso: 30 }, { nombre: "rendimiento", peso: 20 }];
  const p = { A: { compatibilidad: 4, simplicidad: 3, rendimiento: 3 }, B: { compatibilidad: 4, simplicidad: 5, rendimiento: 4 } };
  test("total y ganador", () => {
    const r = calcularMatriz(criterios, ["A", "B"], p);
    expect(r.ganador).toBe("B");
    expect(r.totales[0]!.total).toBeCloseTo(4.3);
  });
  test("sensibilidad: una decisión ajustada es frágil", () => {
    const fragil = calcularMatriz([{ nombre: "x", peso: 50 }, { nombre: "y", peso: 50 }], ["A", "B"], { A: { x: 5, y: 1 }, B: { x: 1, y: 4 } });
    expect(fragil.ganador).toBe("A");
    expect(Number.isFinite(fragil.sensibilidad)).toBe(true);
    expect(fragil.fragil).toBe(true);
  });
  test("pesos que no suman 100 se rechazan", () => expect(() => calcularMatriz([{ nombre: "x", peso: 40 }], ["A", "B"], { A: { x: 1 }, B: { x: 2 } })).toThrow(/sumar 100/));
  test("EV, minimax regret y peor caso", () => {
    const r = calcularEV([{ nombre: "bien", probabilidad: 0.7 }, { nombre: "mal", probabilidad: 0.3 }], ["migrar", "parche"], { migrar: { bien: 10, mal: 40 }, parche: { bien: 2, mal: 100 } });
    expect(r.mejorEV).toBe("migrar");
    expect(r.mejorPeorCaso).toBe("migrar");
    expect(r.minimaxRegret).toBe("migrar");
  });
  test("discrepancias de 2+ puntos piden nota", () => expect(discrepancias({ A: { x: 5 } }, { A: { x: 2 } })).toHaveLength(1));
});

const tarea = (extra: Partial<Tarea> = {}): Tarea => ({
  version: 1,
  id: "t1",
  titulo: "Campo editable",
  tipo: "funcionalidad",
  intencion: "producir",
  ejecutor: "agente",
  estado: "borrador",
  creada: "",
  actualizada: "",
  entrevista: preguntasEntrevista("funcionalidad"),
  restricciones: { ...RESTRICCIONES_VACIAS },
  adjuntos: [],
  dialogo: [],
  historial: [],
  checkpoints: [],
  tocados: [],
  ...extra,
});

describe("flujo de la tarea", () => {
  test("borrador: falta entrevista y diseño", () => {
    const f = faltantes(tarea());
    expect(f.some((x) => /entrevista/.test(x))).toBe(true);
    expect(f.some((x) => /diseño/.test(x))).toBe(true);
  });
  test("«sí» en la entrevista no cuenta", () => {
    const t = tarea({ entrevista: preguntasEntrevista("express").map((p) => ({ ...p, respuesta: "sí" })) });
    expect(faltantes(t).some((x) => /no dicen qué decidiste/.test(x))).toBe(true);
  });
  test("diseño completo y entrevista respondida → puede pasar a diseñada", () => {
    const t = tarea({
      tipo: "express",
      entrevista: preguntasEntrevista("express").map((p) => ({ ...p, respuesta: p.clave === "alcance" ? "src/api/users.ts solamente" : "GET /api/users/7 devuelve editable false" })),
      diseno: { problema: "solo los dueños deberían editar", enfoque: "agregar `editable` en `users` y leerlo en EditButton", contexto: ["src/api/users.ts"], criterios: ["GET /api/users/7 → editable:false"] },
    });
    expect(faltantes(t)).toEqual([]);
    expect(siguienteEstado(t)).toBe("diseñada");
  });
  test("planificada: decisiones pendientes, licencias y paráfrasis bloquean", () => {
    const t = tarea({ estado: "planificada", restricciones: { ...RESTRICCIONES_VACIAS, alcance: ["src/**"] } });
    const f = faltantes(t, { decisionesPendientes: ["d1"], licenciasFaltantes: ["promise-all"] });
    expect(f.join("\n")).toMatch(/decide primero/);
    expect(f.join("\n")).toMatch(/licencias/);
    expect(f.join("\n")).toMatch(/paráfrasis/);
  });
  test("transiciones inválidas se rechazan", () => {
    expect(() => transicionar(tarea(), "ejecutando")).toThrow(/no puede pasar/);
    expect(transicionar(tarea(), "diseñada").historial).toHaveLength(1);
  });
  test("criterio verificable", () => {
    expect(criterioVerificable("calcular(2) → 4")).toBe(true);
    expect(criterioVerificable("pnpm test users")).toBe(true);
    expect(criterioVerificable("que funcione bien")).toBe(false);
  });
  test("ejecutor humano salta plan y ejecución", () => expect(siguienteEstado(tarea({ ejecutor: "humano", estado: "diseñada" }))).toBe("probada"));
  test("límite WIP: no más de 2 tareas en revisión", () => {
    expect(faltantes(tarea({ estado: "ejecutando" }), { hayCambios: true, enRevision: 2 }).join(" ")).toMatch(/límite 2/);
  });
});

describe("construcciones (licencias I.6)", () => {
  test("reconoce APIs y patrones", async () => {
    const src = `import { z } from "zod";\nexport async function f(urls: string[]) {\n  const r = await Promise.all(urls.map((u) => fetch(u)));\n  return r.reduce((a, x) => a + 1, 0);\n}\nconst re = /a+/;\n`;
    const c = await construccionesDe(src, langFor("a.ts")!);
    for (const id of ["import:zod", "async-await", "promise-all", "fetch", "reduce", "map-filter", "regex"]) expect(c.has(id), id).toBe(true);
  });
  test("recursión y Python", async () => {
    expect((await construccionesDe("function fact(n) { return n <= 1 ? 1 : n * fact(n - 1); }", langFor("a.js")!)).has("recursion")).toBe(true);
    const py = await construccionesDe("import re\nwith open('a') as f:\n    xs = [x for x in f]\n", langFor("a.py")!);
    expect([...py]).toEqual(expect.arrayContaining(["import:re", "context-manager", "comprension"]));
  });
});

describe("detectores V.5 (sin IA)", () => {
  test("carrera, timer, fetch en bucle, caché, n² y seguridad", async () => {
    const src = `let saldo = 0;
const cache = new Map();
export async function cobrar(m: number) {
  const r = await fetch("/x");
  saldo = saldo + m;
}
export function buscar(xs: number[], ys: number[]) {
  for (const x of xs) { if (ys.includes(x)) return x; }
}
export function avisar() { setTimeout(() => {}, 100); }
export async function todos(urls: string[]) { for (const u of urls) await fetch(u); }
export function memo(k: string) { if (cache.has(k)) return cache.get(k); cache.set(k, 1); }
`;
    const tipos = new Set((await detectar(src, langFor("a.ts")!)).map((h) => h.tipo));
    for (const t of ["carrera", "timer", "fetch-bucle", "cache", "anidado", "estructura"]) expect(tipos.has(t as never), t).toBe(true);
  });
});
