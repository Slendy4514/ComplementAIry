import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { setDecisor } from "../../src/ia/decisor.js";
import { renombrar } from "../../src/flujos/renombrar.js";
import { cargarRegistro, asentar } from "../../src/proyecto/procedencia.js";
import { criteriosQueFallan, extraerRutas } from "../../src/flujos/tarea.js";
import { setLLM, type AskOptions } from "../../src/ia/llm.js";
import { crearTarea, conTarea, cargarTarea } from "../../src/proyecto/tareas.js";
import { crearTarjeta, verificarTarjeta } from "../../src/flujos/mapa.js";
import { actualizarIndice } from "../../src/proyecto/indice.js";
import { ejecutarLlamada, partirCriterio } from "../../src/flujos/ejecutarLlamada.js";
import * as rev from "../../src/flujos/revision.js";
import { loadConfig } from "../../src/proyecto/config.js";
import { modoEfectivo } from "../../src/proyecto/modos.js";

let root = "";
const w = (f: string, s: string) => {
  fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
  fs.writeFileSync(path.join(root, f), s);
};
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cai-plan-"));
  process.env.CAI_HOME = path.join(root, ".home");
  execFileSync("git", ["init", "-q"], { cwd: root });
  w(".cai/config.json", "{}");
});
afterEach(() => {
  setDecisor(null);
  setLLM(null);
  fs.rmSync(root, { recursive: true, force: true });
});

describe("renombrar con una herramienta determinista (8.2)", () => {
  test("renombra solo el identificador, verifica, y las líneas quedan como «herramienta»", async () => {
    w("src/a.ts", 'export function getUsr(id: number) {\n  return { id, nota: "getUsr no se toca en strings" };\n}\n');
    w("src/b.ts", 'import { getUsr } from "./a.js";\nexport const u = getUsr(1);\n');
    asentar(root, "src/a.ts", fs.readFileSync(path.join(root, "src/a.ts"), "utf8"), { origen: "humano" });
    const r = await renombrar(root, "getUsr", "obtenerUsuario");
    expect(r.archivos.map((x) => x.archivo).sort()).toEqual(["src/a.ts", "src/b.ts"]);
    const a = fs.readFileSync(path.join(root, "src/a.ts"), "utf8");
    expect(a).toContain("export function obtenerUsuario(id: number)");
    expect(a).toContain('"getUsr no se toca en strings"');
    expect(cargarRegistro(root, "src/a.ts")!.lineas[0]!.o).toBe("herramienta");
    w("src/c.ts", "export const obtenerUsuario2 = 1;\nexport const x = 2;\n");
    await expect(renombrar(root, "x", "obtenerUsuario2")).rejects.toThrow(/ya existe/);
  });
});

describe("criterios y predicciones que se EJECUTAN", () => {
  test("partirCriterio y ejecución aislada de una función no exportada", async () => {
    expect(partirCriterio("total([1, 2]) → 3")).toEqual({ llamada: "total([1, 2])", esperado: "3" });
    expect(partirCriterio("que funcione bien")).toBeNull();
    w("src/s.js", "function doble(x) { return x * 2; }\n");
    const r = await ejecutarLlamada(root, "src/s.js", "doble(21)");
    expect(r.ok && r.valor).toBe(42);
  });
  test("un criterio del diseño que no se cumple bloquea «probada»", async () => {
    w("src/t.ts", "export function total(xs: number[]): number {\n  return xs.length;\n}\n");
    await actualizarIndice(root);
    const t = crearTarea(root, { titulo: "total" });
    conTarea(root, t.id, (x) => ({ ...x, tocados: ["src/t.ts"], diseno: { problema: "", enfoque: "", contexto: [], criterios: ["total([1, 2]) → 3", "texto libre"] } }));
    expect(await criteriosQueFallan(root, cargarTarea(root, t.id))).toEqual(["total([1, 2]) da 2, esperabas 3"]);
    w("src/t.ts", "export function total(xs: number[]): number {\n  return xs.reduce((a, b) => a + b, 0);\n}\n");
    expect(await criteriosQueFallan(root, cargarTarea(root, t.id))).toEqual([]);
  }, 60_000);
  test("la predicción de una tarjeta se ejecuta: si falla, la tarjeta no queda vigente", async () => {
    w("src/billing/total.ts", "export function total(xs: number[]): number {\n  return xs.reduce((a, b) => a + b, 0);\n}\n");
    await actualizarIndice(root);
    const f = path.join(root, crearTarjeta(root, "src/billing"));
    const llenar = (pred: string) => fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/## Propósito[\s\S]*$/, `## Propósito\nSumar los montos de una factura.\n\n## Invariantes\nEl total nunca es negativo si los montos no lo son.\n\n## Llama a\nNada externo, usa reduce.\n\n## Lo llaman\nla factura\n\n## Predicción\n${pred}\n`));
    llenar("total([1, 2]) → 4");
    expect((await verificarTarjeta(root, "src/billing")).motivos.join(" ")).toMatch(/tu predicción falló/);
    llenar("total([1, 2]) → 3");
    expect((await verificarTarjeta(root, "src/billing")).ok).toBe(true);
  }, 60_000);
  test("predecir sin declarar tu seguridad no vale (II.2: calibración)", async () => {
    w("src/p.ts", "export function f(x: number) {\n  return x + 1;\n}\n");
    asentar(root, "src/p.ts", "", { origen: "humano" });
    asentar(root, "src/p.ts", fs.readFileSync(path.join(root, "src/p.ts"), "utf8"), { origen: "ia" });
    await expect(rev.evidenciaPrediccion(root, "@src/p.ts", "1", "f(1)", "2")).rejects.toThrow(/seguro/);
    const r = await rev.evidenciaPrediccion(root, "@src/p.ts", "1", "f(1)", "2", 4);
    expect(r.ok).toBe(true);
    expect(cargarRegistro(root, "src/p.ts")!.lineas.every((l) => l.n >= 3)).toBe(true);
  }, 60_000);
});

describe("II.5: la intención de la tarea decide la ayuda en su alcance", () => {
  test("tarea de aprender → modo aprender en sus archivos; lo configurado a mano manda", () => {
    const t = crearTarea(root, { titulo: "aprender regex", intencion: "aprender" });
    conTarea(root, t.id, (x) => ({ ...x, estado: "diseñada", restricciones: { ...x.restricciones, alcance: ["src/parser/**", "src/uno.ts"] } }));
    expect(modoEfectivo(loadConfig(root), "src/parser/a.ts").modo).toBe("aprender");
    expect(modoEfectivo(loadConfig(root), "src/uno.ts").modo).toBe("aprender");
    expect(modoEfectivo(loadConfig(root), "src/otro.ts").modo).toBe("sugerir");
    w(".cai/config.json", JSON.stringify({ modosVersion: 2, modos: { porArchivo: { "src/uno.ts": "programar" } } }));
    expect(modoEfectivo(loadConfig(root), "src/uno.ts").modo).toBe("programar");
  });
});

describe("lo que extrae la IA chica se valida sin IA", () => {
  test("«el resto» no es un archivo: solo quedan rutas, identificadores o funciones que existen", async () => {
    w("src/cuota.ts", "export function calcularCuota() { return 1; }\n");
    actualizarIndice(root);
    setLLM(async <T>(o: AskOptions) => ({ data: { incluir: ["src/users.ts", "todo"], excluir: ["el resto", "calcularCuota", "inventado.ts"] } as T, costUsd: 0, modelo: o.model ?? "falso" }));
    const r = await extraerRutas(root, "¿Qué se puede tocar?", "solo src/users.ts y todo eso; el resto no se toca, calcularCuota tampoco");
    expect(r.incluir).toEqual(["src/users.ts"]);
    expect(r.excluir).toEqual(["calcularCuota"]);
  });
});
