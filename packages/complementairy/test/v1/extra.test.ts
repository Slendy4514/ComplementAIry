import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { setLLM, type AskOptions } from "../../src/ia/llm.js";
import { aSystemOne, leerSystemOne, setDecisor } from "../../src/ia/decisor.js";
import { atender } from "../../src/cli/mcp.js";
import { migrar } from "../../src/flujos/migrar.js";
import { adoptar, sinRevisar } from "../../src/flujos/informe.js";
import { crearTarea, conTarea, cargarTarea, listarTareas } from "../../src/proyecto/tareas.js";
import { cargarDecisiones } from "../../src/proyecto/decisiones.js";
import { asentar, cargarRegistro, marcarOrigen, registrarInsercionIa, unirRegistros, type Registro } from "../../src/proyecto/procedencia.js";
import { mergeProcedencia } from "../../src/garantias/gitHooks.js";
import { nuevaKata, verificarKata } from "../../src/flujos/practica.js";
import { cargarLicencias } from "../../src/proyecto/expediente.js";
import { doctorV1 } from "../../src/cli/doctor.js";
import { argsGit, permisoRol } from "../../src/flujos/agentes.js";
import { mutar } from "../../src/flujos/revision.js";
import { trazaReal } from "../../src/flujos/mapa.js";
import { disparadores } from "../../src/flujos/tarea.js";
import { edicionPermitida } from "../../src/garantias/tareaHook.js";
import { makeZoner } from "../../src/proyecto/config.js";

let root = "";
const w = (f: string, s: string) => {
  fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
  fs.writeFileSync(path.join(root, f), s);
};
const git = (args: string[], env: Record<string, string> = {}) => execFileSync("git", args, { cwd: root, stdio: "ignore", env: { ...process.env, ...env } });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cai-v1x-"));
  process.env.CAI_HOME = path.join(root, ".home");
  git(["init", "-q"]);
  git(["config", "user.email", "yo@ejemplo.cl"]);
  git(["config", "user.name", "Yo"]);
});
afterEach(() => {
  setLLM(null);
  setDecisor(null);
  fs.rmSync(root, { recursive: true, force: true });
});

describe("MCP propio", () => {
  test("lista herramientas; proponer plan valida el esquema, rechaza código y abre decisiones", async () => {
    w(".cai/config.json", "{}");
    const t = crearTarea(root, { titulo: "Campo editable" });
    conTarea(root, t.id, (x) => ({ ...x, estado: "diseñada" }));
    const lista = (await atender(root, { id: 1, method: "tools/list" }))!.result as { tools: { name: string }[] };
    expect(lista.tools.map((x) => x.name)).toContain("cai_proponer_plan");
    const base = { tarea: t.id, flujoDeDatos: "el id entra y sale el usuario con editable", funcionesClave: [{ nombre: "obtenerUsuario", que: "agrega editable" }], integracion: [], retos: [], supuestos: [], ambiguedades: [{ pregunta: "¿nullable o default?", opciones: [{ opcion: "nullable", pros: "a", contras: "b" }, { opcion: "default", pros: "c", contras: "d" }] }], archivos: ["src/users.ts"], comoProbar: ["obtenerUsuario(1) → editable false"], pasos: ["agregar el campo", "leerlo en el botón"], construcciones: [] };
    const conCodigo = (await atender(root, { id: 2, method: "tools/call", params: { name: "cai_proponer_plan", arguments: { ...base, pasos: ["`const x = a === b`", "otro"] } } }))!.result as { isError?: boolean };
    expect(conCodigo.isError).toBe(true);
    const ok = (await atender(root, { id: 3, method: "tools/call", params: { name: "cai_proponer_plan", arguments: base } }))!.result as { isError?: boolean };
    expect(ok.isError).toBeUndefined();
    expect(cargarTarea(root, t.id).estado).toBe("planificada");
    expect(cargarDecisiones(root).some((d) => d.tarea === t.id && d.estado === "pendiente")).toBe(true);
  });
});

describe("migrar de v0.11", () => {
  test("simula sin escribir; aplica: críticas → rojas, descarta modos, tareas viejas → borrador, respaldo", () => {
    w(".cai/config.json", JSON.stringify({ zonas: { delegadas: [], criticas: ["src/pagos/**"] }, modo: "programar", modos: { porArchivo: {} }, vista: "notas" }));
    w(".cai/tareas.json", JSON.stringify({ tareas: [{ id: "t1", titulo: "Validar meses", hecha: false, origen: "manual", creada: "" }, { id: "t2", titulo: "Hecha", hecha: true, origen: "manual", creada: "" }] }));
    w("src/a.ts", "export const a = 1;\n");
    git(["add", "-A"]);
    git(["commit", "-qm", "v0"]);
    const sim = migrar(root, false);
    expect(sim.acciones.join(" ")).toMatch(/1 tarea/);
    expect(JSON.parse(fs.readFileSync(path.join(root, ".cai/config.json"), "utf8")).version).toBeUndefined();
    const r = migrar(root, true);
    const cfg = JSON.parse(fs.readFileSync(path.join(root, ".cai/config.json"), "utf8"));
    expect(cfg.version).toBe(1);
    expect(cfg.zonas.rojas).toEqual(["src/pagos/**"]);
    expect(cfg.modo).toBeUndefined();
    expect(listarTareas(root).map((t) => t.titulo)).toEqual(["Validar meses"]);
    expect(fs.readdirSync(root).some((f) => f.startsWith(".cai.v0-"))).toBe(true);
    expect(r.avisos.join(" ")).toMatch(/NUNCA/);
    expect(migrar(root, true).yaMigrado).toBe(true);
  });
});

describe("adoptar y procedencia con git blame", () => {
  test("tuyo previo, heredado e IA previa (trailer)", () => {
    w(".cai/config.json", "{}");
    w("a.ts", "export const mia = 1;\n");
    git(["add", "-A"]);
    git(["commit", "-qm", "mío"]);
    w("b.ts", "export const ajena = 2;\n");
    git(["add", "b.ts"]);
    git(["commit", "-qm", "de otra persona"], { GIT_AUTHOR_EMAIL: "otra@x.cl", GIT_COMMITTER_EMAIL: "otra@x.cl" });
    w("c.ts", "export const ia = 3;\n");
    git(["add", "c.ts"]);
    git(["commit", "-qm", "feat\n\nCo-Authored-By: Claude <noreply@anthropic.com>"]);
    adoptar(root);
    expect(cargarRegistro(root, "a.ts")!.lineas[0]!.o).toBe("previo-propio");
    expect(cargarRegistro(root, "b.ts")!.lineas[0]!.o).toBe("heredado");
    expect(cargarRegistro(root, "c.ts")!.lineas[0]!.o).toBe("ia-previa");
    expect(sinRevisar(root, { incluirAjeno: true }).filas.length).toBeGreaterThan(0);
  });
  test("código de la IA insertado con tu clic sigue siendo de la IA; lo pegado de una vez necesita revisión", () => {
    w(".cai/config.json", "{}");
    w("p.js", "export function a() {\n  return 1;\n}\n");
    asentar(root, "p.js", fs.readFileSync(path.join(root, "p.js"), "utf8"), { origen: "humano" });
    registrarInsercionIa(root, "p.js", "  const doble = x * 2;\n  return doble;", 3, "construir:construir");
    const nuevo = "export function a() {\n  const doble = x * 2;\n  return doble;\n}\nexport const pegada = 1;\nexport const otra = 2;\n";
    w("p.js", nuevo);
    asentar(root, "p.js", nuevo, { origen: "humano" });
    marcarOrigen(root, "p.js", [4, 5], "pegado");
    const ls = cargarRegistro(root, "p.js")!.lineas;
    expect(ls.map((l) => l.o)).toEqual(["humano", "ia", "ia", "humano", "pegado", "pegado"]);
    expect(ls[1]!.n).toBe(3);
  });
  test("merge driver: une por huella y gana el nivel más alto", () => {
    const reg = (n: number): Registro => ({ version: 1, archivo: "x.ts", actualizado: "", lineas: [{ h: "a", o: "ia", n }, { h: "b", o: "humano", n: 4 }] });
    expect(unirRegistros(null, reg(0), reg(3)).lineas[0]!.n).toBe(3);
    const f = (n: string, r: Registro) => {
      const p = path.join(root, n);
      fs.writeFileSync(p, JSON.stringify(r));
      return p;
    };
    const A = f("A", reg(0));
    mergeProcedencia(f("O", reg(0)), A, f("B", reg(2)));
    expect((JSON.parse(fs.readFileSync(A, "utf8")) as Registro).lineas[0]!.n).toBe(2);
  });
});

describe("kata (I.6): sin IA, tu caso + uno oculto, gana la licencia", () => {
  test("una solución que no usa la construcción no vale; la correcta gana la licencia", async () => {
    w(".cai/config.json", "{}");
    setLLM(async <T>(o: AskOptions) => {
      expect(o.kind).toBe("kata");
      return { data: { consigna: "Suma los números de una lista", funcion: "sumar", firma: "function sumar(xs: number[]): number", oculto: { llamada: "sumar([1,2,3])", esperado: "6" } } as T, costUsd: 0 };
    });
    const k = await nuevaKata(root, "reduce");
    expect(fs.existsSync(path.join(k.dir, ".cai/cache/sin-ia.json"))).toBe(true);
    fs.writeFileSync(path.join(k.dir, k.archivo), "export function sumar(xs: number[]): number {\n  let s = 0;\n  for (const x of xs) s += x;\n  return s;\n}\n");
    fs.writeFileSync(path.join(k.dir, "caso.json"), JSON.stringify({ llamada: "sumar([2,2])", esperado: "4" }));
    expect((await verificarKata(k.id)).ok).toBe(false);
    fs.writeFileSync(path.join(k.dir, k.archivo), "export function sumar(xs: number[]): number {\n  return xs.reduce((a, b) => a + b, 0);\n}\n");
    const r = await verificarKata(k.id);
    expect(r.mensajes.join("\n")).toMatch(/caso oculto/);
    expect(r.ok).toBe(true);
    expect(cargarLicencias().reduce).toBeTruthy();
  }, 60_000);
});

describe("traza real y disparadores", () => {
  test("la cobertura de V8 muestra qué funciones corrieron de verdad", () => {
    w(".cai/config.json", "{}");
    w("src/f.ts", "export function total(xs: number[]): number {\n  return xs.reduce(sumar, 0);\n}\nfunction sumar(a: number, b: number) {\n  return a + b;\n}\nexport function nunca() {\n  return 0;\n}\n");
    const r = trazaReal(root, "src/f.ts", "total([1,2])", ["total", "nunca"]);
    expect(r.resultado).toBe("3");
    expect(r.corrieron).toEqual(expect.arrayContaining(["total", "sumar"]));
    expect(r.noCorrieron).toEqual(["nunca"]);
    expect(r.sorpresa).toEqual(["sumar"]);
  }, 60_000);
  test("módulo nuevo, esquema y API pública disparan decisiones", () => {
    w("src/a.ts", "");
    const d = disparadores(root, ["src/a.ts", "src/pagos/cobro.ts", "src/api/users.ts"], "agrega la columna editable a la tabla users y expone GET /api/users/:id");
    expect(d.map((x) => x.pregunta).join(" | ")).toMatch(/módulo nuevo src\/pagos.*esquema.*API pública/);
  });
});

describe("preservar: la firma o la función entera", () => {
  test("@firma deja cambiar el cuerpo pero no la firma; sin @firma no se toca nada", async () => {
    w(".cai/config.json", "{}");
    const antes = "export function f(a: number) {\n  return a;\n}\n";
    w("src/f.ts", antes);
    const t = crearTarea(root, { titulo: "x" });
    const conPreservar = (p: string) => conTarea(root, t.id, (x) => ({ ...x, estado: "ejecutando", restricciones: { ...x.restricciones, alcance: ["src/**"], preservar: [p] } }));
    const z = makeZoner(root);
    const abs = path.join(root, "src/f.ts");
    const cuerpo = "export function f(a: number) {\n  return a + 1;\n}\n";
    const firma = "export function f(a: number, b = 0) {\n  return a;\n}\n";
    let tt = conPreservar("src/f.ts#f@firma");
    expect(await edicionPermitida(z, tt, abs, antes, cuerpo)).toBeNull();
    expect(await edicionPermitida(z, tt, abs, antes, firma)).toMatch(/su firma/);
    tt = conPreservar("src/f.ts#f");
    expect(await edicionPermitida(z, tt, abs, antes, cuerpo)).toMatch(/PRESERVAR/);
  });
});

describe("piezas sueltas", () => {
  test("doctor v1 exige reglas globales y secciones del proyecto", () => {
    w(".cai/config.json", "{}");
    const c = doctorV1(root);
    expect(c.some((x) => x.ok === false && /reglas globales/.test(x.que))).toBe(true);
    expect(c.some((x) => /faltan Stack y versiones/.test(x.que))).toBe(true);
  });
  test("respuesta System One: formatos tolerados", () => {
    const q = { vago: { type: "noul" as const }, cat: { type: "choice" as const, options: ["a", "b"] } };
    expect(leerSystemOne({ answers: { vago: { value: true, probability: 0.8 }, cat: { probabilities: { a: 0.3, b: 0.7 } } } }, q)).toEqual({ vago: { valor: true, confianza: 0.8 }, cat: { valor: "b", confianza: 0.7 } });
    expect(leerSystemOne({ vago: { yes: 0.2 } }, q).vago).toEqual({ valor: false, confianza: 0.8 });
  });
  test("System One con el formato publicado de Jev (también tev1/nimble en Ollama): ida y vuelta", () => {
    const q = { vago: { type: "noul" as const, description: "¿es vago?" }, cat: { type: "choice" as const, options: ["a", "b"] }, temas: { type: "score" as const, min: 1, max: 6 } };
    expect(aSystemOne(q)).toEqual({
      vago: { type: "noul", instructions: "¿es vago?" },
      cat: { type: "choice", instructions: "cat", criteria: { a: "a", b: "b" } },
      temas: { type: "score", instructions: "temas", criteria: ["1", "2", "3", "4", "5", "6"] },
    });
    const respuesta = {
      model: "jev-1.13.0",
      answers: {
        vago: { type: "noul", noul: 0.9 },
        cat: { type: "choice", choice: "a", probabilities: { a: 0.6, b: 0.4 }, confidence: 0.55 },
        temas: { type: "score", score: 2.1, legend: { "0": "1", "1": "2", "2": "3" }, probabilities: { "0": 0.1, "2": 0.8, "3": 0.1 }, confidence: 0.8 },
      },
    };
    expect(leerSystemOne(respuesta, q)).toEqual({ vago: { valor: true, confianza: 0.9 }, cat: { valor: "a", confianza: 0.55 }, temas: { valor: 3, confianza: 0.8 } });
  });
  test("git en lenguaje natural: sin shell ni encadenamientos", () => {
    expect(argsGit('git commit -m "hola mundo"')).toEqual(["commit", "-m", "hola mundo"]);
    expect(() => argsGit("git status; rm -rf /")).toThrow(/encadenamientos/);
    expect(() => argsGit("rm -rf /")).toThrow(/solo comandos git/);
  });
  test("permisos por rol, impuestos en código", () => {
    const t = { ...crearTarea(root, { titulo: "x" }), restricciones: { alcance: ["src/**"], sinDependencias: true, preservar: [], presupuestoLineas: 150 } };
    expect(permisoRol("tester", t, "Read", "src/a.ts")).toMatch(/NO lee la implementación/);
    expect(permisoRol("tester", t, "Grep", undefined)).toMatch(/no busca/);
    expect(permisoRol("tester", t, "Write", "src/a.test.ts")).toBeNull();
    expect(permisoRol("tester", t, "Write", "src/a.ts")).toMatch(/solo escribe tests/);
    expect(permisoRol("implementador", t, "Edit", "src/a.test.ts")).toMatch(/no escribe tests/);
    expect(permisoRol("implementador", t, "Edit", "otro/a.ts")).toMatch(/fuera del alcance/);
    expect(permisoRol("implementador", t, "Bash", undefined)).toMatch(/terminal/);
    expect(permisoRol("revisor", t, "Edit", "src/a.ts")).toMatch(/solo lee/);
    expect(permisoRol("refactorizador", t, "Edit", "src/a.test.ts")).toMatch(/congelados/);
  });
  test("mutante: niega el primer operador", () => {
    expect(mutar("  if (a === b) {")).toBe("  if (a !== b) {");
    expect(mutar("  if (x < 3) {")).toBe("  if (x >= 3) {");
    expect(mutar("  return () => x;")).toBe("  return () => x;");
  });
});
