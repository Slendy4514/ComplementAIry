import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { setLLM, type AskOptions } from "../../src/ia/llm.js";
import { setDecisor, type Caso, type Decision as DecisionIa } from "../../src/ia/decisor.js";
import { runHook, type HookOutput } from "../../src/garantias/hook.js";
import * as tarea from "../../src/flujos/tarea.js";
import * as rev from "../../src/flujos/revision.js";
import * as dec from "../../src/flujos/decidir.js";
import { cargarDecisiones, decidir } from "../../src/proyecto/decisiones.js";
import { cargarPedido, cargarTarea, conTarea } from "../../src/proyecto/tareas.js";
import { cargarRegistro, contar, listarRegistros } from "../../src/proyecto/procedencia.js";
import { ganarLicencias, licenciasFaltantes } from "../../src/proyecto/expediente.js";
import { preCommit } from "../../src/garantias/gitHooks.js";
import { registrarEdicion, registrarPrueba, volver } from "../../src/garantias/bucle.js";
import { soloHumano, generadosPor } from "../../src/garantias/snapshot.js";
import { informeSemana, sinRevisar } from "../../src/flujos/informe.js";
import { reglaEfectiva } from "../../src/proyecto/reglas.js";
import { actualizarIndice } from "../../src/proyecto/indice.js";

let root = "";
const git = (args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
const w = (f: string, s: string) => {
  fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
  fs.writeFileSync(path.join(root, f), s);
};
const USERS = `export function obtenerUsuario(id: number) {\n  return { id, nombre: "Ana" };\n}\n`;

/** IA falsa por tipo de pedido (determinista). */
function iaFalsa(respuestas: Record<string, (o: AskOptions) => unknown>): AskOptions[] {
  const llamadas: AskOptions[] = [];
  setLLM(async <T>(o: AskOptions) => {
    llamadas.push(o);
    const f = respuestas[o.kind] ?? respuestas["*"];
    if (!f) throw new Error(`la IA falsa no sabe responder ${o.kind}`);
    return { data: f(o) as T, costUsd: 0, modelo: o.model ?? "falso" };
  });
  return llamadas;
}

/** Decisor falso: vago si el texto dice "mejora el" o "arregla eso"; 3 temas para el pedido de PDF/buscador/tema. */
function decisorFalso(): Caso[] {
  const casos: Caso[] = [];
  setDecisor((c): DecisionIa => {
    casos.push(c);
    const t = c.estado;
    const r: DecisionIa["respuestas"] = {};
    if (c.preguntas.vago) r.vago = { valor: /mejora el|arregla eso/i.test(t), confianza: 0.9 };
    if (c.preguntas.amplio) r.amplio = { valor: /todo el backend/i.test(t), confianza: 0.9 };
    if (c.preguntas.temas) r.temas = { valor: /PDF.*buscador.*tema oscuro/s.test(t) ? 3 : 1, confianza: 0.9 };
    if (c.preguntas.responde) r.responde = { valor: true, confianza: 0.9 };
    if (c.preguntas.explica) r.explica = { valor: true, confianza: 0.9 };
    if (c.preguntas.errores) r.errores = { valor: false, confianza: 0.9 };
    return { respuestas: r, fuente: "falso", dudosa: false, escalada: ["falso"] };
  });
  return casos;
}

const pre = (file: string, old_string: string, new_string: string, sesion = "s1") =>
  runHook({ hook_event_name: "PreToolUse", tool_name: "Edit", session_id: sesion, tool_input: { file_path: path.join(root, file), old_string, new_string } }, root);
const post = (file: string, sesion = "s1") => runHook({ hook_event_name: "PostToolUse", tool_name: "Edit", session_id: sesion, tool_input: { file_path: path.join(root, file) } }, root);
const negado = (o: HookOutput) => (o?.hookSpecificOutput as { permissionDecision?: string } | undefined)?.permissionDecision === "deny";
const razon = (o: HookOutput) => String((o?.hookSpecificOutput as { permissionDecisionReason?: string } | undefined)?.permissionDecisionReason ?? "");

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cai-v1-"));
  process.env.CAI_HOME = path.join(root, ".home");
  process.env.CAI_REPERTORIO = path.join(root, ".home", "repertorio");
  git(["init", "-q"]);
  git(["config", "user.email", "yo@ejemplo.cl"]);
  git(["config", "user.name", "Yo"]);
  w(".cai/config.json", JSON.stringify({ version: 1, zonas: { delegadas: [], criticas: [], rojas: ["src/auth/**"] }, tests: { avisarSinTests: false } }));
  w("src/users.ts", USERS);
  w("src/auth/session.ts", "export const s = 1;\n");
  w("package.json", JSON.stringify({ name: "demo", dependencies: {} }, null, 2));
  // III.2 y III.3: sin tus reglas globales ni las secciones del proyecto, no se aprueba nada.
  w(".home/reglas-globales.md", "# Mis reglas\n\n## Pruebas\nTests de la intención, un caso borde por función.\n");
  w(".cai/reglas.md", "# Reglas\n\n## Stack y versiones\n- typescript@5\n\n## Datos\nSin base de datos.\n\n## API\nSin API pública.\n\n## Ramas\nfeature/<id>\n\n## Pruebas\nvitest\n");
  git(["add", "-A"]);
  git(["commit", "-qm", "inicio"]);
});

afterEach(() => {
  setLLM(null);
  setDecisor(null);
  fs.rmSync(root, { recursive: true, force: true });
});

describe("pedir: separar en temas sin olvidar ninguno", () => {
  test("3 temas → 3 tareas; un tema inventado por la IA se descarta", async () => {
    decisorFalso();
    iaFalsa({
      "pedido:separar": () => ({
        temas: [
          { fragmento: "agrega exportar a PDF", tipo: "funcionalidad", titulo: "PDF" },
          { fragmento: "arregla que el buscador se cuelga", tipo: "bug", titulo: "Buscador" },
          { fragmento: "cambia el color del tema oscuro", tipo: "ui", titulo: "Tema" },
          { fragmento: "manda emails a todos", tipo: "funcionalidad", titulo: "Inventado" },
        ],
      }),
    });
    const r = await tarea.pedir(root, "agrega exportar a PDF, arregla que el buscador se cuelga y cambia el color del tema oscuro");
    expect(r.tareas).toHaveLength(3);
    expect(r.avisos.join(" ")).toMatch(/no estaban en tu texto/);
    const p = cargarPedido(root, r.pedido.id);
    expect(p.temas.every((t) => t.tarea)).toBe(true);
    expect(r.tareas.map((t) => t.tipo)).toEqual(["funcionalidad", "bug", "ui"]);
  });
  test("un pedido vago se rechaza (decisor) y se puede rebatir con tu porqué", async () => {
    decisorFalso();
    await expect(tarea.pedir(root, "mejora el buscador de notas para que responda rápido")).rejects.toThrow(/vago/);
    const r = await tarea.pedir(root, "mejora el buscador de notas para que responda rápido", { rebatir: "en este equipo todos saben que es el debounce del input de búsqueda" });
    expect(r.tareas).toHaveLength(1);
  });
  test("lo objetivo (verbo vacío) no se rebate", async () => {
    decisorFalso();
    await expect(tarea.pedir(root, "arréglalo", { rebatir: "porque sí, confía en mí que es claro" })).rejects.toThrow(/vagas/);
  });
});

async function tareaAprobada(construcciones: string[] = []) {
  decisorFalso();
  iaFalsa({
    "tarea:plan": () => ({
      flujoDeDatos: "el id llega a obtenerUsuario y devuelve el usuario con su campo editable",
      funcionesClave: [{ nombre: "obtenerUsuario", que: "agrega el campo editable" }],
      integracion: ["EditButton lee editable"],
      retos: ["usuarios sin el campo"],
      supuestos: [],
      ambiguedades: [{ pregunta: "¿Columna nullable o con valor por defecto?", opciones: [{ opcion: "nullable", pros: "sin migrar datos", contras: "hay que cuidar null" }, { opcion: "default false", pros: "simple", contras: "migración" }] }],
      archivos: ["src/users.ts"],
      comoProbar: ["obtenerUsuario(7) → editable false"],
      fuentes: [],
      pasos: ["agregar el campo editable al usuario devuelto", "leer editable en el botón de edición"],
      construcciones,
    }),
  });
  const r = await tarea.pedir(root, "Añade un campo `editable` al usuario que devuelve `obtenerUsuario` en src/users.ts");
  const id = r.tareas[0]!.id;
  await expect(tarea.responder(root, id, "alcance", "sí")).rejects.toThrow(/no dicen qué decidiste/);
  await tarea.responder(root, id, "alcance", "solo src/users.ts, el botón lo hago yo");
  await tarea.responder(root, id, "dependencias", "sin dependencias nuevas");
  await tarea.responder(root, id, "preservar", "no cambiar la firma de obtenerUsuario");
  await tarea.responder(root, id, "criterio", "obtenerUsuario(7) → editable: false");
  await tarea.fijarDiseno(root, id, { problema: "solo los dueños deberían poder editar", enfoque: "agregar `editable` en el objeto de `obtenerUsuario`", contexto: ["src/users.ts"] });
  const a = await tarea.avanzar(root, id);
  expect(a.a).toBe("diseñada");
  await tarea.planificar(root, id);
  const d = cargarDecisiones(root).find((x) => x.tarea === id && x.estado === "pendiente" && /nullable/.test(x.pregunta));
  expect(d).toBeTruthy();
  let ap = await tarea.aprobar(root, id, "voy a agregar el campo editable al usuario y luego leerlo en el botón de edición");
  expect(ap.faltan.join(" ")).toMatch(/decide primero/);
  for (const x of cargarDecisiones(root).filter((y) => y.tarea === id && y.estado === "pendiente")) decidir(root, x.id, x.opciones[1]?.opcion ?? x.opciones[0]!.opcion);
  ap = await tarea.aprobar(root, id, "voy a agregar el campo editable al usuario y luego leerlo en el botón de edición");
  return { id, ap };
}

describe("de la entrevista a la ejecución", () => {
  test("flujo completo hasta aprobada; «preservar la firma» protege solo la firma", async () => {
    const { id, ap } = await tareaAprobada();
    expect(ap.faltan).toEqual([]);
    const t = cargarTarea(root, id);
    expect(t.estado).toBe("aprobada");
    expect(t.restricciones.alcance).toEqual(["src/users.ts"]);
    expect(t.restricciones.sinDependencias).toBe(true);
    expect(t.restricciones.preservar).toEqual(["src/users.ts#obtenerUsuario@firma"]);
  });
  test("sin reglas globales no se aprueba (III.2)", async () => {
    fs.rmSync(path.join(root, ".home/reglas-globales.md"));
    const { ap } = await tareaAprobada();
    expect(ap.faltan.join(" ")).toMatch(/reglas globales/);
  });
  test("licencias (I.6): sin haber escrito la construcción a mano, no se aprueba", async () => {
    const { id, ap } = await tareaAprobada(["promise-all"]);
    expect(ap.faltan.join(" ")).toMatch(/licencias que faltan/);
    ganarLicencias(["promise-all"], "kata", root, "kata k1");
    expect(licenciasFaltantes(["promise-all"])).toEqual([]);
    const ap2 = await tarea.aprobar(root, id, "voy a agregar el campo editable al usuario y luego leerlo en el botón de edición");
    expect(ap2.faltan).toEqual([]);
  });
});

describe("el hook dentro de una tarea en ejecución", () => {
  async function ejecutando() {
    const { id } = await tareaAprobada();
    const r = await tarea.ejecutar(root, id, { sesion: "s1" });
    expect(r.faltan).toEqual([]);
    return id;
  }
  test("sin tarea, la IA no escribe código", async () => {
    expect(negado(await pre("src/users.ts", '"Ana"', '"Bea"'))).toBe(true);
  });
  test("en el alcance sí; fuera del alcance, en línea roja, con dependencias o de otra sesión, no", async () => {
    await ejecutando();
    expect(negado(await pre("src/users.ts", '"Ana"', '"Ana", editable: false'))).toBe(false);
    expect(negado(await pre("src/auth/session.ts", "= 1", "= 2"))).toBe(true);
    expect(razon(await pre("src/auth/session.ts", "= 1", "= 2"))).toMatch(/LÍNEA ROJA/);
    expect(razon(await pre("package.json", '"dependencies": {}', '"dependencies": { "lodash": "4" }'))).toMatch(/SIN dependencias/);
    expect(negado(await pre("src/users.ts", '"Ana"', '"Bea"', "otra-sesion"))).toBe(true);
  });
  test("presupuesto: una edición enorme se rechaza (pasos chicos)", async () => {
    const id = await ejecutando();
    conTarea(root, id, (t) => ({ ...t, restricciones: { ...t.restricciones, presupuestoLineas: 3 } }));
    const grande = Array.from({ length: 10 }, (_, i) => `  const v${i} = ${i};`).join("\n");
    expect(razon(await pre("src/users.ts", "  return", `${grande}\n  return`))).toMatch(/presupuesto/);
  });
  test("refactorizar alrededor (V.4.3): la IA no pisa una línea que escribiste a mano en la tarea", async () => {
    await ejecutando();
    const tuyo = USERS.replace('  return { id, nombre: "Ana" };', '  const nombre = "Ana"; // lo puse yo\n  return { id, nombre };');
    fs.writeFileSync(path.join(root, "src/users.ts"), tuyo);
    const r = await pre("src/users.ts", '  const nombre = "Ana"; // lo puse yo\n', "  const nombre = buscarNombre(id);\n");
    expect(razon(r)).toMatch(/refactoriza ALREDEDOR/);
    // Alrededor sí: agregar algo sin tocar tus líneas.
    const r2 = await pre("src/users.ts", "  return { id, nombre };", "  const editable = false;\n  return { id, nombre };");
    expect(razon(r2)).toBe("");
  });
  test("una construcción sin licencia se rechaza en la edición misma", async () => {
    await ejecutando();
    const r = await pre("src/users.ts", '  return { id, nombre: "Ana" };', '  const r = await fetch("/u/" + id);\n  return { id, nombre: "Ana" };');
    expect(razon(r)).toMatch(/Regla de Oro del Aprendiz/);
  });
  test("procedencia → revisión con evidencia → pre-commit", async () => {
    const id = await ejecutando();
    const antes = fs.readFileSync(path.join(root, "src/users.ts"), "utf8");
    expect(negado(await pre("src/users.ts", '"Ana" }', '"Ana", editable: false }'))).toBe(false);
    fs.writeFileSync(path.join(root, "src/users.ts"), antes.replace('"Ana" }', '"Ana", editable: false }'));
    await post("src/users.ts");
    const reg = cargarRegistro(root, "src/users.ts")!;
    expect(reg.lineas.filter((l) => l.o === "ia" && l.t === id)).toHaveLength(1);
    expect(sinRevisar(root).resumen.join(" ")).toMatch(/Sin revisar por un humano.*: 1/);
    git(["add", "src/users.ts"]);
    expect((await preCommit(root)).length).toBeGreaterThan(0);
    let a = await tarea.avanzar(root, id);
    expect(a.a).toBe("en-revision");
    const ts = await rev.tramosARevisar(root, cargarTarea(root, id));
    expect(ts).toHaveLength(1);
    const r = await rev.evidenciaExplicacion(root, id, "1", "obtenerUsuario ahora devuelve también editable en false para que el botón de edición sepa que este usuario no puede editar todavía", 4);
    // El tipo pedido puede ser otro (polimorfismo): si pedía nivel 3, la explicación no alcanza.
    if (ts[0]!.minimo > 2) expect(r.ok).toBe(false);
    else {
      expect(r.ok).toBe(true);
      a = await tarea.avanzar(root, id);
      expect(a.a).toBe("revisada");
      expect(contar(listarRegistros(root)).sinRevisar).toBe(0);
    }
  });
});

describe("pull the plug (V.7)", () => {
  test("el mismo fallo 3 veces + oscilación → desconectada; volver deja el trabajo en una rama", async () => {
    decisorFalso();
    const { id } = await tareaAprobada();
    await tarea.ejecutar(root, id, { sesion: "s1" });
    let t = cargarTarea(root, id);
    for (let i = 0; i < 3; i++) registrarPrueba(root, t, "FAIL src/users.test.ts > TypeError: x is undefined at 12:3", false);
    registrarEdicion(root, t, "src/users.ts", "A", 1);
    registrarEdicion(root, t, "src/users.ts", "B", 2);
    registrarEdicion(root, t, "src/users.ts", "A", 3);
    t = cargarTarea(root, id);
    expect(t.estado).toBe("desconectada");
    expect(negado(await pre("src/users.ts", '"Ana"', '"Bea"'))).toBe(true);
    fs.writeFileSync(path.join(root, "src/users.ts"), USERS + "// roto\n");
    conTarea(root, id, (x) => ({ ...x, tocados: ["src/users.ts"] }));
    const v = volver(root, id, "el problema era el formato de la fecha, no el parser; lo planteo de nuevo");
    expect(v.rama).toMatch(/^cai\/abandono-/);
    expect(fs.readFileSync(path.join(root, "src/users.ts"), "utf8")).toBe(USERS);
    expect(cargarTarea(root, id).estado).toBe("diseñada");
  });
});

describe("decisiones con matriz", () => {
  test("pesos antes, tus puntajes, sensibilidad, discrepancias con la IA piden nota, cierre con ADR", async () => {
    const { proponerDecisiones } = await import("../../src/proyecto/decisiones.js");
    const [d] = proponerDecisiones(root, [{ pregunta: "¿Qué base de datos usamos?", opciones: [{ opcion: "SQLite", consecuencia: "" }, { opcion: "Postgres", consecuencia: "" }] }], {}, "test");
    dec.fijarCriterios(root, d!.id, [{ nombre: "simplicidad", peso: 60 }, { nombre: "escala", peso: 40 }]);
    iaFalsa({ "decidir:puntajes": () => ({ puntajes: [{ opcion: "SQLite", criterio: "simplicidad", puntaje: 2, evidencia: "x" }] }) });
    await dec.puntajesIa(root, d!.id);
    const r = dec.puntuar(root, d!.id, { SQLite: { simplicidad: 5, escala: 2 }, Postgres: { simplicidad: 3, escala: 5 } });
    expect(r.resultado.ganador).toBe("SQLite");
    expect(r.discrepancias).toHaveLength(1);
    expect(() => dec.fijarCriterios(root, d!.id, [{ nombre: "simplicidad", peso: 50 }, { nombre: "escala", peso: 50 }])).toThrow(/acomodar el resultado/);
    expect(() => dec.cerrar(root, d!.id, "SQLite", "es un proyecto chico y local por ahora")).toThrow(/anota por qué difieres/);
    dec.anotar(root, d!.id, "SQLite/simplicidad", "la IA asumió despliegue en servidor, pero es local");
    const c = dec.cerrar(root, d!.id, "SQLite", "es un proyecto chico y local por ahora", { adr: true, cambiaria: "si hay más de un usuario concurrente" });
    expect(c.estado).toBe("vigente");
    expect(fs.existsSync(path.join(root, c.adr!))).toBe(true);
  });
  test("una decisión de arquitectura (disparador) solo se cierra con ADR", async () => {
    const { proponerDecisiones } = await import("../../src/proyecto/decisiones.js");
    const [d] = proponerDecisiones(root, [{ pregunta: "¿Crear el módulo nuevo src/pagos/?", opciones: [{ opcion: "Crear", consecuencia: "" }, { opcion: "No", consecuencia: "" }] }], {}, "disparador: plan de t1");
    expect(() => dec.cerrar(root, d!.id, "Crear", "los pagos tienen reglas propias y crecen solos")).toThrow(/--adr/);
    expect(dec.cerrar(root, d!.id, "Crear", "los pagos tienen reglas propias y crecen solos", { adr: true }).adr).toBeTruthy();
  });
});

describe("carpetas sin IA, comandos solo humanos, reglas", () => {
  test("en una kata o reconstrucción el hook bloquea todo prompt y toda herramienta", async () => {
    w(".cai/cache/sin-ia.json", "{}");
    const p = await runHook({ hook_event_name: "UserPromptSubmit", prompt: "hazlo tú" }, root);
    expect((p as { decision?: string }).decision).toBe("block");
    expect(negado(await runHook({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "x" } }, root))).toBe(true);
    expect(negado(await runHook({ hook_event_name: "PreToolUse", tool_name: "WebFetch", tool_input: { url: "https://developer.mozilla.org/es/docs/Web" } }, root))).toBe(false);
  });
  test("la IA no puede responder la entrevista, aprobar, dar evidencia ni decidir por ti", () => {
    for (const c of ['cai tarea t1 --responder alcance "src"', 'cai tarea t1 --aprobar "x"', "cai tarea t1 --ejecutar", 'cai revisar --tarea t1 --tramo 1 --explicacion "x"', 'cai revisar --archivo a.ts --tramo 1 --llamada "f(1)" --espero 2', 'cai decidir d1 --elegir "A" --porque "x"', 'cai pedir "algo"', "cai volver t1", "cai kata regex", "cai githook pre-commit", "cai asentar a.ts"])
      expect(soloHumano(c), c).not.toBeNull();
    for (const c of ["cai avanzar t1", "cai tarea t1 --planificar", "cai informe", 'cai chat --texto "quiero volver a revisar"']) expect(soloHumano(c), c).toBeNull();
    expect(generadosPor("cai avanzar t1")!(".cai/tareas/t1/tarea.json", null, Buffer.from("{}"))).toBe(true);
    expect(generadosPor("cai informe")!(".cai/procedencia/x.json", null, Buffer.from("{}"))).toBe(false);
  });
  test("reglas: la línea roja manda y se ve de qué capa viene", () => {
    w(".cai/reglas/api.md", "---\npaths: [src/api/**]\nroja: true\n---\nLa API valida todo con zod.\n");
    const r = reglaEfectiva(root, "src/api/x.ts");
    expect(r[0]!.origen).toBe("roja");
    expect(r.some((x) => x.origen.startsWith("carpeta"))).toBe(true);
  });
  test("informe semanal y SessionStart sin tarea (modo exploración)", async () => {
    await actualizarIndice(root);
    expect(informeSemana(root).join("\n")).toMatch(/Tareas cerradas/);
    const s = await runHook({ hook_event_name: "SessionStart", session_id: "s9" }, root);
    expect(JSON.stringify(s)).toMatch(/EXPLORACIÓN/);
  });
});
