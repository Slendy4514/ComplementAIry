import crypto from "node:crypto";
import { cargarNotas, guardarNotas, mensaje, nuevaNota } from "./notas.js";
import { responderNota } from "./responder.js";
import { conBloqueo, enCurso, ocupar } from "./ocupado.js";
import { actualizarTareas, agregarTareas, cargarTareas, guardarDiagnosticos, guardarTareas, rutasDe, siguiente } from "./siguiente.js";
import { planoArchivo } from "./planoArchivo.js";
import { separarListas } from "./render.js";
import { iaOpts } from "./tutor.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cleanText, conversation } from "./guia.js";
import { runHook, type HookOutput } from "./hook.js";
import { leerUso, setLLM, type AskOptions } from "./llm.js";
import { loadPerfil } from "./profile.js";
import { runGuia } from "./tutor.js";
import { crearSnippet } from "./snippets.js";
import { reglasDiags } from "./gate.js";
import { runReview } from "./review.js";
import { coincide, validarExpresion } from "./predict.js";
import { riesgos } from "./terminal.js";
import { nuevoAdr } from "./arquitectura.js";
import { checkBash } from "./bash.js";
import { findThreads } from "./threads.js";
import { parse } from "./comments.js";
import { splitQuestions } from "./tutor.js";
import { insertBelow, renderReply } from "./render.js";
import { aplicarExpansion, pedidoDe, planExpansion } from "./biblioteca.js";
import { acompanar } from "./acompanante.js";
import { init } from "./init.js";
import { actualizarMemoria, agregarPreguntas, leerMemoria, panorama, preguntasAbiertas, responderPregunta } from "./panorama.js";
import { planoProyecto } from "./plano.js";
import { cegar, verificar } from "./verificar.js";
import { recorrerCasos } from "./tests.js";
import { ubicarSnippet } from "./responder.js";
import { modoEfectivo } from "./modos.js";
import { conSesion, Sesion, type Fabrica } from "./sesion.js";
import { atender } from "./servir.js";
import { rapida } from "./rapida.js";
import { cargarDialogos, conversar, olvidarDialogo } from "./dialogo.js";
import { sobreElCodigo } from "./memoria.js";
import { generadosPor } from "./snapshot.js";
import { conocer, sugerirAutoria } from "./conocer.js";
import { execFileSync } from "node:child_process";
import { guardReplies } from "./guard.js";
import { verifyCommentOnly } from "./verify.js";
import { langFor } from "./lang.js";

/**
 * Escenarios que prueban las garantías de ComplementAIry tal como las vería Claude Code:
 * se le pasa al hook el mismo JSON que mandaría Claude Code y se mira la decisión.
 */

const TS = `export function cuota(monto: number, meses: number): number {
  // el humano: ojo con meses = 0
  return monto / meses;
}
`;
const PY = `def cuota(monto, meses):
    return monto / meses
`;

function project(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cai-selftest-"));
  const w = (f: string, s: string) => {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), s);
  };
  w(".cai/config.json", JSON.stringify({ zonas: { delegadas: ["docs/**"], criticas: [] } }));
  w("src/cuota.ts", TS);
  w("src/cuota.py", PY);
  w("Dockerfile", "FROM node:20\nRUN npm i -g pnpm\n");
  w("db/q.sql", "SELECT * FROM t WHERE a = '--no';\n");
  w("README.md", "# Demo\n\nTexto.\n");
  return root;
}

const denied = (o: HookOutput) =>
  (o?.hookSpecificOutput as { permissionDecision?: string } | undefined)?.permissionDecision === "deny";

interface Case {
  name: string;
  run: (root: string) => Promise<boolean>;
}

const edit = (root: string, file: string, old_string: string, new_string: string) =>
  runHook(
    { hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: path.join(root, file), old_string, new_string } },
    root,
  );
const write = (root: string, file: string, content: string) =>
  runHook({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: path.join(root, file), content } }, root);
const bash = (root: string, command: string, id = "t1") =>
  runHook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, tool_use_id: id }, root);
const postBash = (root: string, id = "t1") =>
  runHook({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: {}, tool_use_id: id }, root);

const CASES: Case[] = [
  {
    name: "agregar // @guia en TS → permitido",
    run: async (r) => !denied(await edit(r, "src/cuota.ts", "  return monto / meses;", "  // @guia[1] pista: ¿qué devuelve si meses es 0?\n  return monto / meses;")),
  },
  {
    name: "comentario @guia al final de una línea → permitido",
    run: async (r) => !denied(await edit(r, "src/cuota.ts", "return monto / meses;", "return monto / meses; // @guia[2] pregunta: ¿y si monto es negativo?")),
  },
  { name: "cambiar un carácter de código → bloqueado", run: async (r) => denied(await edit(r, "src/cuota.ts", "monto / meses", "monto / (meses || 1)")) },
  { name: "agregar // @ts-ignore → bloqueado", run: async (r) => denied(await edit(r, "src/cuota.ts", "  return", "  // @ts-ignore\n  return")) },
  { name: "agregar un doc-comment /** @guia */ → bloqueado", run: async (r) => denied(await edit(r, "src/cuota.ts", "export", "/** @guia[3] pista: x */\nexport")) },
  { name: "borrar un comentario del humano → bloqueado", run: async (r) => denied(await edit(r, "src/cuota.ts", "  // el humano: ojo con meses = 0\n", "")) },
  { name: "comentario que no es @guia → bloqueado", run: async (r) => denied(await edit(r, "src/cuota.ts", "  return", "  // TODO arreglar\n  return")) },
  { name: "Python: # @guia → permitido", run: async (r) => !denied(await edit(r, "src/cuota.py", "    return", "    # @guia[4] pieza: mirá ZeroDivisionError\n    return")) },
  { name: "Python: cambiar indentación → bloqueado", run: async (r) => denied(await edit(r, "src/cuota.py", "    return", "  return")) },
  { name: "Python: # type: ignore → bloqueado", run: async (r) => denied(await edit(r, "src/cuota.py", "monto / meses", "monto / meses  # type: ignore")) },
  { name: "Dockerfile: # @guia → permitido", run: async (r) => !denied(await edit(r, "Dockerfile", "RUN npm", "# @guia[5] pista: fijá la versión de pnpm\nRUN npm")) },
  { name: "Dockerfile: cambiar RUN → bloqueado", run: async (r) => denied(await edit(r, "Dockerfile", "npm i -g pnpm", "npm i -g pnpm@9")) },
  { name: "SQL: '--' dentro de un string no es comentario → bloqueado", run: async (r) => denied(await edit(r, "db/q.sql", "'--no'", "'--si'")) },
  { name: "Markdown: <!-- @guia --> → permitido", run: async (r) => !denied(await edit(r, "README.md", "Texto.", "Texto.\n<!-- @guia[6] pregunta: ¿para quién es este README? -->")) },
  { name: "crear archivo de código nuevo en zona humana → bloqueado", run: async (r) => denied(await write(r, "src/nuevo.ts", "export const x = 1;\n")) },
  { name: "escribir en zona delegada (docs/) → permitido", run: async (r) => !denied(await write(r, "docs/notas.md", "# Notas\n")) },
  { name: "editar .cai/config.json → bloqueado", run: async (r) => denied(await write(r, ".cai/config.json", "{}")) },
  { name: "editar .claude/settings.json → bloqueado", run: async (r) => denied(await write(r, ".claude/settings.json", "{}")) },
  { name: "archivo fuera del proyecto → bloqueado", run: async (r) => denied(await write(r, "../../etc/x.ts", "x")) },
  { name: "Bash: sed -i → bloqueado", run: async (r) => denied(await bash(r, "sed -i 's/a/b/' src/cuota.ts")) },
  { name: "Bash: echo > archivo → bloqueado", run: async (r) => denied(await bash(r, "echo 'x' > src/cuota.ts")) },
  { name: "Bash: pnpm add paquete → bloqueado", run: async (r) => denied(await bash(r, "pnpm add left-padx")) },
  { name: "Bash: npx paquete → bloqueado", run: async (r) => denied(await bash(r, "npx some-tool")) },
  { name: "Bash: git commit --no-verify → bloqueado", run: async (r) => denied(await bash(r, "git commit --no-verify -m x")) },
  { name: "Bash: ls / cat / grep → permitido", run: async (r) => !denied(await bash(r, "ls src && cat src/cuota.ts | grep monto 2>&1")) },
  {
    name: "Bash que esquiva las reglas y cambia código → revertido (y guardado en cuarentena)",
    run: async (r) => {
      if (denied(await bash(r, "node build.js", "s1"))) return false;
      fs.writeFileSync(path.join(r, "src/cuota.ts"), TS.replace("monto / meses", "0"));
      const out = await postBash(r, "s1");
      const restored = fs.readFileSync(path.join(r, "src/cuota.ts"), "utf8") === TS;
      const q = path.join(r, ".cai/cache/cuarentena");
      return out?.decision === "block" && restored && fs.existsSync(q);
    },
  },
  {
    name: "Bash que crea un archivo de código nuevo → quitado (a cuarentena)",
    run: async (r) => {
      await bash(r, "node gen.js", "s2");
      fs.writeFileSync(path.join(r, "src/gen.ts"), "export const y = 2;\n");
      const out = await postBash(r, "s2");
      return out?.decision === "block" && !fs.existsSync(path.join(r, "src/gen.ts"));
    },
  },
  {
    name: "Bash que solo agrega @guia → se mantiene",
    run: async (r) => {
      await bash(r, "node guia.js", "s3");
      const withGuia = TS.replace("  return", "  // @guia[7] pista: x\n  return");
      fs.writeFileSync(path.join(r, "src/cuota.ts"), withGuia);
      const out = await postBash(r, "s3");
      return out === null && fs.readFileSync(path.join(r, "src/cuota.ts"), "utf8") === withGuia;
    },
  },
  {
    name: "guia clean borra @guia/@ia?/@yo: sin tocar el código ni otros comentarios",
    run: async () => {
      const src = `// @ia? ¿cómo valido meses?\nexport function f(m: number) { // @guia[1] pista: mirá Number.isInteger\n  // @yo: creo que con un if\n  // nota mía\n  return m;\n}\n`;
      const { text, removed } = await cleanText("x.ts", src, ["guia", "ia", "yo"]);
      return removed === 3 && text === "export function f(m: number) {\n  // nota mía\n  return m;\n}\n";
    },
  },
  {
    name: "guia check detecta comentarios pendientes",
    run: async () => (await conversation("x.py", "x = 1  # @guia[1] pista: y\n")).length === 1,
  },
];

/** IA simulada: registra cada consulta y responde con lo que diga `reply`. */
function fakeLLM(reply: (o: AskOptions, n: number) => unknown): AskOptions[] {
  const calls: AskOptions[] = [];
  setLLM(async <T,>(o: AskOptions) => {
    calls.push(o);
    return { data: reply(o, calls.length) as T, costUsd: 0 };
  });
  return calls;
}
const said = (texto: string, tipo = "pista", nivel = 1) => ({ respuestas: [{ tipo, texto, links: [] }], nivel_usado: nivel });
const levelIn = (o: AskOptions) => Number(/\(nivel interno: (\d)\)/.exec(o.prompt)?.[1]);

const GUIA_TS = `export function f(a: number, b: number): number {
  // @ia? ¿cómo valido a? ¿y qué error lanzo?
  const x = a + b;
  return x; // @ia? ¿hace falta redondear?
}
`;

CASES.push(
  {
    name: "guia: cada pregunta (y sub-pregunta) es una consulta separada; respuestas en su lugar y solo @guia",
    run: async (r) => {
      fs.writeFileSync(path.join(r, "src/g.ts"), GUIA_TS);
      const calls = fakeLLM((o) => said(`respuesta a: ${/Respondé SOLO esta parte \(\d\/\d\): (.*)|Respondé al último/.exec(o.prompt)?.[1] ?? "redondeo"}`));
      const res = await runGuia(r, "src/g.ts");
      const out = fs.readFileSync(path.join(r, "src/g.ts"), "utf8");
      const v = await verifyCommentOnly(GUIA_TS, out, langFor("x.ts")!);
      const lines = out.split("\n");
      const i1 = lines.findIndex((l) => l.includes("@ia? ¿cómo valido"));
      const i2 = lines.findIndex((l) => l.includes("@ia? ¿hace falta"));
      return (
        calls.length === 3 &&
        res.respondidos === 2 &&
        v.ok &&
        lines[i1 + 1]!.includes("@guia[t1.1] pista: (1/2)") &&
        lines[i1 + 2]!.includes("(2/2)") &&
        lines[i2 + 1]!.trim().startsWith("// @guia[t2.1]")
      );
    },
  },
  {
    name: "guia: respuesta con código en nivel 1 → se reintenta y, si insiste, se descarta",
    run: async (r) => {
      fs.writeFileSync(path.join(r, "src/g.ts"), GUIA_TS);
      const calls = fakeLLM(() => said("Usá esto:\n```ts\nif (!Number.isInteger(a)) throw new Error('x');\n```"));
      const res = await runGuia(r, "src/g.ts");
      const out = fs.readFileSync(path.join(r, "src/g.ts"), "utf8");
      return calls.length === 6 && !out.includes("Number.isInteger") && res.avisos.length >= 3 && out.includes("se descartó");
    },
  },
  {
    name: "guia: ejemplo análogo que reutiliza los nombres del usuario → descartado (no copiable)",
    run: async (r) => {
      const src = `export function calcularCuota(monto: number, tasaMensual: number, meses: number) {\n  // @ia? !nivel 4 dame un ejemplo\n  return monto / meses;\n}\n`;
      fs.writeFileSync(path.join(r, "src/c.ts"), src);
      fakeLLM(() => said("function calcularCuota(monto, tasaMensual, meses) { return monto * tasaMensual / meses }", "ejemplo", 4));
      const res = await runGuia(r, "src/c.ts");
      return res.avisos.some((a) => a.includes("copiable")) && !fs.readFileSync(path.join(r, "src/c.ts"), "utf8").includes("return monto * tasaMensual");
    },
  },
  {
    name: "guia: en zona crítica, pedir más sin intentar ni cambiar código → no sube de nivel",
    run: async (r) => {
      fs.writeFileSync(path.join(r, ".cai/config.json"), JSON.stringify({ zonas: { delegadas: [], criticas: ["src/pagos/**"] } }));
      fs.mkdirSync(path.join(r, "src/pagos"), { recursive: true });
      const file = path.join(r, "src/pagos/p.ts");
      fs.writeFileSync(file, "export function p(a: number) {\n  // @ia? ¿cómo valido a?\n  return a;\n}\n");
      const calls = fakeLLM(() => said("pensá en los casos borde"));
      await runGuia(r, "src/pagos/p.ts");
      let src = fs.readFileSync(file, "utf8").replace(/(\/\/ @guia\[t1\.1\][^\n]*\n)(?![^\n]*@guia\[t1\.1\])/, "$1  // @ia? dame más\n");
      fs.writeFileSync(file, src);
      await runGuia(r, "src/pagos/p.ts");
      const sinIntento = levelIn(calls[1]!) === 1 && calls[1]!.prompt.includes("sin intentar");
      src = fs.readFileSync(file, "utf8").replace(/(\/\/ @guia\[t1\.2\][^\n]*\n)(?![^\n]*@guia\[t1\.2\])/, "$1  // @yo: probé con un if, ¿qué más falta?\n");
      fs.writeFileSync(file, src);
      await runGuia(r, "src/pagos/p.ts");
      return sinIntento && levelIn(calls[2]!) === 2;
    },
  },
  {
    name: "guia: fuera de zona crítica, !todo salta al nivel 4 (y queda registrado en el perfil)",
    run: async (r) => {
      fs.writeFileSync(path.join(r, "src/g.ts"), "const a = 1;\n// @ia? !todo ¿cómo hago X?\n");
      const calls = fakeLLM(() => said("pensá en X"));
      await runGuia(r, "src/g.ts");
      return levelIn(calls[0]!) === 4 && (loadPerfil().temas.typescript?.puntaje ?? 1) < 0.3;
    },
  },
  {
    name: "guia: el humano editó el archivo mientras la IA respondía → la respuesta igual cae en su hilo",
    run: async (r) => {
      const file = path.join(r, "src/g.ts");
      fs.writeFileSync(file, GUIA_TS);
      fakeLLM((_o, n) => {
        if (n === 1) fs.writeFileSync(file, "// línea nueva arriba\nimport x from 'y';\n" + fs.readFileSync(file, "utf8"));
        return said(`r${n}`);
      });
      await runGuia(r, "src/g.ts");
      const lines = fs.readFileSync(file, "utf8").split("\n");
      const i2 = lines.findIndex((l) => l.includes("@ia? ¿hace falta"));
      return lines[0] === "// línea nueva arriba" && lines[i2 + 1]!.includes("@guia[t2.1]");
    },
  },
  {
    name: "guia: hilo resuelto (borrado por el humano) → se registra en el perfil",
    run: async (r) => {
      const file = path.join(r, "src/g.ts");
      fs.writeFileSync(file, "const a = 1;\n// @ia? ¿cómo hago X?\n");
      fakeLLM(() => said("pensá en X"));
      await runGuia(r, "src/g.ts");
      fs.writeFileSync(file, "const a = 2;\n");
      const res = await runGuia(r, "src/g.ts");
      return res.resueltos === 1 && loadPerfil().temas.typescript!.puntaje > 0.3;
    },
  },
);

CASES.push(
  {
    name: "snippets modo ganado: la IA no redacta snippets de un lenguaje que no dominás",
    run: async (r) => denied(await write(r, ".vscode/x.code-snippets", '{"a":{"prefix":"a","scope":"typescript","body":["x"]}}')),
  },
  {
    name: "snippets modo ganado: si tu perfil dice experto, la IA puede redactarlo",
    run: async (r) => {
      fs.mkdirSync(process.env.CAI_HOME!, { recursive: true });
      fs.writeFileSync(path.join(process.env.CAI_HOME!, "perfil.json"), JSON.stringify({ version: 1, temas: { typescript: { puntaje: 0.9, eventos: 0, actualizado: "" } } }));
      return !denied(await write(r, ".vscode/x.code-snippets", '{"a":{"prefix":"a","scope":"typescript","body":["x"]}}'));
    },
  },
  {
    name: "snippets modo humano: bloqueado siempre",
    run: async (r) => {
      fs.writeFileSync(path.join(r, ".cai/config.json"), JSON.stringify({ snippets: { modo: "humano" } }));
      return denied(await write(r, ".vscode/x.code-snippets", '{"a":{"prefix":"a","scope":"python","body":["x"]}}'));
    },
  },
  {
    name: "snippet nuevo desde tu código: escapa $ y queda como JSONC válido con TODO para marcar huecos",
    run: async (r) => {
      fs.writeFileSync(path.join(r, "src/rep.ts"), "x\n  const total = `$${monto}`;\n  return total;\ny\n");
      const { file } = crearSnippet(r, { nombre: "total", archivo: "src/rep.ts", lineas: [2, 3] });
      crearSnippet(r, { nombre: "otro", lenguaje: "python" });
      const text = fs.readFileSync(file, "utf8");
      const json = JSON.parse(text.replace(/^\s*\/\/.*$/gm, "")) as Record<string, { body: string[]; scope?: string }>;
      return json.total!.body[0] === "const total = `\\$\\${monto}`;" && json.total!.scope === "typescript" && json.otro!.scope === "python";
    },
  },
);

CASES.push(
  {
    name: "reglas.json: regla mecánica detecta la línea exacta, sin IA",
    run: async (r) => {
      fs.writeFileSync(path.join(r, ".cai/reglas.json"), JSON.stringify({ reglas: [{ id: "sin-log", descripcion: "sin console.log", patron: "console\\.log\\(", archivos: ["src/**"] }] }));
      fs.writeFileSync(path.join(r, "src/l.ts"), "const a = 1;\nconsole.log(a);\n");
      const d = reglasDiags(r, ["src/l.ts", "src/cuota.ts"]).diags;
      return d.length === 1 && d[0]!.line === 2 && d[0]!.code === "sin-log";
    },
  },
  {
    name: "revisar: hallazgos de IA y de reglas se insertan encima de la línea correcta, deduplicados y solo como comentarios",
    run: async (r) => {
      fs.writeFileSync(path.join(r, ".cai/reglas.json"), JSON.stringify({ reglas: [{ id: "sin-log", descripcion: "sin console.log", patron: "console\\.log\\(" }] }));
      const src = "export function f(a: number) {\n  console.log(a);\n  return 10 / a;\n}\n";
      fs.writeFileSync(path.join(r, "src/f.ts"), src);
      const hallazgo = (codigo: string, texto: string) => ({ codigo, etiqueta: "issue", bloqueante: true, categoria: "division-por-cero", texto, links: [] });
      fakeLLM((o) =>
        o.kind === "revisar:consolidar"
          ? { mantener: [0] }
          : o.kind === "revisar:bugs"
            ? { hallazgos: [hallazgo("return 10 / a;", "¿y si a es 0?"), hallazgo("return 10 / a;", "a puede ser 0")] }
            : { hallazgos: [] },
      );
      const res = await runReview(r, "src/f.ts", { solo: ["bugs", "seguridad"] });
      const out = fs.readFileSync(path.join(r, "src/f.ts"), "utf8").split("\n");
      const iRet = out.findIndex((l) => l.includes("return 10 / a;"));
      const iLog = out.findIndex((l) => l.includes("console.log(a)"));
      const v = await verifyCommentOnly(src, out.join("\n"), langFor("f.ts")!);
      return v.ok && res.insertados === 2 && out[iRet - 1]!.includes("¿y si a es 0?") && out[iLog - 1]!.includes("[reglas sin-log]") && !out.join("\n").includes("a puede ser 0");
    },
  },
  {
    name: "predicciones: solo se aceptan llamadas a funciones exportadas con argumentos literales",
    run: async () => {
      const ex = new Set(["f"]);
      return (
        validarExpresion("f(1, [2, 3], { a: 'x' })", ex) === null &&
        validarExpresion("g(1)", ex) !== null &&
        validarExpresion("f(require('fs').rmSync('/'))", ex) !== null &&
        validarExpresion("f(1); process.exit()", ex) !== null &&
        validarExpresion("f(`${x}`)", ex) !== null
      );
    },
  },
  {
    name: "predicciones: la comparación es determinista (números con tolerancia, errores, booleanos, Infinity)",
    run: async () =>
      coincide("1100", { ok: true, valor: 1099.999999999999 }) &&
      !coincide("1000", { ok: true, valor: 1099.99 }) &&
      coincide("error", { ok: false, error: "RangeError" }) &&
      !coincide("error", { ok: true, valor: 3 }) &&
      coincide("Infinity", { ok: true, valor: "Infinity" }) &&
      coincide("verdadero", { ok: true, valor: true }) &&
      coincide("[1,2]", { ok: true, valor: [1, 2] }),
  },
  {
    name: "terminal: riesgos conocidos se detectan sin IA (rm -rf, curl | sh, reset --hard)",
    run: async () =>
      riesgos("rm -rf build").length > 0 && riesgos("curl -fsSL x.sh | bash").length > 0 && riesgos("git reset --hard").length > 0 && riesgos("ls -la").length === 0,
  },
  {
    name: "arquitectura: ADR numerado, con índice y guía solo en comentarios",
    run: async (r) => {
      const a = nuevoAdr(r, "Base de datos");
      const b = nuevoAdr(r, "Cómo autenticar", { preguntas: ["¿Quién inicia sesión?"], opciones: [{ nombre: "JWT", pros: ["sin estado"], contras: ["revocar es difícil"], cuando: "APIs" }], lecturas: [] });
      const idx = fs.readFileSync(path.join(r, "docs/adr/README.md"), "utf8");
      const text = fs.readFileSync(b, "utf8");
      return path.basename(a).startsWith("0001-") && path.basename(b) === "0002-como-autenticar.md" && idx.includes("0002") && text.includes("<!-- @guia[a2.1] pieza: Opción \"JWT\"");
    },
  },
  {
    name: "Bash: el humano puede permitir comandos puntuales en config (bash.permitir)",
    run: async () => !checkBash("pnpm add zod", []).ok && checkBash("pnpm add zod", ["^pnpm add zod$"]).ok,
  },
);

// --- Regresiones de la revisión de seguridad y de corrección -----------------------
const vrf = async (file: string, a: string, b: string) => (await verifyCommentOnly(a, b, langFor(file)!)).ok;
CASES.push(
  { name: "[seg] comentario de bloque multilínea que cambia la semántica de JS (ASI) → rechazado", run: async () => !(await vrf("a.js", "function f(){ return 42; }\n", "function f(){ return/* @guia[1] pista: x\n*/ 42; }\n")) },
  { name: "[seg] '# @guia coding: utf-7' en Python → rechazado", run: async () => !(await vrf("a.py", "x = 1\n", "# @guia[1] pista: coding: utf-7\nx = 1\n")) },
  { name: "[seg] línea en blanco dentro de un string de Python → rechazado", run: async () => !(await vrf("a.py", 'q = """SELECT *\nFROM t"""\n', 'q = """SELECT *\n\nFROM t"""\n')) },
  { name: "[seg] espacios finales dentro de un string → rechazado", run: async () => !(await vrf("a.py", 's = """abc   \n"""\n', 's = """abc\n"""\n')) },
  { name: "[seg] línea en blanco dentro de un bloque YAML → rechazado", run: async () => !(await vrf("a.yaml", "k: |\n  l1\n  l2\n", "k: |\n  l1\n\n  l2\n")) },
  { name: "[seg] comentario en medio de una línea de código → rechazado", run: async () => !(await vrf("a.ts", "const a = 1 + 2;\n", "const a = 1 /* @guia[1] pista: x */ + 2;\n")) },
  { name: "[seg] comentario que termina en \\ (continuación en C) → rechazado", run: async () => !(await vrf("a.c", "int a;\nint b;\n", "int a;\n// @guia[1] pista: x \\\nint b;\n")) },
  { name: "[seg] markdown: <!-- --> dentro de un bloque de código no es comentario → rechazado", run: async () => !(await vrf("a.md", "```\ncode\n```\n", "```\n<!-- @guia[1] pista: x -->\ncode\n```\n")) },
  { name: "[seg] dockerfile: '#' dentro de un heredoc no es comentario → rechazado", run: async () => !(await vrf("Dockerfile", "RUN <<EOF\necho a\nEOF\n", "RUN <<EOF\n# @guia[1] pista: x\necho a\nEOF\n")) },
  {
    name: "[seg] archivo SQL de 40.000 líneas se verifica en menos de 3 s (sin timeout que deje pasar)",
    run: async () => {
      let big = "";
      for (let i = 0; i < 40000; i++) big += `-- c ${i}\n`;
      const t = Date.now();
      await vrf("a.sql", big, big + "-- @guia[1] pista: x\n");
      return Date.now() - t < 3000;
    },
  },
  { name: "[seg] Edit cuyo old_string no coincide → bloqueado (falla cerrada)", run: async (r) => denied(await edit(r, "src/cuota.ts", "return monto / mesez;", "return 0;")) },
  {
    name: "[seg] Edit sobre archivo CRLF con old_string en LF: se simula y se verifica igual",
    run: async (r) => {
      fs.writeFileSync(path.join(r, "src/crlf.ts"), "const a = 1;\r\nconst b = 2;\r\n");
      const ok = !denied(await edit(r, "src/crlf.ts", "const a = 1;\nconst b", "const a = 1;\n// @guia[1] pista: x\nconst b"));
      const bad = denied(await edit(r, "src/crlf.ts", "const a = 1;\nconst b", "const a = 9;\nconst b"));
      return ok && bad;
    },
  },
  {
    name: "[seg] foto previa dañada → el hook bloquea con explicación (no falla en silencio)",
    run: async (r) => {
      await bash(r, "node x.js", "dmg");
      fs.writeFileSync(path.join(r, ".cai/cache/snap/dmg.json"), "{roto");
      const out = await postBash(r, "dmg");
      return out?.decision === "block";
    },
  },
  {
    name: "[seg] Bash que escribe un hook de git (.git/hooks) → revertido",
    run: async (r) => {
      fs.mkdirSync(path.join(r, ".git/hooks"), { recursive: true });
      fs.writeFileSync(path.join(r, ".git/config"), "[core]\n");
      await bash(r, "node x.js", "gh");
      fs.writeFileSync(path.join(r, ".git/hooks/pre-commit"), "#!/bin/sh\nexit 0\n");
      const out = await postBash(r, "gh");
      return out?.decision === "block" && !fs.existsSync(path.join(r, ".git/hooks/pre-commit"));
    },
  },
  {
    name: "[seg] comando interrumpido (sin PostToolUse): se verifica en el siguiente comando",
    run: async (r) => {
      await bash(r, "node x.js", "int1");
      fs.writeFileSync(path.join(r, "src/cuota.ts"), "export const hack = 1;\n");
      const out = await bash(r, "ls", "int2");
      return fs.readFileSync(path.join(r, "src/cuota.ts"), "utf8") === TS && typeof out?.systemMessage === "string";
    },
  },
  {
    name: "[seg] Write a /tmp que es symlink a un archivo del proyecto → bloqueado",
    run: async (r) => {
      const link = path.join(os.tmpdir(), `cai-link-${path.basename(r)}.ts`);
      fs.symlinkSync(path.join(r, "src/cuota.ts"), link);
      try {
        return denied(await runHook({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: link, content: "export const x = 1;\n" } }, r));
      } finally {
        fs.rmSync(link, { force: true });
      }
    },
  },
  {
    name: "[seg] snippets: un snippet sin 'scope' (aplica a todo) no se puede delegar",
    run: async (r) => {
      fs.mkdirSync(process.env.CAI_HOME!, { recursive: true });
      fs.writeFileSync(path.join(process.env.CAI_HOME!, "perfil.json"), JSON.stringify({ version: 1, temas: { typescript: { puntaje: 0.9, eventos: 0, actualizado: "" } } }));
      return denied(await write(r, ".vscode/x.code-snippets", '{"a":{"prefix":"a","scope":"typescript","body":["x"]},"b":{"prefix":"b","body":["y"]}}'));
    },
  },
  {
    name: "[corr] un comentario de revisión debajo de un @ia? no le roba el hilo",
    run: async () => {
      const src = "// @ia? ¿esto está bien?\n// @guia[r1.1] revision: issue: x\nconsole.log(1);\n";
      const t = findThreads(src, (await parse(src, langFor("a.ts")!)).comments);
      return t.length === 1 && t[0]!.pending && t[0]!.id === null;
    },
  },
  {
    name: "[corr] una línea en blanco separa hilos distintos",
    run: async () => {
      const src = "// @ia? q1\n// @guia[t1.1] pista: a\n\n// @ia? otra pregunta\nx;\n";
      const t = findThreads(src, (await parse(src, langFor("a.ts")!)).comments);
      return t.length === 2 && !t[0]!.pending && t[1]!.pending;
    },
  },
  {
    name: "[corr] mensaje humano de 3 líneas: se lee completo y clean lo borra entero",
    run: async () => {
      const src = "// @ia? primera\n// segunda\n// tercera\nx;\n";
      const t = findThreads(src, (await parse(src, langFor("a.ts")!)).comments);
      const { text } = await cleanText("a.ts", src, ["guia", "ia", "yo"]);
      return t[0]!.comments.length === 3 && t[0]!.turns[0]!.texto.includes("tercera") && text === "x;\n";
    },
  },
  { name: "[corr] un ternario `a ? b : c` no parte la pregunta", run: async () => splitQuestions("¿por qué `a ? b : c` devuelve 3?").length === 1 && splitQuestions("¿cómo valido a? ¿y qué lanzo?").length === 2 },
  {
    name: "[corr] snippets conservan tabulaciones reales",
    run: async (r) => {
      fs.writeFileSync(path.join(r, "src/t.go"), "func f() {\n\tif x {\n\t}\n}\n");
      const { body } = crearSnippet(r, { nombre: "tab", archivo: "src/t.go", lineas: [1, 4] });
      return body[1] === "\tif x {";
    },
  },
  {
    name: "[corr] insertar en un archivo CRLF mantiene CRLF",
    run: async () => {
      const src = "// @ia? q\r\nx;\r\n";
      const c = (await parse(src, langFor("a.ts")!)).comments[0]!;
      const out = insertBelow(src, c, ["// @guia[t1.1] pista: a"]);
      return out === "// @ia? q\r\n// @guia[t1.1] pista: a\r\nx;\r\n";
    },
  },
);

// --- Modo directo, escalamiento explícito y snippets como única vía de código ----------
CASES.push(
  {
    name: "guia fuera de zona crítica: modo directo (ideas, plano y snippets), sin escalera",
    run: async (r) => {
      fs.writeFileSync(path.join(r, "src/g.ts"), "// @ia? ¿cómo armo este archivo?\nexport {};\n");
      const calls = fakeLLM(() => said("x"));
      await runGuia(r, "src/g.ts");
      return calls[0]!.prompt.includes("MODO DIRECTO") && calls[0]!.prompt.includes("BIBLIOTECA DE SNIPPETS") && calls[0]!.prompt.includes("express-ruta");
    },
  },
  {
    name: "guia: una pregunta nueva en el mismo hilo NO sube de nivel; '!mas' sí",
    run: async (r) => {
      const f = path.join(r, "src/pagos/p.ts");
      fs.writeFileSync(path.join(r, ".cai/config.json"), JSON.stringify({ zonas: { delegadas: [], criticas: ["src/pagos/**"] } }));
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, "export function p(a: number) {\n  // @ia? ¿cómo valido a?\n  return a;\n}\n");
      const calls = fakeLLM(() => said("pista"));
      await runGuia(r, "src/pagos/p.ts");
      const add = (txt: string) => {
        const lines = fs.readFileSync(f, "utf8").split("\n");
        const last = lines.map((l) => /@guia\[t1/.test(l)).lastIndexOf(true);
        lines.splice(last + 1, 0, `  // ${txt}`);
        fs.writeFileSync(f, lines.join("\n"));
      };
      add("@yo: intenté con un if");
      add("@ia? ¿y qué tipo de error lanzo?");
      await runGuia(r, "src/pagos/p.ts");
      add("@ia? !mas no entiendo");
      fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("return a;", "if (a) return a;\n  return 0;"));
      await runGuia(r, "src/pagos/p.ts");
      return levelIn(calls[0]!) === 1 && levelIn(calls[1]!) === 1 && levelIn(calls[2]!) === 2;
    },
  },
  {
    name: "guia: sugerencia de snippet válida queda como línea expandible; la inventada se descarta",
    run: async (r) => {
      fs.writeFileSync(path.join(r, "src/s.ts"), "// @ia? necesito una ruta post de préstamos\nexport {};\n");
      fakeLLM(() => ({
        respuestas: [
          { tipo: "snippet", texto: 'express-ruta metodo=post ruta="/prestamos" — es la estructura que necesitas', links: [] },
          { tipo: "snippet", texto: "inventado x=1 — no existe", links: [] },
        ],
        nivel_usado: 2,
      }));
      const res = await runGuia(r, "src/s.ts");
      const out = fs.readFileSync(path.join(r, "src/s.ts"), "utf8");
      return out.includes('// @guia[t1.1] snippet [ ]: express-ruta metodo=post ruta="/prestamos"') && !out.includes("inventado") && res.avisos.some((a) => a.includes("no existe"));
    },
  },
  {
    name: "guia: un 'plano' con código se rechaza (es estructura en palabras)",
    run: async () => guardReplies([{ tipo: "plano", texto: "Haz `const x = 1; return x;`" }], 2, new Set()).rejected.length === 1 && guardReplies([{ tipo: "plano", texto: "1. validarMonto(monto) → lanza si no es positivo. 2. validarMeses(meses) → entero 1..360." }], 2, new Set()).ok.length === 1,
  },
  {
    name: "expandir: // @snippet: con argumentos se reemplaza por el snippet real, con la indentación del archivo",
    run: async (r) => {
      const src = "function f() {\n  // @snippet: fn nombre=sumar args=\"a, b\"\n}\n";
      const exps = await planExpansion(r, "src/e.ts", src);
      const out = aplicarExpansion(src, exps);
      return out === "function f() {\n  const sumar = (a, b) => {\n\n  };\n}\n";
    },
  },
  {
    name: "expandir: una sugerencia de la IA solo se expande si la eliges por línea (y se va con su explicación)",
    run: async (r) => {
      const src = "// @guia[t1.1] snippet [ ]: fn nombre=x\n// @guia[t1.1]   para validar\nlet a;\n";
      const todos = await planExpansion(r, "src/e.ts", src);
      const out = aplicarExpansion(src, await planExpansion(r, "src/e.ts", src, 1));
      return todos.length === 0 && out === "const x = (args) => {\n\n};\nlet a;\n";
    },
  },
  {
    name: "expandir: tus snippets del proyecto tienen prioridad sobre la base",
    run: async (r) => {
      fs.mkdirSync(path.join(r, ".vscode"), { recursive: true });
      fs.writeFileSync(path.join(r, ".vscode/mios.code-snippets"), '{"mio":{"prefix":"fn","scope":"typescript","body":["function ${1:nombre}() {}"]}}');
      const out = aplicarExpansion("// @snippet: fn nombre=hola\n", await planExpansion(r, "src/e.ts", "// @snippet: fn nombre=hola\n"));
      return out === "function hola() {}\n";
    },
  },
  {
    name: "pre-commit: un // @snippet: sin expandir no se commitea",
    run: async () => (await conversation("a.ts", "// @snippet: fn\n", ["guia", "ia", "yo", "snippet"])).length === 1,
  },
  {
    name: "[seg] la IA no puede escribir un // @snippet: ella misma (solo sugerirlo con @guia)",
    run: async (r) => denied(await edit(r, "src/cuota.ts", "  return monto / meses;", "  // @snippet: fn nombre=x\n  return monto / meses;")),
  },
);

// --- Acompañante y activación de snippets ----------------------------------------
const planoFake = { resumen: "capas", carpetas: [{ ruta: "src/dominio", para_que: "reglas" }], modulos: [], orden: ["empieza por el dominio"], reglas: [], preguntas: [] };
CASES.push(
  {
    name: "[seg] la IA no puede activar un snippet: '[x]' escrito por ella se rechaza (hook y CLI)",
    run: async (r) => {
      const viaHook = denied(await edit(r, "src/cuota.ts", "  return monto / meses;", "  // @guia[t9.1] snippet [x]: fn nombre=a\n  return monto / meses;"));
      const lines = renderReply(langFor("a.ts")!, "", "t1.1", { tipo: "snippet", texto: "[x] fn nombre=a — truco" });
      const c = (await parse(lines.join("\n") + "\n", langFor("a.ts")!)).comments[0]!;
      return viaHook && lines[0]!.includes("snippet [ ]:") && pedidoDe(c)?.activo === false;
    },
  },
  {
    name: "acompañante: al guardar, una sugerencia marcada [x] por ti se expande; las [ ] no",
    run: async (r) => {
      const f = path.join(r, "src/a.ts");
      fs.writeFileSync(f, "// @guia[t1.1] snippet [x]: fn nombre=sumar\n// @guia[t2.1] snippet [ ]: fn nombre=restar\nexport {};\n");
      fs.writeFileSync(path.join(r, ".cai/config.json"), JSON.stringify({ acompanar: { nivel: "silencioso" } }));
      const res = await acompanar(r, "src/a.ts");
      const out = fs.readFileSync(f, "utf8");
      return res.acciones.some((a) => a.tipo === "expandido") && out.includes("const sumar = (args) => {") && out.includes("snippet [ ]: fn nombre=restar");
    },
  },
  {
    name: "acompañante: archivo nuevo → plano del archivo una sola vez (y solo comentarios)",
    run: async (r) => {
      fs.writeFileSync(path.join(r, "src/nuevo.ts"), "");
      const calls = fakeLLM(() => ({ respuestas: [{ tipo: "plano", texto: "1. validarMonto(monto) → lanza si no es positivo.", links: [] }] }));
      await acompanar(r, "src/nuevo.ts");
      await acompanar(r, "src/nuevo.ts");
      const out = fs.readFileSync(path.join(r, "src/nuevo.ts"), "utf8");
      return calls.filter((c) => c.kind === "acompanar").length === 1 && out.startsWith("// @guia[c1.1] plano:") && (await verifyCommentOnly("", out, langFor("a.ts")!)).ok;
    },
  },
  {
    name: "acompañante: si una función sigue con errores tras 3 intentos, ofrece ayuda una vez; al resolver, lo registra",
    run: async (r) => {
      const f = path.join(r, "src/t.ts");
      const calls = fakeLLM(() => ({ respuestas: [{ tipo: "pista", texto: "Ese error dice que falta cerrar algo: mira los paréntesis.", links: [] }] }));
      let conAyuda = false;
      for (const v of ["1", "2", "3", "4"]) {
        fs.writeFileSync(f, `export function f(a: number) {\n  return (a + ${v};\n}\n`);
        await acompanar(r, "src/t.ts");
        if (v === "3") conAyuda = fs.readFileSync(f, "utf8").includes("@guia[c1.1] pista:");
      }
      const ayudas = calls.filter((c) => c.kind === "acompanar").length;
      fs.writeFileSync(f, "export function f(a: number) {\n  return a + 1;\n}\n");
      const res = await acompanar(r, "src/t.ts");
      return ayudas === 1 && conAyuda && res.acciones.some((a) => a.tipo === "resuelto");
    },
  },
  {
    name: "acompañante: si vas bien (sin errores), no interrumpe",
    run: async (r) => {
      const calls = fakeLLM(() => ({ respuestas: [{ tipo: "pista", texto: "x", links: [] }] }));
      fs.writeFileSync(path.join(r, "src/ok.ts"), "export const a = 1;\nexport const b = 2;\nexport const c = 3;\n");
      for (let i = 0; i < 4; i++) await acompanar(r, "src/ok.ts");
      return calls.length === 0;
    },
  },
  {
    name: "acompañante: respeta el límite de llamadas por hora",
    run: async (r) => {
      fs.writeFileSync(path.join(r, ".cai/config.json"), JSON.stringify({ acompanar: { nivel: "activo", intentos: 1, maxLlamadasHora: 0 } }));
      const calls = fakeLLM(() => ({ respuestas: [{ tipo: "pista", texto: "x", links: [] }] }));
      fs.writeFileSync(path.join(r, "src/v.ts"), "");
      await acompanar(r, "src/v.ts");
      return calls.length === 0;
    },
  },
  {
    name: "acompañante: con proyecto.md escrito y sin estructura, propone el plano del proyecto una vez",
    run: async (r) => {
      fs.writeFileSync(path.join(r, ".cai/proyecto.md"), "# Qué busca\n\nUna API de préstamos.\n");
      const calls = fakeLLM((o) => (o.kind === "plano" ? planoFake : { respuestas: [{ tipo: "plano", texto: "x", links: [] }] }));
      await acompanar(r, "src/cuota.ts");
      await acompanar(r, "src/cuota.ts");
      const md = fs.readFileSync(path.join(r, "docs/ESTRUCTURA.md"), "utf8");
      return calls.filter((c) => c.kind === "plano").length === 1 && md.includes("- `src/dominio`: reglas") && !md.includes("@guia");
    },
  },
  {
    name: "guia: '!pseudo' pide directamente ese escalón (sin pasar por los anteriores)",
    run: async (r) => {
      fs.writeFileSync(path.join(r, "src/g.ts"), "// @ia? !pseudo ¿cómo recorro la lista?\nexport {};\n");
      const calls = fakeLLM(() => said("1. recorre... 2. ..."));
      await runGuia(r, "src/g.ts");
      return levelIn(calls[0]!) === 3 && calls[0]!.prompt.includes("pidió explícitamente: pseudocódigo");
    },
  },
);

// --- Comentarios mientras avanzas y ahorro de tokens ---------------------------------
const hallazgoInc = (codigo: string) => ({ hallazgos: [{ codigo, etiqueta: "suggestion", bloqueante: false, categoria: "nombres", texto: "El nombre x no dice qué guarda.", links: [] }] });
CASES.push(
  {
    name: "acompañante: comenta una parte cuando la TERMINAS (cambió, compila y ya pasaste a otra), solo esa parte",
    run: async (r) => {
      const f = path.join(r, "src/inc.ts");
      const calls = fakeLLM((o) => (o.kind === "acompanar:revisar" ? hallazgoInc("  const x = a * 2;") : { respuestas: [{ tipo: "plano", texto: "x", links: [] }] }));
      const uno = "export function uno(a: number) {\n  return a;\n}\n";
      const dos = (b: string) => `export function dos(a: number) {\n  const x = a * 2;\n  return x + ${b};\n}\n`;
      fs.writeFileSync(f, uno); // 1º guardado: lo existente cuenta como revisado
      await acompanar(r, "src/inc.ts");
      fs.writeFileSync(f, uno + dos("1")); // escribes dos()
      await acompanar(r, "src/inc.ts");
      const antes = calls.filter((c) => c.kind === "acompanar:revisar").length;
      fs.writeFileSync(f, uno + dos("1") + "export const tres = 3;\n"); // pasas a otra cosa: dos() quedó terminada
      const res = await acompanar(r, "src/inc.ts");
      const revs = calls.filter((c) => c.kind === "acompanar:revisar");
      const out = fs.readFileSync(f, "utf8");
      return antes === 0 && revs.length === 1 && revs[0]!.prompt.includes("function dos") && !revs[0]!.prompt.includes("function uno") && res.acciones.some((a) => a.tipo === "comentario") && /@guia\[c\d+\.1\] revision: suggestion: El nombre x/.test(out);
    },
  },
  {
    name: "acompañante: con porCarpeta 'silencioso' no comenta ni propone nada en esa carpeta",
    run: async (r) => {
      fs.writeFileSync(path.join(r, ".cai/config.json"), JSON.stringify({ acompanar: { porCarpeta: { "src/legacy/**": "silencioso" } } }));
      fs.mkdirSync(path.join(r, "src/legacy"), { recursive: true });
      fs.writeFileSync(path.join(r, "src/legacy/v.ts"), "");
      const calls = fakeLLM(() => ({ respuestas: [{ tipo: "plano", texto: "x", links: [] }] }));
      await acompanar(r, "src/legacy/v.ts");
      return calls.length === 0;
    },
  },
  {
    name: "revisar: un archivo sin cambios desde la última revisión no se vuelve a mandar a la IA",
    run: async (r) => {
      const calls = fakeLLM(() => ({ hallazgos: [] }));
      fs.writeFileSync(path.join(r, "src/rv.ts"), "export function a() {\n  return 1;\n}\n");
      await runReview(r, "src/rv.ts", { solo: ["bugs"] });
      const res = await runReview(r, "src/rv.ts", { solo: ["bugs"] });
      return calls.length === 1 && res.omitidos.some((o) => o.includes("sin cambios"));
    },
  },
  {
    name: "revisar: si cambió una sola parte, solo esa viaja completa (el resto, solo firmas)",
    run: async (r) => {
      const calls = fakeLLM(() => ({ hallazgos: [] }));
      const f = path.join(r, "src/rv.ts");
      fs.writeFileSync(f, "export function a() {\n  return 1;\n}\nexport function b() {\n  return 2;\n}\n");
      await runReview(r, "src/rv.ts", { solo: ["bugs"] });
      fs.writeFileSync(f, "export function a() {\n  return 1;\n}\nexport function b() {\n  return 3;\n}\n");
      await runReview(r, "src/rv.ts", { solo: ["bugs"] });
      const p = calls[1]!.prompt;
      return p.includes("Revisa SOLO estas partes") && p.includes("return 3;") && !p.includes("return 1;") && p.includes("- export function a() {");
    },
  },
  {
    name: "uso: las llamadas evitadas quedan registradas en ~/.cai/uso.jsonl",
    run: async (r) => {
      fakeLLM(() => ({ hallazgos: [] }));
      fs.writeFileSync(path.join(r, "src/rv.ts"), "export const a = 1;\n");
      await runReview(r, "src/rv.ts", { solo: ["bugs"] });
      await runReview(r, "src/rv.ts", { solo: ["bugs"] });
      return leerUso(1).some((u) => u.tipo === "evitada" && u.kind === "revisar");
    },
  },
);

// --- Compatibilidad con proyectos creados antes del cambio de nombre (AICode → ComplementAIry) ---
CASES.push(
  {
    name: "[compat] proyecto viejo con .aicode/: se lee su config y sigue protegido",
    run: async (r) => {
      fs.rmSync(path.join(r, ".cai"), { recursive: true, force: true });
      fs.mkdirSync(path.join(r, ".aicode"), { recursive: true });
      fs.writeFileSync(path.join(r, ".aicode/config.json"), JSON.stringify({ zonas: { delegadas: ["docs/**"], criticas: [] } }));
      const protegido = denied(await write(r, ".aicode/config.json", "{}"));
      const delegado = !denied(await write(r, "docs/x.md", "# x\n"));
      return protegido && delegado;
    },
  },
  {
    name: "[compat] init sobre un proyecto viejo lo actualiza sin duplicar hooks, sección de CLAUDE.md ni skills",
    run: async (r) => {
      fs.mkdirSync(path.join(r, ".claude/skills/aicode-guia"), { recursive: true });
      fs.writeFileSync(path.join(r, ".claude/skills/aicode-guia/SKILL.md"), "vieja");
      fs.writeFileSync(path.join(r, ".claude/settings.json"), JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "aicode hook" }] }] } }));
      fs.writeFileSync(path.join(r, "CLAUDE.md"), "# Mío\n\n<!-- aicode:inicio -->\nviejo\n<!-- aicode:fin -->\n\nfinal\n");
      fs.mkdirSync(path.join(r, ".vscode"), { recursive: true });
      fs.writeFileSync(path.join(r, ".vscode/aicode-base.code-snippets"), '{"x":{"prefix":"x","body":["editado"]}}');
      init(r);
      init(r);
      const settings = JSON.parse(fs.readFileSync(path.join(r, ".claude/settings.json"), "utf8")) as { hooks: Record<string, unknown[]> };
      const md = fs.readFileSync(path.join(r, "CLAUDE.md"), "utf8");
      return (
        settings.hooks.PreToolUse!.length === 1 &&
        md.startsWith("# Mío") && md.endsWith("final\n") && !md.includes("viejo") && (md.match(/cai:inicio/g)?.length ?? 0) === 1 &&
        !fs.existsSync(path.join(r, ".claude/skills/aicode-guia")) && fs.existsSync(path.join(r, ".claude/skills/cai-guia/SKILL.md")) &&
        fs.readFileSync(path.join(r, ".vscode/cai-base.code-snippets"), "utf8").includes("editado")
      );
    },
  },
);

// --- Prácticas, tests, memoria del proyecto y panorama -----------------------------------
const largo = (n: number) => `export function larga(a: number) {\n${Array.from({ length: n }, (_, i) => `  const v${i} = a + ${i};`).join("\n")}\n  return a;\n}\n`;
CASES.push(
  {
    name: "prácticas: una función que supera el umbral recibe UN plano de diseño (y no se repite)",
    run: async (r) => {
      fs.writeFileSync(path.join(r, ".cai/config.json"), JSON.stringify({ practicas: { maxLineasFuncion: 10 }, tests: { avisarSinTests: false } }));
      const calls = fakeLLM(() => ({ respuestas: [{ tipo: "plano", texto: "Sepárala en calcularBase(a) y sumarAjustes(a).", links: [] }] }));
      const f = path.join(r, "src/larga.ts");
      fs.writeFileSync(f, largo(15));
      await acompanar(r, "src/larga.ts");
      await acompanar(r, "src/larga.ts");
      const diseno = calls.filter((c) => c.prompt.includes("Práctica que no se cumple"));
      return diseno.length === 1 && diseno[0]!.prompt.includes("líneas (máx. 10)") && fs.readFileSync(f, "utf8").includes("plano: Sepárala");
    },
  },
  {
    name: "prácticas: los umbrales se configuran (null desactiva) y nada se pide si se cumplen",
    run: async (r) => {
      fs.writeFileSync(path.join(r, ".cai/config.json"), JSON.stringify({ practicas: { maxLineasFuncion: null }, tests: { avisarSinTests: false } }));
      const calls = fakeLLM(() => ({ respuestas: [{ tipo: "plano", texto: "x", links: [] }] }));
      fs.writeFileSync(path.join(r, "src/larga.ts"), largo(60));
      await acompanar(r, "src/larga.ts");
      return !calls.some((c) => c.prompt.includes("Práctica que no se cumple"));
    },
  },
  {
    name: "tests: al terminar una función exportada sin tests, aviso SIN IA de cómo pedirlos",
    run: async (r) => {
      const calls = fakeLLM(() => ({ hallazgos: [], respuestas: [] }));
      const f = path.join(r, "src/st.ts");
      fs.writeFileSync(f, "export const z = 0;\n");
      await acompanar(r, "src/st.ts");
      fs.writeFileSync(f, "export const z = 0;\nexport function doble(a: number) {\n  const b = a * 2;\n  return b;\n}\n");
      await acompanar(r, "src/st.ts");
      fs.writeFileSync(f, fs.readFileSync(f, "utf8") + "export const y = 1;\n");
      await acompanar(r, "src/st.ts");
      const out = fs.readFileSync(f, "utf8");
      return out.includes("`doble` todavía no tiene tests") && out.includes("tests/st.test.ts") && !calls.some((c) => c.kind === "tests");
    },
  },
  {
    name: "tests: !tests propone casos APAGADOS en tests/, con imports calculados y preguntas si el esperado es dudoso",
    run: async (r) => {
      fs.writeFileSync(path.join(r, "src/cuota2.ts"), "export function cuota(monto: number, meses: number) {\n  // @ia? !tests\n  return monto / meses;\n}\n");
      fakeLLM((o) =>
        o.kind === "tests"
          ? {
              casos: [
                { tipo: "normal", descripcion: "divide en partes iguales", llamada: "cuota(1200, 12)", esperado: "100", duda: "" },
                { tipo: "normal", descripcion: "meses cero", llamada: "cuota(1200, 0)", esperado: "?", duda: "¿meses = 0 es error o 0?" },
                { tipo: "normal", descripcion: "inválido", llamada: "cuota(require('fs'))", esperado: "1", duda: "" },
              ],
            }
          : said("x"),
      );
      const res = await runGuia(r, "src/cuota2.ts");
      const t = fs.readFileSync(path.join(r, "tests/cuota2.test.ts"), "utf8");
      const src = fs.readFileSync(path.join(r, "src/cuota2.ts"), "utf8");
      return (
        res.respondidos === 1 &&
        src.includes("Te propuse 2 caso(s) en tests/cuota2.test.ts") &&
        t.includes('snippet [ ]: vitest') &&
        t.includes('snippet [ ]: importar nombres="cuota" ruta="../src/cuota2.js"') &&
        t.includes('snippet [ ]: test descripcion="divide en partes iguales" llamada="cuota(1200, 12)" esperado="100"') &&
        t.includes("pregunta: ¿meses = 0 es error o 0?") &&
        !t.includes("require") &&
        !t.includes("Marca [x]") &&
        (await verifyCommentOnly("", t, langFor("a.ts")!)).ok
      );
    },
  },
  {
    name: "tests: al activar los casos con [x], el archivo de tests queda con código real",
    run: async (r) => {
      fs.mkdirSync(path.join(r, "tests"), { recursive: true });
      const t = path.join(r, "tests/a.test.ts");
      fs.writeFileSync(t, '// @guia[x1.1] snippet [x]: vitest\n// @guia[x1.1] snippet [x]: importar nombres="cuota" ruta="../src/a.js"\n// @guia[x1.1] snippet [x]: test descripcion="divide" llamada="cuota(1200, 12)" esperado="100"\n');
      fs.writeFileSync(path.join(r, ".cai/config.json"), JSON.stringify({ acompanar: { nivel: "silencioso" } }));
      await acompanar(r, "tests/a.test.ts");
      const out = fs.readFileSync(t, "utf8");
      return out.includes('import { describe, expect, test } from "vitest";') && out.includes('import { cuota } from "../src/a.js";') && out.includes("expect(cuota(1200, 12)).toBe(100);");
    },
  },
  {
    name: "panorama: resume solo lo que cambió, guarda la memoria y mueve tus respuestas a 'Lo que me contaste'",
    run: async (r) => {
      const calls = fakeLLM((o) =>
        o.kind === "panorama:resumen"
          ? { resumenes: [...o.prompt.matchAll(/=== (\S+)/g)].map((m) => ({ archivo: m[1]!, resumen: `resumen de ${m[1]}` })) }
          : { estado: "Bien encaminado.", sugerencias: [{ titulo: "Separar validación", porque: "mezcla", plano: "crear validacion.ts", archivos: ["src/cuota.ts"] }], alternativas: [], riesgos: [], preguntas: [{ pregunta: "¿En qué moneda trabajas?", sugerencia: "" }] },
      );
      await panorama(r);
      const mem = path.join(r, ".cai/conocimiento.md");
      const m1 = fs.readFileSync(mem, "utf8");
      fs.writeFileSync(mem, m1.replace("- P: ¿En qué moneda trabajas?\n  R: ", "- P: ¿En qué moneda trabajas?\n  R: CLP, sin decimales"));
      fs.writeFileSync(path.join(r, "src/nuevo.ts"), "export const n = 1;\n");
      await panorama(r);
      const resumenCalls = calls.filter((c) => c.kind === "panorama:resumen");
      const m2 = fs.readFileSync(mem, "utf8");
      const pano = fs.readFileSync(path.join(r, ".cai/panorama.md"), "utf8");
      return (
        resumenCalls.length === 2 && resumenCalls[1]!.prompt.includes("src/nuevo.ts") && !resumenCalls[1]!.prompt.includes("src/cuota.ts") &&
        m2.includes("¿En qué moneda trabajas? → CLP, sin decimales") && m2.includes("`src/cuota.ts`: resumen de src/cuota.ts") &&
        pano.includes("Separar validación") &&
        cargarTareas(r).filter((t) => t.origen === "panorama" && t.titulo === "Separar validación" && t.archivo === "src/cuota.ts").length === 1
      );
    },
  },
  {
    name: "panorama: sin cambios no vuelve a llamar a la IA; --sin-ia mide sin llamar",
    run: async (r) => {
      const calls = fakeLLM((o) => (o.kind === "panorama:resumen" ? { resumenes: [] } : { estado: "x", sugerencias: [], alternativas: [], riesgos: [], preguntas: [] }));
      await panorama(r, { sinIa: true });
      const sinIa = calls.length;
      await panorama(r);
      const n = calls.length;
      await panorama(r);
      return sinIa === 0 && calls.length === n;
    },
  },
  {
    name: "memoria: lo que respondiste se usa como contexto en la guía; y todas las IAs tienen el criterio de no anclarse",
    run: async (r) => {
      fs.writeFileSync(path.join(r, ".cai/conocimiento.md"), "# x\n\n## Lo que me contaste\n\n- ¿Moneda? → CLP, sin decimales\n");
      fs.writeFileSync(path.join(r, "src/g.ts"), "// @ia? ¿cómo redondeo?\nexport {};\n");
      const calls = fakeLLM(() => said("x"));
      await runGuia(r, "src/g.ts");
      return calls[0]!.prompt.includes("CLP, sin decimales") && calls[0]!.system.includes("No te ancles");
    },
  },
);

// --- Proyectos ya armados: autoría y arranque guiado --------------------------------------
const git = (r: string, args: string[], env: Record<string, string> = {}) => execFileSync("git", args, { cwd: r, stdio: "ignore", env: { ...process.env, ...env } });
const conocerFake = (o: AskOptions) =>
  o.kind === "conocer"
    ? {
        resumen: "Simulador de préstamos.",
        proyecto: "Calcula cuotas de préstamos para una fundación.",
        reglas: ["Funciones exportadas con nombres en español", "Errores con RangeError y mensaje explicativo"],
        preguntas: [
          { pregunta: "¿Quién usa el simulador?", sugerencia: "El equipo de la fundación", opciones: ["Clientes finales", "Ambos"] },
          { pregunta: "¿Qué es lo más crítico?", sugerencia: "Que la cuota sea exacta", opciones: ["Que sea rápido", "Que sea fácil de usar"] },
        ],
      }
    : said("x");
CASES.push(
  {
    name: "autoría: según git, lo que nunca tocaste se sugiere como heredado; vendor/ como terceros (sin IA)",
    run: async (r) => {
      git(r, ["init", "-q"]);
      git(r, ["config", "user.email", "yo@ejemplo.cl"]);
      git(r, ["config", "user.name", "Yo"]);
      fs.mkdirSync(path.join(r, "legacy"), { recursive: true });
      fs.mkdirSync(path.join(r, "vendor"), { recursive: true });
      for (const n of ["a", "b", "c"]) fs.writeFileSync(path.join(r, `legacy/${n}.ts`), `export const ${n} = 1;\n`);
      fs.writeFileSync(path.join(r, "vendor/lib.js"), "x\n");
      const otro = { GIT_AUTHOR_NAME: "Otra", GIT_AUTHOR_EMAIL: "otra@ejemplo.cl", GIT_COMMITTER_NAME: "Otra", GIT_COMMITTER_EMAIL: "otra@ejemplo.cl" };
      git(r, ["add", "legacy", "vendor"]);
      git(r, ["commit", "-qm", "viejo"], otro);
      git(r, ["add", "-A"]);
      git(r, ["commit", "-qm", "mío"]);
      const { autoria } = sugerirAutoria(r, ["legacy/a.ts", "legacy/b.ts", "legacy/c.ts", "vendor/lib.js", "src/cuota.ts"]);
      return autoria.some((a) => a.glob === "legacy/**" && a.tipo === "heredado") && autoria.some((a) => a.glob === "vendor/**" && a.tipo === "terceros") && !autoria.some((a) => a.glob.startsWith("src"));
    },
  },
  {
    name: "conocer (sin terminal): borradores de proyecto.md y reglas.md; preguntas con sugerencia quedan en la memoria",
    run: async (r) => {
      fakeLLM(conocerFake);
      const res = await conocer(r);
      const proyecto = fs.readFileSync(path.join(r, ".cai/proyecto.md"), "utf8");
      const reglas = fs.readFileSync(path.join(r, ".cai/reglas.md"), "utf8");
      const mem = fs.readFileSync(path.join(r, ".cai/conocimiento.md"), "utf8");
      return proyecto.includes("Calcula cuotas") && reglas.includes("- Errores con RangeError") && mem.includes("¿Quién usa el simulador? (sugerencia: El equipo de la fundación)") && res.pendientes === 2;
    },
  },
  {
    name: "conocer (con terminal): Enter acepta la sugerencia, un número elige opción, y la autoría se marca solo si confirmas",
    run: async (r) => {
      git(r, ["init", "-q"]);
      git(r, ["config", "user.email", "yo@ejemplo.cl"]);
      fs.mkdirSync(path.join(r, "legacy"), { recursive: true });
      for (const n of ["a", "b", "c"]) fs.writeFileSync(path.join(r, `legacy/${n}.ts`), `export const ${n} = 1;\n`);
      git(r, ["add", "legacy"]);
      git(r, ["commit", "-qm", "viejo"], { GIT_AUTHOR_NAME: "Otra", GIT_AUTHOR_EMAIL: "otra@x.cl", GIT_COMMITTER_NAME: "Otra", GIT_COMMITTER_EMAIL: "otra@x.cl" });
      git(r, ["add", "-A"]);
      git(r, ["commit", "-qm", "mío"], { GIT_AUTHOR_NAME: "Yo", GIT_COMMITTER_NAME: "Yo" });
      fakeLLM(conocerFake);
      const respuestas = ["", "2", "s"];
      const res = await conocer(r, { preguntar: async () => respuestas.shift() ?? "" });
      const proyecto = fs.readFileSync(path.join(r, ".cai/proyecto.md"), "utf8");
      const cfg = JSON.parse(fs.readFileSync(path.join(r, ".cai/config.json"), "utf8")) as { autoria: { heredado: string[] } };
      const mem = fs.readFileSync(path.join(r, ".cai/conocimiento.md"), "utf8");
      return (
        proyecto.includes("¿Quién usa el simulador? → El equipo de la fundación") &&
        proyecto.includes("¿Qué es lo más crítico? → Que sea fácil de usar") &&
        cfg.autoria.heredado.includes("legacy/**") &&
        mem.includes("→ El equipo de la fundación") &&
        res.pendientes === 0
      );
    },
  },
  {
    name: "conocer: si proyecto.md ya tiene tu contenido, no lo pisa (deja proyecto.borrador.md)",
    run: async (r) => {
      fs.writeFileSync(path.join(r, ".cai/proyecto.md"), "# Qué busca\n\nMi texto.\n");
      fakeLLM(conocerFake);
      await conocer(r);
      return fs.readFileSync(path.join(r, ".cai/proyecto.md"), "utf8").includes("Mi texto.") && fs.existsSync(path.join(r, ".cai/proyecto.borrador.md"));
    },
  },
  {
    name: "autoría: el código heredado no cuenta en tu perfil ni en tus errores frecuentes, y la IA sabe que no es tuyo",
    run: async (r) => {
      fs.writeFileSync(path.join(r, ".cai/config.json"), JSON.stringify({ autoria: { heredado: ["legacy/**"] } }));
      fs.mkdirSync(path.join(r, "legacy"), { recursive: true });
      fs.writeFileSync(path.join(r, "legacy/v.ts"), "export function v(a: number) {\n  return 10 / a;\n}\n");
      const calls = fakeLLM(() => ({ hallazgos: [{ codigo: "  return 10 / a;", etiqueta: "issue", bloqueante: true, categoria: "division", texto: "a puede ser 0", links: [] }] }));
      await runReview(r, "legacy/v.ts", { solo: ["bugs"] });
      const perfil = loadPerfil().temas.typescript;
      const patrones = fs.existsSync(path.join(process.env.CAI_HOME!, "patrones.json")) ? fs.readFileSync(path.join(process.env.CAI_HOME!, "patrones.json"), "utf8") : "";
      return calls[0]!.prompt.includes("HEREDADO") && !perfil && !patrones.includes("division");
    },
  },
  {
    name: "autoría: en código heredado el acompañante no interrumpe (salvo que lo actives) y terceros se ignora en el panorama",
    run: async (r) => {
      fs.writeFileSync(path.join(r, ".cai/config.json"), JSON.stringify({ autoria: { heredado: ["legacy/**"], terceros: ["vendor/**"] } }));
      fs.mkdirSync(path.join(r, "legacy"), { recursive: true });
      fs.mkdirSync(path.join(r, "vendor"), { recursive: true });
      fs.writeFileSync(path.join(r, "legacy/n.ts"), "");
      fs.writeFileSync(path.join(r, "vendor/lib.ts"), "export const lib = 1;\n");
      const calls = fakeLLM((o) => (o.kind === "panorama:resumen" ? { resumenes: [] } : { estado: "x", sugerencias: [], alternativas: [], riesgos: [], preguntas: [], respuestas: [] }));
      await acompanar(r, "legacy/n.ts");
      const sinAcompanar = calls.length === 0;
      await panorama(r);
      return sinAcompanar && !calls.some((c) => c.prompt.includes("vendor/lib.ts"));
    },
  },
);

// --- Usar ComplementAIry desde el chat de Claude Code ------------------------------------
CASES.push(
  {
    name: "[seg] chat: la IA no puede responder tus preguntas ('cai memoria responder' por Bash se revierte)",
    run: async (r) => {
      actualizarMemoria(r, (m) => m.abiertas.push({ p: "¿Moneda?", r: "" }));
      const antes = fs.readFileSync(path.join(r, ".cai/conocimiento.md"), "utf8");
      await bash(r, "cai memoria responder 1 CLP", "m1");
      responderPregunta(r, 1, "CLP");
      const out = await postBash(r, "m1");
      return out !== null && fs.readFileSync(path.join(r, ".cai/conocimiento.md"), "utf8") === antes;
    },
  },
  {
    name: "chat: 'cai panorama' por Bash deja panorama.md y conocimiento.md (sus archivos), sin revertirlos",
    run: async (r) => {
      fakeLLM((o) => (o.kind === "panorama:resumen" ? { resumenes: [] } : { estado: "ok", sugerencias: [], alternativas: [], riesgos: [], preguntas: [{ pregunta: "¿Moneda?", sugerencia: "CLP" }] }));
      await bash(r, "cai panorama", "c1");
      await panorama(r);
      const out = await postBash(r, "c1");
      return out === null && fs.existsSync(path.join(r, ".cai/panorama.md")) && fs.existsSync(path.join(r, ".cai/conocimiento.md"));
    },
  },
  {
    name: "[seg] chat: un comando cai encadenado (&&) no habilita escribir en .cai/ (se revierte)",
    run: async (r) => {
      fs.writeFileSync(path.join(r, ".cai/conocimiento.md"), "# x\n");
      await bash(r, "cai panorama && echo listo", "c2");
      fs.writeFileSync(path.join(r, ".cai/conocimiento.md"), "# x\n- P: ¿a?\n  R: inventada por la IA\n");
      const out = await postBash(r, "c2");
      return out?.decision === "block" && !fs.readFileSync(path.join(r, ".cai/conocimiento.md"), "utf8").includes("inventada");
    },
  },
  {
    name: "[seg] chat: 'cai panorama' no habilita tocar config.json ni reglas.md",
    run: async (r) => {
      await bash(r, "cai panorama", "c3");
      fs.writeFileSync(path.join(r, ".cai/config.json"), JSON.stringify({ zonas: { delegadas: ["**"] } }));
      const out = await postBash(r, "c3");
      return out?.decision === "block" && !fs.readFileSync(path.join(r, ".cai/config.json"), "utf8").includes('"**"');
    },
  },
  {
    name: "[seg] chat: 'cai conocer' solo escribe proyecto.md si estaba vacío (si no, debe ser .borrador)",
    run: async (r) => {
      fs.writeFileSync(path.join(r, ".cai/proyecto.md"), "# Qué busca\n\nTexto del humano.\n");
      await bash(r, "cai conocer --sin-preguntas", "c4");
      fs.writeFileSync(path.join(r, ".cai/proyecto.md"), "# Qué busca\n\nReemplazado por la IA.\n");
      fs.writeFileSync(path.join(r, ".cai/proyecto.borrador.md"), "# borrador\n");
      const out = await postBash(r, "c4");
      return out?.decision === "block" && fs.readFileSync(path.join(r, ".cai/proyecto.md"), "utf8").includes("Texto del humano") && fs.existsSync(path.join(r, ".cai/proyecto.borrador.md"));
    },
  },
  {
    name: "[seg] chat: activar snippets, init, crear snippets y declarar perfil son del humano (bloqueados)",
    run: async (r) =>
      denied(await bash(r, "cai expandir src/cuota.ts")) &&
      denied(await bash(r, "cai init .")) &&
      denied(await bash(r, "cai snippet nuevo x")) &&
      denied(await bash(r, "complementairy perfil set typescript experto")) &&
      !denied(await bash(r, "cai revisar src/cuota.ts")),
  },
);

// --- v0.5: notas, bloqueo, siguiente paso, formato y modelos por tamaño ---------------------
const conNotas = (r: string, extra: object = {}) => fs.writeFileSync(path.join(r, ".cai/config.json"), JSON.stringify({ vista: "notas", ...extra }));
const sha = (f: string) => crypto.createHash("sha1").update(fs.readFileSync(f)).digest("hex");
const DOS = "export function a(x: number) {\n  return 10 / x;\n}\n\nexport function b(y: number) {\n  const z = y * 2;\n  return z;\n}\n";
const respNota = (texto = "pensá en X", extra: object = {}) => ({ titulo: "Validar meses", que_hacer: "Agrega la validación al inicio", respuestas: [{ tipo: "pista", texto, links: [], codigo: "" }], nivel_usado: 2, ...extra });
CASES.push(
  {
    name: "notas: un @ia? del archivo se responde en una nota y el archivo NO se toca",
    run: async (r) => {
      conNotas(r);
      const f = path.join(r, "src/n.ts");
      fs.writeFileSync(f, "export function f(m: number) {\n  // @ia? ¿cómo valido m?\n  return m;\n}\n");
      const antes = sha(f);
      const calls = fakeLLM(() => respNota());
      await runGuia(r, "src/n.ts");
      await runGuia(r, "src/n.ts"); // ya respondida: no vuelve a llamar
      const notas = cargarNotas(r, "src/n.ts");
      return sha(f) === antes && calls.length === 1 && notas.length === 1 && notas[0]!.ancla.funcion === "f" && notas[0]!.ancla.linea === 1 && notas[0]!.hilo.length === 2 && notas[0]!.accion.includes("validación");
    },
  },
  {
    name: "notas: botón 'pseudo' pide ese escalón; 'no entiendo' sube uno; 'tests' propone casos",
    run: async (r) => {
      conNotas(r);
      const calls = fakeLLM((o) => (o.kind === "tests" ? { casos: [{ tipo: "normal", descripcion: "uno", llamada: "cuota(1, 1)", esperado: "1", duda: "" }] } : respNota()));
      const a = await responderNota(r, { archivo: "src/cuota.ts", linea: 3, pedido: "pseudo" });
      await responderNota(r, { archivo: "src/cuota.ts", notaId: a.nota.id, texto: "no entiendo" });
      const b = await responderNota(r, { archivo: "src/cuota.ts", notaId: a.nota.id, pedido: "tests" });
      const lv = calls.filter((c) => c.kind === "responder").map(levelIn);
      return lv[0] === 3 && lv[1] === 4 && b.nota.hilo.some((m) => m.texto.includes("tests/cuota.test.ts"));
    },
  },
  {
    name: "notas: seleccionar código y preguntar crea una nota en esa línea con la selección como contexto",
    run: async (r) => {
      conNotas(r);
      const calls = fakeLLM(() => respNota());
      const { nota } = await responderNota(r, { archivo: "src/cuota.ts", linea: 3, seleccion: "return monto / meses;", texto: "¿y si meses es 0?" });
      return nota.ancla.funcion === "cuota" && calls[0]!.prompt.includes("Sobre esta parte") && nota.hilo[0]!.quien === "tu";
    },
  },
  {
    name: "notas: se re-anclan solas al insertar líneas arriba; si su línea desaparece quedan 'desancladas' (no se pierden)",
    run: async (r) => {
      conNotas(r);
      fakeLLM(() => respNota());
      await responderNota(r, { archivo: "src/cuota.ts", linea: 3, texto: "?" });
      const f = path.join(r, "src/cuota.ts");
      fs.writeFileSync(f, "// nuevo\n// nuevo\n" + TS);
      const movida = cargarNotas(r, "src/cuota.ts")[0]!.ancla.linea === 3;
      fs.writeFileSync(f, "export const x = 1;\n");
      const n = cargarNotas(r, "src/cuota.ts")[0]!;
      return movida && !!n.desanclada && n.estado === "abierta";
    },
  },
  {
    name: "notas: la revisión y el acompañante dejan notas (no comentarios) y el archivo queda igual",
    run: async (r) => {
      conNotas(r, { tests: { avisarSinTests: false } });
      const f = path.join(r, "src/rv.ts");
      fs.writeFileSync(f, "export function a(x: number) {\n  return 10 / x;\n}\n");
      const antes = sha(f);
      fakeLLM((o) => (o.kind === "revisar:consolidar" ? { mantener: [0] } : { hallazgos: [{ codigo: "  return 10 / x;", etiqueta: "issue", bloqueante: true, categoria: "div", texto: "x puede ser 0", links: [] }] }));
      const res = await runReview(r, "src/rv.ts", { solo: ["bugs"] });
      const notas = cargarNotas(r, "src/rv.ts");
      return sha(f) === antes && res.insertados === 1 && notas.length === 1 && notas[0]!.bloqueante && notas[0]!.ancla.funcion === "a";
    },
  },
  {
    name: "notas: una predicción se comprueba ejecutando el código al responderla en la nota (sin IA)",
    run: async (r) => {
      conNotas(r);
      fs.writeFileSync(path.join(r, "package.json"), JSON.stringify({ type: "module" }));
      const notas = cargarNotas(r, "src/cuota.ts");
      const n = nuevaNota(notas, { archivo: "src/cuota.ts", ancla: { linea: 1, texto: "" }, tipo: "prediccion", titulo: "p", origen: "predecir", prediccion: { expresion: "cuota(10, 2)", funcion: "cuota" } });
      guardarNotas(r, "src/cuota.ts", notas);
      const calls = fakeLLM(() => respNota());
      const out = await responderNota(r, { archivo: "src/cuota.ts", notaId: n.id, texto: "5" });
      const ultimo = out.nota.hilo[out.nota.hilo.length - 1]!.texto;
      return calls.length === 0 && (ultimo.includes("Correcto") || ultimo.includes("No pude ejecutar"));
    },
  },
  {
    name: "bloqueo: un segundo pedido sobre el mismo archivo se rechaza; el acompañante deja UNO en espera",
    run: async (r) => {
      const f = path.join(r, ".cai/cache/ocupado");
      fs.mkdirSync(f, { recursive: true });
      // Simula otro proceso vivo (el padre de este) revisando el archivo.
      const clave = crypto.createHash("sha1").update("src/cuota.ts").digest("hex").slice(0, 12);
      fs.writeFileSync(path.join(f, `${clave}.json`), JSON.stringify({ pid: process.ppid, tarea: "revisando", archivo: "src/cuota.ts", desde: new Date().toISOString() }));
      const otro = ocupar(r, "src/cuota.ts", "respondiendo");
      const res = await acompanar(r, "src/cuota.ts");
      const pendiente = fs.readdirSync(f).some((x) => x.endsWith(".pendiente"));
      // Un bloqueo de un proceso muerto se limpia solo.
      fs.writeFileSync(path.join(f, `${clave}.json`), JSON.stringify({ pid: 999999, tarea: "x", archivo: "src/cuota.ts", desde: new Date().toISOString() }));
      const libre = ocupar(r, "src/cuota.ts", "y");
      if (libre.ok) libre.liberar();
      return !otro.ok && !!res.pendiente && pendiente && libre.ok && enCurso(r).length === 0;
    },
  },
  {
    name: "siguiente: el orden es determinista (responder > arreglar > tareas > bloqueantes > notas)",
    run: async (r) => {
      conNotas(r);
      const notas = cargarNotas(r, "src/cuota.ts");
      nuevaNota(notas, { archivo: "src/cuota.ts", ancla: { linea: 2, texto: "" }, tipo: "revision", titulo: "normal", origen: "revisar", accion: "leer" });
      nuevaNota(notas, { archivo: "src/cuota.ts", ancla: { linea: 2, texto: "" }, tipo: "revision", titulo: "grave", origen: "revisar", bloqueante: true });
      nuevaNota(notas, { archivo: "src/cuota.ts", ancla: { linea: 1, texto: "" }, tipo: "prediccion", titulo: "pred", origen: "predecir", prediccion: { expresion: "cuota(1,1)", funcion: "cuota" }, hilo: [mensaje("ia", "¿qué devuelve?")] });
      guardarNotas(r, "src/cuota.ts", notas);
      guardarDiagnosticos(r, "src/cuota.ts", [{ archivo: "src/cuota.ts", linea: 3, msg: "[tipos] error" }]);
      agregarTareas(r, [{ titulo: "Crear validar", archivo: "src/cuota.ts", funcion: "validar", origen: "plano" }]);
      const p = await siguiente(r);
      const tipos = p.map((x) => x.tipo);
      return tipos[0] === "responder" && tipos.indexOf("arreglar") < tipos.indexOf("tarea") && tipos.indexOf("tarea") < tipos.indexOf("bloqueante") && tipos.indexOf("bloqueante") < tipos.indexOf("nota");
    },
  },
  {
    name: "tareas: la de 'crear X' se marca hecha sola cuando la función aparece en el archivo",
    run: async (r) => {
      agregarTareas(r, [{ titulo: "Crear validar", archivo: "src/cuota.ts", funcion: "validar", origen: "plano" }]);
      const antes = (await actualizarTareas(r))[0]!.hecha;
      fs.appendFileSync(path.join(r, "src/cuota.ts"), "export function validar(m: number) {\n  return m > 0;\n}\n");
      return !antes && (await actualizarTareas(r))[0]!.hecha;
    },
  },
  {
    name: "plano de archivo: resumen + nota junto a la función existente + tareas para las que faltan",
    run: async (r) => {
      conNotas(r);
      fakeLLM(() => ({
        resumen: "Cálculo de cuotas.",
        funciones: [
          { nombre: "cuota", que_hace: "Calcula la cuota.", recibe: "monto, meses", devuelve: "number", cuida: "meses = 0", snippet: "" },
          { nombre: "validarMeses", que_hace: "Valida meses.", recibe: "meses", devuelve: "void", cuida: "no entero", snippet: "fnexport nombre=validarMeses args=meses" },
        ],
        orden: "Empieza por validarMeses.",
      }));
      const res = await planoArchivo(r, "src/cuota.ts");
      const notas = cargarNotas(r, "src/cuota.ts");
      const tareas = cargarTareas(r);
      return res.tareas === 1 && tareas[0]!.funcion === "validarMeses" && notas.some((n) => n.alcance === "archivo") && notas.filter((n) => n.ancla.funcion === "cuota").length === 1;
    },
  },
  {
    name: "formato: las listas 1) 2) y '- ' quedan en líneas separadas",
    run: async () => separarListas("Pasos: 1) uno. 2) dos. Cuida: - a. - b.") === "Pasos:\n1) uno.\n2) dos. Cuida:\n- a.\n- b.",
  },
  {
    name: "expandir: una sugerencia se lleva TODAS sus líneas (continuaciones y docs:) y respeta el ítem siguiente",
    run: async (r) => {
      const src = "// @guia[c1.1] snippet [x]: fn nombre=a\n// @guia[c1.1]   para algo\n// @guia[c1.1]   y más\n// @guia[c1.1] docs: https://x.dev\n// @guia[c1.1] pista: sigo aquí\nlet z;\n";
      const out = aplicarExpansion(src, await planExpansion(r, "src/e.ts", src, 1));
      return !out.includes("para algo") && !out.includes("y más") && !out.includes("docs:") && out.includes("pista: sigo aquí") && out.includes("const a = (args) => {");
    },
  },
  {
    name: "bloqueo: un pedido tuyo espera al acompañante (autoguardado) en vez de rechazarse; las notas se escriben atómicas",
    run: async (r) => {
      const d = path.join(r, ".cai/cache/ocupado");
      fs.mkdirSync(d, { recursive: true });
      const clave = crypto.createHash("sha1").update("src/cuota.ts").digest("hex").slice(0, 12);
      const f = path.join(d, `${clave}.json`);
      fs.writeFileSync(f, JSON.stringify({ pid: process.ppid, tarea: "acompañando", archivo: "src/cuota.ts", desde: new Date().toISOString() }));
      setTimeout(() => fs.rmSync(f, { force: true }), 700);
      const t0 = Date.now();
      const ok = await conBloqueo(r, "src/cuota.ts", "respondiendo", async () => true);
      guardarNotas(r, "src/cuota.ts", []);
      const restos = fs.readdirSync(path.join(r, ".cai/notas")).filter((x) => x.endsWith(".tmp"));
      return ok && Date.now() - t0 >= 600 && restos.length === 0;
    },
  },
  {
    name: "estructura: markdown limpio + estructura.json; los archivos que faltan son tareas que se marcan solas al crearlos; sus preguntas van a la memoria",
    run: async (r) => {
      fakeLLM(() => ({ ...planoFake, orden: ["1. Empieza por prestamo"], modulos: [{ archivo: "src/cuota.ts", responsabilidad: "cuotas", funciones: [] }, { archivo: "src/dominio/prestamo.ts", responsabilidad: "reglas del préstamo", funciones: ["validar"] }], preguntas: [{ pregunta: "¿Usas base de datos?", sugerencia: "SQLite (simple)" }] }));
      const res = await planoProyecto(r, "préstamos");
      const md = fs.readFileSync(path.join(r, "docs/ESTRUCTURA.md"), "utf8");
      const est = JSON.parse(fs.readFileSync(path.join(r, ".cai/estructura.json"), "utf8")) as { modulos: unknown[] };
      const t = cargarTareas(r);
      const mem = leerMemoria(path.join(r, ".cai/conocimiento.md"));
      fs.mkdirSync(path.join(r, "src/dominio"), { recursive: true });
      fs.writeFileSync(path.join(r, "src/dominio/prestamo.ts"), "");
      const hecha = (await actualizarTareas(r)).find((x) => x.archivo === "src/dominio/prestamo.ts")?.hecha;
      return res.tareas === 1 && t.length === 1 && t[0]!.crear === true && md.includes("○ `src/dominio/prestamo.ts`") && md.includes("✓ `src/cuota.ts`") && est.modulos.length === 2 && md.includes("1. Empieza por prestamo") && !md.includes("1. 1.") && mem.abiertas[0]?.p === "¿Usas base de datos? (sugerencia: SQLite (simple))" && hecha === true;
    },
  },
  {
    name: "memoria: responder una pregunta la pasa a 'Lo que me contaste' al instante (sin la sugerencia)",
    run: async (r) => {
      actualizarMemoria(r, (m) => m.abiertas.push({ p: "¿Qué base de datos? (sugerencia: Postgres)", r: "" }, { p: "¿Deploy?", r: "" }));
      const lista = { abiertas: preguntasAbiertas(r) };
      responderPregunta(r, 1, "SQLite");
      const mem = leerMemoria(path.join(r, ".cai/conocimiento.md"));
      return lista.abiertas[0]!.sugerencia === "Postgres" && lista.abiertas[0]!.pregunta === "¿Qué base de datos?" && mem.respondidas.includes("¿Qué base de datos? → SQLite") && mem.abiertas.length === 1;
    },
  },
  {
    name: "archivo entero: la nota va arriba sin función y la IA sabe que es sobre todo el archivo",
    run: async (r) => {
      conNotas(r);
      const calls = fakeLLM(() => respNota());
      const { nota } = await responderNota(r, { archivo: "src/cuota.ts", archivoEntero: true, texto: "¿cómo organizo este archivo?" });
      return nota.alcance === "archivo" && nota.ancla.linea === 1 && !nota.ancla.funcion && calls[0]!.prompt.includes("ARCHIVO COMPLETO") && !calls[0]!.prompt.includes("◀ NOTA");
    },
  },
  {
    name: "memoria: respuestas de varias líneas no rompen el archivo; sugerencias con paréntesis; no repite lo ya respondido",
    run: async (r) => {
      actualizarMemoria(r, (m) => m.abiertas.push({ p: "¿DB? (sugerencia: SQLite (simple))", r: "" }));
      const q = preguntasAbiertas(r)[0]!;
      responderPregunta(r, 1, "x\n## Notas tuyas\nhack");
      const m = leerMemoria(path.join(r, ".cai/conocimiento.md"));
      actualizarMemoria(r, (mm) => agregarPreguntas(mm, ["¿DB? (sugerencia: otra)"]));
      const m2 = leerMemoria(path.join(r, ".cai/conocimiento.md"));
      return q.pregunta === "¿DB?" && q.sugerencia === "SQLite (simple)" && m.respondidas[0] === "¿DB? → x Notas tuyas hack" && m.notas === "" && m2.abiertas.length === 0;
    },
  },
  {
    name: "[seg] chat: 'cai plano' puede agregar preguntas a la memoria, pero no cambiar lo que respondiste",
    run: async () => {
      const permitido = generadosPor("cai plano")!;
      const base = "# x\n\n## Lo que me contaste\n\n- ¿DB? → SQLite\n\n## Preguntas abiertas\n\n(ninguna)\n\n## Notas tuyas\n\nmis notas\n";
      const conPregunta = base.replace("(ninguna)", "- P: ¿Moneda?\n  R: ");
      const falsa = base.replace("SQLite", "Postgres");
      const ok = permitido(".cai/conocimiento.md", Buffer.from(base), Buffer.from(conPregunta));
      const malo = permitido(".cai/conocimiento.md", Buffer.from(base), Buffer.from(falsa));
      const agrega = permitido(".cai/conocimiento.md", Buffer.from(base), Buffer.from(base.replace("- ¿DB? → SQLite", "- ¿DB? → SQLite\n- ¿Moneda? → CLP")));
      return ok && !malo && !agrega;
    },
  },
  {
    name: "estructura: una propuesta nueva quita los 'Crear X' pendientes que ya no propone; las notas de archivo quedan arriba",
    run: async (r) => {
      conNotas(r);
      fakeLLM(() => ({ ...planoFake, modulos: [{ archivo: "src/a.ts", responsabilidad: "a", funciones: [] }, { archivo: "src/b.ts", responsabilidad: "b", funciones: [] }] }));
      await planoProyecto(r);
      fakeLLM(() => ({ ...planoFake, modulos: [{ archivo: "src/b.ts", responsabilidad: "b", funciones: [] }] }));
      await planoProyecto(r);
      const t = cargarTareas(r).filter((x) => !x.hecha).map((x) => x.archivo);
      fakeLLM(() => respNota());
      await responderNota(r, { archivo: "src/cuota.ts", archivoEntero: true, texto: "?" });
      fs.writeFileSync(path.join(r, "src/cuota.ts"), "// nueva primera línea\n" + fs.readFileSync(path.join(r, "src/cuota.ts"), "utf8"));
      const n = cargarNotas(r, "src/cuota.ts")[0]!;
      const md = fs.readFileSync(path.join(r, "docs/ESTRUCTURA.md"), "utf8");
      return t.length === 1 && t[0] === "src/b.ts" && n.ancla.linea === 1 && !n.desanclada && md.includes("# Propuesta 2");
    },
  },
  {
    name: "una nota por función: revisión + plano sobre la misma función = UNA nota con dos mensajes",
    run: async (r) => {
      conNotas(r, { tests: { avisarSinTests: false } });
      fs.writeFileSync(path.join(r, "src/d.ts"), DOS);
      fakeLLM((o) => (o.kind === "revisar:consolidar" ? { mantener: [0, 1] } : o.kind === "plano-archivo" ? { resumen: "Dos funciones.", funciones: [{ nombre: "a", que_hace: "Divide.", recibe: "x", devuelve: "number", cuida: "x = 0", snippet: "" }], orden: "Empieza por a." } : { hallazgos: [{ codigo: "  return 10 / x;", etiqueta: "issue", bloqueante: true, categoria: "div", texto: "x puede ser 0", links: [] }, { codigo: "export function a(x: number) {", etiqueta: "suggestion", bloqueante: false, categoria: "nombres", texto: "nombre poco claro", links: [] }] }));
      await runReview(r, "src/d.ts", { solo: ["bugs"] });
      await planoArchivo(r, "src/d.ts");
      const notas = cargarNotas(r, "src/d.ts").filter((n) => n.ancla.funcion === "a");
      return notas.length === 1 && notas[0]!.hilo.length === 2 && notas[0]!.hilo[0]!.texto.includes("- issue") && notas[0]!.bloqueante;
    },
  },
  {
    name: "una nota por función: las notas duplicadas de antes se fusionan (migración) y un id viejo sigue sirviendo",
    run: async (r) => {
      conNotas(r);
      fs.writeFileSync(path.join(r, "src/d.ts"), DOS);
      const notas = cargarNotas(r, "src/d.ts");
      const v1 = nuevaNota(notas, { archivo: "src/d.ts", ancla: { linea: 2, texto: "return 10 / x;" }, tipo: "revision", titulo: "issue 1", origen: "revisar", hilo: [mensaje("ia", "uno")] });
      nuevaNota(notas, { archivo: "src/d.ts", ancla: { linea: 2, texto: "return 10 / x;" }, tipo: "revision", titulo: "issue 2", origen: "revisar", hilo: [mensaje("ia", "dos")], bloqueante: true });
      const v3 = nuevaNota(notas, { archivo: "src/d.ts", ancla: { linea: 1, texto: "export function a(x: number) {", funcion: "a" }, tipo: "plano", titulo: "a: divide", origen: "plano", hilo: [mensaje("ia", "tres")] });
      nuevaNota(notas, { archivo: "src/d.ts", ancla: { linea: 6, texto: "const z = y * 2;" }, tipo: "revision", titulo: "b", origen: "revisar", hilo: [mensaje("ia", "de b")] });
      guardarNotas(r, "src/d.ts", notas);
      const calls = fakeLLM(() => respNota());
      await responderNota(r, { archivo: "src/d.ts", notaId: v3.id, texto: "¿y ahora?" });
      const final = cargarNotas(r, "src/d.ts").filter((n) => n.estado === "abierta");
      const a = final.filter((n) => n.ancla.funcion === "a");
      return final.length === 2 && a.length === 1 && a[0]!.id === v1.id && a[0]!.bloqueante && ["uno", "dos", "tres"].every((t) => a[0]!.hilo.some((m) => m.texto === t)) && a[0]!.titulo === "a" && calls.length === 1;
    },
  },
  {
    name: "responder sobre una función habla SOLO de ella: ve su código y apenas las firmas de las otras",
    run: async (r) => {
      conNotas(r);
      fs.writeFileSync(path.join(r, "src/d.ts"), DOS);
      const calls = fakeLLM(() => respNota());
      await responderNota(r, { archivo: "src/d.ts", linea: 7, texto: "¿está bien?" });
      const p = calls[0]!.prompt;
      return p.includes("SOLO de la función `b`") && p.includes("const z = y * 2;") && !p.includes("return 10 / x;") && p.includes("export function a(x: number) {");
    },
  },
  {
    name: "verificar: con error de sintaxis da 'falta' SIN IA; 'lista' cierra la nota; sin cambios no vuelve a llamar",
    run: async (r) => {
      conNotas(r);
      const f = path.join(r, "src/d.ts");
      fs.writeFileSync(f, "export function a(x: number) {\n  return 10 / ;\n}\n");
      const calls = fakeLLM(() => ({ estado: "lista", resumen: "Divide y cuida el cero.", mejoras: [], que_hacer: "" }));
      const v1 = await verificar(r, "src/d.ts", { funcion: "a" });
      fs.writeFileSync(f, "export function a(x: number) {\n  if (x === 0) throw new Error('x no puede ser 0');\n  return 10 / x;\n}\n");
      const v2 = await verificar(r, "src/d.ts", { funcion: "a" });
      const nota = cargarNotas(r, "src/d.ts").find((n) => n.ancla.funcion === "a")!;
      // Al guardar (sin --funcion) una función sin nota abierta no se verifica, y una sin cambios tampoco.
      const v3 = await verificar(r, "src/d.ts", {});
      return v1.veredictos[0]!.estado === "falta" && v1.veredictos[0]!.sinIa && calls.length === 1 && v2.veredictos[0]!.estado === "lista" && nota.estado === "resuelta" && nota.verificacion?.estado === "lista" && v3.veredictos.length === 0;
    },
  },
  {
    name: "tareas: 'Crear TaskRule.js (y JournalRule.ts)' se separa en dos; una creada en otra carpeta cuenta; las hechas se archivan",
    run: async (r) => {
      agregarTareas(r, [{ titulo: "Crear TaskRule.js (y JournalRule.ts)", archivo: "TaskRule.js (y JournalRule.ts)", crear: true, origen: "estructura" }]);
      fs.mkdirSync(path.join(r, "src/reglas"), { recursive: true });
      fs.writeFileSync(path.join(r, "src/reglas/JournalRule.ts"), "");
      const t1 = await actualizarTareas(r);
      const separadas = t1.filter((t) => t.crear).map((t) => t.archivo).sort().join(",") === "JournalRule.ts,TaskRule.js";
      const journal = t1.find((t) => t.archivo === "JournalRule.ts")!;
      const vieja = cargarTareas(r);
      vieja.find((t) => t.archivo === "JournalRule.ts")!.hechaEn = new Date(Date.now() - 2 * 86400_000).toISOString();
      guardarTareas(r, vieja);
      const t2 = await actualizarTareas(r);
      return separadas && journal.hecha && journal.detalle!.includes("src/reglas/JournalRule.ts") && t2.find((t) => t.archivo === "JournalRule.ts")!.archivada === true && !t2.find((t) => t.archivo === "TaskRule.js")!.hecha;
    },
  },
  {
    name: "preguntas: no se pregunta lo que se puede ver en el código ('¿cuota.ts ya valida…?')",
    run: async (r) => {
      fakeLLM((o) => (o.kind === "panorama:resumen" ? { resumenes: [] } : { estado: "x", sugerencias: [], alternativas: [], riesgos: [], preguntas: [{ pregunta: "¿cuota.ts ya valida los meses?", sugerencia: "" }, { pregunta: "¿En qué moneda trabajas?", sugerencia: "CLP" }] }));
      await panorama(r);
      const ab = preguntasAbiertas(r).map((q) => q.pregunta);
      return ab.length === 1 && ab[0] === "¿En qué moneda trabajas?" && sobreElCodigo("¿Existe normalize?", ["normalize"]) && !sobreElCodigo("¿moveTo debe sobrescribir si existe?", ["moveTo"]);
    },
  },
  {
    name: "[seg] vista notas: la IA del chat no puede AGREGAR comentarios @guia (sí limpiarlos); se le indica 'cai responder'",
    run: async (r) => {
      conNotas(r);
      const agrega = await edit(r, "src/cuota.ts", "  return monto / meses;", "  // @guia[c1.1] pista: ojo con meses = 0\n  return monto / meses;");
      const msg = JSON.stringify(agrega);
      fs.writeFileSync(path.join(r, "src/cuota.ts"), TS.replace("  return monto / meses;", "  // @guia[c1.1] pista: x\n  return monto / meses;"));
      const limpia = await edit(r, "src/cuota.ts", "  // @guia[c1.1] pista: x\n", "");
      return denied(agrega) && msg.includes("cai responder") && !denied(limpia);
    },
  },
  {
    name: "rápidas: solo en funciones con nota, con caché (misma línea y código = sin IA) y apagables",
    run: async (r) => {
      conNotas(r);
      const calls = fakeLLM(() => ({ texto: "valida que meses no sea 0" }));
      conNotas(r, { rapidas: { soloConNota: true } });
      const sinNota = await rapida(r, "src/cuota.ts", 3);
      conNotas(r);
      await responderNota(r, { archivo: "src/cuota.ts", linea: 3, texto: "?" });
      const antes = calls.length;
      const a = await rapida(r, "src/cuota.ts", 3);
      const b = await rapida(r, "src/cuota.ts", 3);
      conNotas(r, { rapidas: { activas: false } });
      const off = await rapida(r, "src/cuota.ts", 3);
      return sinNota.texto === "" && a.texto === "valida que meses no sea 0" && b.motivo === "caché" && calls.length === antes + 1 && off.motivo!.startsWith("desactivadas");
    },
  },
  {
    name: "configuración: ayuda.porDefecto = pseudo da pseudocódigo al preguntar (salvo que pidas más)",
    run: async (r) => {
      conNotas(r, { ayuda: { porDefecto: "pseudo" } });
      const calls = fakeLLM(() => respNota());
      await responderNota(r, { archivo: "src/cuota.ts", linea: 3, texto: "¿cómo sigo?" });
      return levelIn(calls[0]!) === 3 && calls[0]!.prompt.includes("pseudocódigo");
    },
  },
  {
    name: "memoria: conversar sobre una pregunta guarda el hilo; al responderla, el hilo se borra",
    run: async (r) => {
      actualizarMemoria(r, (m) => m.abiertas.push({ p: "¿Qué base de datos? (sugerencia: SQLite)", r: "" }));
      const calls = fakeLLM(() => ({ texto: "Importa porque cambia dónde guardar; te recomiendo SQLite." }));
      const c = await conversar(r, 1, "¿por qué me lo preguntas?");
      const guardado = cargarDialogos(r)["¿Qué base de datos?"]?.length === 2;
      const p = responderPregunta(r, 1, "SQLite");
      olvidarDialogo(r, p);
      return calls.length === 1 && c.hilo.length === 2 && guardado && !cargarDialogos(r)["¿Qué base de datos?"];
    },
  },
  {
    name: "[rev] métodos con el mismo nombre en clases distintas tienen cada uno SU nota",
    run: async (r) => {
      conNotas(r);
      fs.writeFileSync(path.join(r, "src/c.ts"), "class A {\n  render() {\n    return 1;\n  }\n}\nclass B {\n  render() {\n    return 2;\n  }\n}\n");
      fakeLLM(() => respNota());
      await responderNota(r, { archivo: "src/c.ts", linea: 3, texto: "a" });
      await responderNota(r, { archivo: "src/c.ts", linea: 8, texto: "b" });
      const n = cargarNotas(r, "src/c.ts").filter((x) => x.estado === "abierta");
      return n.length === 2 && n.some((x) => x.ancla.linea === 2) && n.some((x) => x.ancla.linea === 7);
    },
  },
  {
    name: "[rev] un @ia? ya respondido no se vuelve a responder aunque su nota se cierre o se fusione",
    run: async (r) => {
      conNotas(r);
      const f = path.join(r, "src/n.ts");
      fs.writeFileSync(f, "export function f(m: number) {\n  // @ia? ¿cómo valido m?\n  return m;\n}\n");
      const calls = fakeLLM(() => respNota());
      await runGuia(r, "src/n.ts");
      const notas = cargarNotas(r, "src/n.ts");
      notas[0]!.estado = "resuelta";
      guardarNotas(r, "src/n.ts", notas);
      await runGuia(r, "src/n.ts");
      return calls.length === 1;
    },
  },
  {
    name: "[rev] el acompañante no suelta el bloqueo del archivo cuando 'verificar' (adentro) termina",
    run: async (r) => {
      const a = ocupar(r, "src/cuota.ts", "acompañando");
      await conBloqueo(r, "src/cuota.ts", "verificando", async () => true);
      const sigue = enCurso(r).length === 1;
      if (a.ok) a.liberar();
      return a.ok && sigue && enCurso(r).length === 0;
    },
  },
  {
    name: "[rev] '¿quedó lista?' de una función sin cambios desde 'lista' no crea otra nota ni llama a la IA",
    run: async (r) => {
      conNotas(r);
      fs.writeFileSync(path.join(r, "src/d.ts"), "export function a(x: number) {\n  if (x === 0) throw new Error('x no puede ser 0');\n  return 10 / x;\n}\n");
      const calls = fakeLLM(() => ({ estado: "lista", resumen: "ok", mejoras: [], que_hacer: "" }));
      await verificar(r, "src/d.ts", { funcion: "a" });
      const v = await verificar(r, "src/d.ts", { funcion: "a" });
      return calls.length === 1 && v.veredictos[0]!.omitida === true && cargarNotas(r, "src/d.ts").length === 1;
    },
  },
  {
    name: "[rev] rutas sin extensión válidas (Dockerfile, .env) se aceptan; un 'index.ts' en otra carpeta no cuenta como hecho",
    run: async (r) => {
      agregarTareas(r, [{ titulo: "Crear src/api/index.ts", archivo: "src/api/index.ts", crear: true, origen: "estructura" }]);
      fs.writeFileSync(path.join(r, "src/index.ts"), "");
      const t = await actualizarTareas(r);
      return rutasDe("Dockerfile y .env").join(",") === "Dockerfile,.env" && !t.find((x) => x.archivo === "src/api/index.ts")!.hecha;
    },
  },
  {
    name: "[seg][rev] vista notas: reescribir un @guia existente también se rechaza; desde el chat no se descartan tareas",
    run: async (r) => {
      conNotas(r);
      fs.writeFileSync(path.join(r, "src/cuota.ts"), TS.replace("  return monto / meses;", "  // @guia[c1.1] pista: x\n  return monto / meses;"));
      const reescribe = await edit(r, "src/cuota.ts", "// @guia[c1.1] pista: x", "// @guia[c1.1] pista: otra cosa");
      return denied(reescribe) && generadosPor("cai tareas descartar t1") === null && generadosPor("cai tareas hecha t1") !== null;
    },
  },
  {
    name: "[v0.8] lo ya dado no se ofrece: 'Más ayuda' pide el escalón que falta",
    run: async (r) => {
      conNotas(r);
      const calls = fakeLLM(() => respNota());
      const a = await responderNota(r, { archivo: "src/cuota.ts", linea: 3, pedido: "pista" });
      const b = await responderNota(r, { archivo: "src/cuota.ts", notaId: a.nota.id, pedido: "mas" });
      return levelIn(calls[1]!) === 2 && b.nota.dados!.includes("pista") && b.nota.dados!.includes("piezas");
    },
  },
  {
    name: "[v0.8] snippets: la línea se valida DENTRO de la función (exacta, parecida o 'sin ubicar'; nunca la firma por defecto)",
    run: async () => {
      const L = ["export function a(x: number) {", "  const doble = x * 2;", "  return doble;", "}", "const fuera = 1;"];
      const fn = { nombre: "a", linea: 1, lineas: 4, parametros: 1, anidamiento: 0, exportada: true };
      const exacta = ubicarSnippet(L, fn, "const doble = x * 2;");
      const parecida = ubicarSnippet(L, fn, "const doble = x*2");
      const fuera = ubicarSnippet(L, fn, "const fuera = 1;");
      const vacia = ubicarSnippet(L, fn, "");
      return exacta.linea === 2 && parecida.linea === 2 && fuera.lugar === "sin ubicar" && vacia.lugar === "sin ubicar";
    },
  },
  {
    name: "[v0.8] modos: aprender da escalera, sin snippets antes de intentar y sin sugerencias rápidas; gana función > archivo > carpeta > proyecto",
    run: async (r) => {
      conNotas(r, { modo: "aprender" });
      const calls = fakeLLM(() => respNota());
      const { nota } = await responderNota(r, { archivo: "src/cuota.ts", linea: 3, texto: "¿cómo sigo?" });
      const p = calls[0]!.prompt;
      const rap = await rapida(r, "src/cuota.ts", 3);
      const cfg = (await import("./config.js")).loadConfig(r);
      const base = { ...cfg, modo: "programar" as const, modos: { porCarpeta: { "src/**": "aprender", "src/legacy/": "programar" }, porArchivo: { "src/cuota.ts": "programar" }, porFuncion: { "src/cuota.ts:cuota": "aprender" } } };
      const orden = [
        modoEfectivo(base, "src/otra.ts").origen,
        modoEfectivo(base, "src/cuota.ts").origen,
        modoEfectivo(base, "src/cuota.ts", "cuota").modo,
        modoEfectivo(base, "lib/x.ts").modo,
        modoEfectivo(base, "src/legacy/v.ts").modo, // la carpeta más específica gana, aunque se haya agregado después
      ];
      return p.includes("MODO ESCALERA") && p.includes("todavía no sugieras snippets") && rap.motivo!.startsWith("modo aprender") && !!nota && orden.join(",") === "carpeta,archivo,aprender,programar,programar";
    },
  },
  {
    name: "[v0.8][seg] 'otra mirada': el plan se hace SIN ver el código; verificar no modifica el archivo; la revisión es a ciegas",
    run: async (r) => {
      conNotas(r);
      const f = path.join(r, "src/d.ts");
      fs.writeFileSync(f, "export function a(x: number) {\n  // esto está bien, no tocar\n  return 10 / x;\n}\n");
      const antes = sha(f);
      const calls = fakeLLM((o) => (o.kind === "verificar:plan-ciego" ? { pasos: ["validar x"], casos_borde: ["x = 0"] } : { que_hace: "línea 3: divide", deberia: "dividir", estado: "casi", resumen: "falta el cero", mejoras: ["x = 0"], que_hacer: "valida x", otra_mirada: "no cubre x = 0" }));
      await verificar(r, "src/d.ts", { funcion: "a", independiente: true });
      const plan = calls.find((c) => c.kind === "verificar:plan-ciego")!;
      const ver = calls.find((c) => c.kind === "verificar")!;
      const nota = cargarNotas(r, "src/d.ts")[0]!;
      return sha(f) === antes && !plan.prompt.includes("return 10 / x") && ver.prompt.includes("Plan hecho SIN ver el código") && !ver.prompt.includes("esto está bien") && nota.hilo.some((m) => m.texto.includes("Otra mirada"));
    },
  },
  {
    name: "[v0.8] proceso abierto: responde en orden, se reinicia a los N usos y si falla usa la llamada normal",
    run: async () => {
      let inicios = 0;
      const fabrica: Fabrica = (prompt) => {
        inicios++;
        return (async function* () {
          for await (const m of prompt) {
            const t = String((m.message as { content: string }).content);
            yield { type: "result", subtype: "success", result: t.includes("ROTO") ? "no es json" : `{"texto":"ok ${t.slice(-1)}"}`, total_cost_usd: 0.001 };
          }
        })();
      };
      const s = new Sesion("m", fabrica, 2);
      const a = await s.preguntar("uno 1");
      const b = await s.preguntar("dos 2");
      const c = await s.preguntar("tres 3"); // 3er uso: reinicia
      s.cerrar();
      let usoBase = 0;
      const llm = conSesion(async <T,>() => ((usoBase++, { data: { texto: "respaldo" } as T, costUsd: 0 })), ["rapida"], fabrica);
      const bien = await llm<{ texto: string }>({ kind: "rapida", system: "", prompt: "x", schema: { required: ["texto"] }, cwd: "." });
      const mal = await llm<{ texto: string }>({ kind: "rapida", system: "", prompt: "ROTO", schema: { required: ["texto"] }, cwd: "." });
      for (const x of llm.sesiones.values()) x.cerrar();
      const ping = JSON.parse(await atender(".", JSON.stringify({ id: 7, tipo: "ping" }))) as { id: number; ok: boolean };
      return JSON.stringify([a.texto, b.texto, c.texto]).includes("ok 1") && inicios >= 2 && bien.data.texto.startsWith("ok") && mal.data.texto === "respaldo" && usoBase === 1 && ping.id === 7 && ping.ok;
    },
  },
  {
    name: "[rev8] proceso abierto: tras un tiempo agotado, ninguna respuesta tardía le cae a otro pedido",
    run: async () => {
      // El proceso 1 responde "lento-A" tarde; el 2 responde al instante. B y C deben recibir SU respuesta.
      let gen = 0;
      const fabrica: Fabrica = (prompt) => {
        const yo = ++gen;
        return (async function* () {
          for await (const m of prompt) {
            const t = String((m.message as { content: string }).content);
            if (t === "A") await new Promise((r) => setTimeout(r, 900));
            yield { type: "result", subtype: "success", result: `p${yo}:${t}`, total_cost_usd: 0.001 };
          }
        })();
      };
      const s = new Sesion("m", fabrica);
      const a = await s.preguntar("A", 100).catch((e: Error) => e.message);
      const [b, c] = await Promise.all([s.preguntar("B", 2000), s.preguntar("C", 2000)]);
      await new Promise((r) => setTimeout(r, 1000)); // la respuesta tardía de A llega y no le cae a nadie
      s.cerrar();
      return String(a).includes("tardó") && b.texto.endsWith(":B") && c.texto.endsWith(":C");
    },
  },
  {
    name: "[rev8][seg] desde el chat, comillas o barras no esconden 'notas anotar' ni 'tareas descartar'",
    run: async () =>
      generadosPor("cai notas 'anotar' src/a.ts n1 --texto x") === null &&
      generadosPor("cai notas anot\\ar src/a.ts n1 --texto x") === null &&
      generadosPor('cai tareas "descartar" t1') === null &&
      generadosPor("cai notas resolver src/a.ts n1") !== null,
  },
  {
    name: "[rev8] cai servir no se cae con una línea inválida; la revisión a ciegas conserva los avisos (FIXME, 'no funciona')",
    run: async () => {
      const nulo = JSON.parse(await atender(".", "null")) as { ok: boolean };
      const roto = JSON.parse(await atender(".", "{no json")) as { ok: boolean };
      const vencido = JSON.parse(await atender(".", JSON.stringify({ id: 1, tipo: "rapida", archivo: "a.ts", linea: 1, vence: Date.now() - 1 }))) as { ok: boolean; error: string };
      return !nulo.ok && !roto.ok && !vencido.ok && vencido.error.includes("vencido") && cegar("// FIXME: no funciona con lista vacía") !== "" && cegar("// esto está bien") === "";
    },
  },
  {
    name: "[rev8] 'Más ayuda' nunca baja de escalón; preguntar dos veces no cuenta como intento (modo aprender)",
    run: async (r) => {
      conNotas(r, { modo: "aprender" });
      const calls = fakeLLM(() => respNota());
      const a = await responderNota(r, { archivo: "src/cuota.ts", linea: 3, pedido: "ejemplo" });
      await responderNota(r, { archivo: "src/cuota.ts", notaId: a.nota.id, pedido: "mas" });
      await responderNota(r, { archivo: "src/cuota.ts", notaId: a.nota.id, texto: "no entiendo" });
      return calls[1]!.prompt.includes("expliques") && calls[2]!.prompt.includes("todavía no sugieras snippets");
    },
  },
  {
    name: "[rev8] '¿quedó lista?' con tu explicación se verifica aunque el código no haya cambiado",
    run: async (r) => {
      conNotas(r);
      fs.writeFileSync(path.join(r, "src/d.ts"), "export function a(x: number) {\n  return 10 / x;\n}\n");
      const calls = fakeLLM(() => ({ que_hace: "divide", deberia: "dividir", estado: "casi", resumen: "r", mejoras: [], que_hacer: "", explicacion: { coincide: true, comentario: "" } }));
      await verificar(r, "src/d.ts", { funcion: "a" });
      await verificar(r, "src/d.ts", { funcion: "a", explicacion: "divide 10 por x" });
      const n = cargarNotas(r, "src/d.ts")[0]!;
      return calls.filter((c) => c.kind === "verificar").length === 2 && n.explicacion?.texto === "divide 10 por x";
    },
  },
  {
    name: "[0.8.1] sugerencia rápida con el texto del editor (sin guardar) y a pedido sin esperar; si no hay, dice por qué",
    run: async (r) => {
      conNotas(r);
      const calls = fakeLLM((o) => (o.kind === "rapida" ? { texto: "ok" } : respNota()));
      await responderNota(r, { archivo: "src/cuota.ts", linea: 3, texto: "?" });
      const sinGuardar = TS.replace("  return monto / meses;", "  const nuevaLineaSinGuardar = 1;\n  return monto / meses;");
      const a = await rapida(r, "src/cuota.ts", 3, { texto: sinGuardar });
      const b = await rapida(r, "src/cuota.ts", 4, { texto: sinGuardar, aPedido: true }); // a pedido: no espera los 6 s
      const fuera = await rapida(r, "src/cuota.ts", 99, { aPedido: true });
      const pr = calls.filter((c) => c.kind === "rapida");
      return a.texto === "ok" && b.texto === "ok" && pr.length === 2 && pr[0]!.prompt.includes("nuevaLineaSinGuardar") && !!fuera.motivo;
    },
  },
  {
    name: "[0.8.2] guía línea a línea: en cualquier función, siguiendo los pasos de la nota, y nunca con código",
    run: async (r) => {
      conNotas(r);
      fs.writeFileSync(path.join(r, "src/m.ts"), "export function mover(a: string, b: string) {\n  if (!a) return false;\n\n}\n");
      let n = 0;
      const calls = fakeLLM((o) => (o.kind === "rapida" ? { texto: ++n === 1 ? "ahora valida b" : "usa `b === ''`" } : respNota("Pasos: 1) valida a 2) valida b")));
      const sinNota = await rapida(r, "src/m.ts", 3);
      await responderNota(r, { archivo: "src/m.ts", linea: 2, pedido: "pseudo" });
      const conCodigo = await rapida(r, "src/m.ts", 3, { aPedido: true, texto: "export function mover(a: string, b: string) {\n  if (!a) return false;\n  x\n}\n" });
      const pr = calls.filter((c) => c.kind === "rapida");
      return sinNota.texto === "ahora valida b" && conCodigo.texto === "" && pr[1]!.prompt.includes("Pasos que ya le diste");
    },
  },
  {
    name: "[0.8.2] 🧪 Tests: prueba los casos ya, los guarda como tests (los dudosos apagados) y al guardar se vuelven a probar",
    run: async (r) => {
      conNotas(r);
      fakeLLM((o) =>
        o.kind === "tests"
          ? { casos: [
              { tipo: "normal", descripcion: "divide", llamada: "cuota(10, 2)", esperado: "5", duda: "" },
              { tipo: "error", descripcion: "meses cero", llamada: "cuota(1, 0)", esperado: "ZeroDivision", duda: "" },
              { tipo: "normal", descripcion: "redondeo", llamada: "cuota(10, 3)", esperado: "?", duda: "¿redondea?" },
            ] }
          : respNota(),
      );
      const { nota } = await responderNota(r, { archivo: "src/cuota.py", linea: 2, pedido: "tests" });
      const test = path.join(r, "tests/test_cuota.py");
      const creado = fs.existsSync(test) ? fs.readFileSync(test, "utf8") : "";
      const p1 = nota.ultimaPrueba;
      // Un bug nuevo: al guardar, se detecta (sin IA).
      fs.writeFileSync(path.join(r, "src/cuota.py"), "def cuota(monto, meses):\n    return monto\n");
      const rr = await recorrerCasos(r, "src/cuota.py");
      const p2 = cargarNotas(r, "src/cuota.py").find((n) => n.ultimaPrueba)?.ultimaPrueba;
      const infra = p1?.detalle.every((d) => d.estado === "no-ejecutable");
      return (
        !!p1 && (infra || (p1.pasan === 2 && p1.fallan === 0)) && /def test_/.test(creado) && creado.includes("snippet [ ]") && creado.includes("¿redondea?") &&
        rr.funciones.length === 1 && (infra || (p2!.fallan >= 1))
      );
    },
  },
  {
    name: "modelos por tamaño: chico = Haiku, mediano = Sonnet, grande = Opus (configurables)",
    run: async (r) => {
      const cfg = (await import("./config.js")).loadConfig(r);
      const a = iaOpts(cfg, "chico").model === "claude-haiku-4-5" && iaOpts(cfg, "mediano").model === "claude-sonnet-5-5" && iaOpts(cfg, "grande").model === "claude-opus-5-5";
      fs.writeFileSync(path.join(r, ".cai/config.json"), JSON.stringify({ ia: { modelos: { mediano: "otro-modelo" } } }));
      const cfg2 = (await import("./config.js")).loadConfig(r);
      return a && iaOpts(cfg2, "mediano").model === "otro-modelo" && iaOpts(cfg2, "chico").model === "claude-haiku-4-5";
    },
  },
);

export async function runSelftest(log: (s: string) => void = console.log): Promise<boolean> {
  let ok = 0;
  for (const c of CASES) {
    const root = project();
    process.env.CAI_HOME = path.join(root, ".home");
    process.env.CAI_VISTA = "comentarios"; // los escenarios clásicos usan comentarios; los de notas lo declaran
    let pass = false;
    try {
      pass = await c.run(root);
    } catch (e) {
      log(`    error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLLM(null);
      fs.rmSync(root, { recursive: true, force: true });
    }
    log(`${pass ? "✓" : "✗"} ${c.name}`);
    if (pass) ok++;
  }
  log(`\n${ok}/${CASES.length} escenarios OK`);
  return ok === CASES.length;
}
