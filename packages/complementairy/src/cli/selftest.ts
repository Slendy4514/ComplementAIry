import crypto from "node:crypto";
import { cargarNotas, guardarNotas, mensaje, nuevaNota } from "../proyecto/notas.js";
import { responderNota } from "../flujos/guia/responder.js";
import { conBloqueo, enCurso, ocupar } from "../proyecto/ocupado.js";
import { actualizarTareas, agregarTareas, cargarTareas, guardarDiagnosticos, guardarTareas, rutasDe, siguiente } from "../proyecto/siguiente.js";
import { planoArchivo } from "../flujos/plano.js";
import { separarListas } from "../nucleo/render.js";
import { iaOpts } from "../ia/llm.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cleanText, conversation } from "../nucleo/guia.js";
import { runHook, type HookOutput } from "../garantias/hook.js";
import { leerUso, setLLM, type AskOptions } from "../ia/llm.js";
import { loadPerfil } from "../proyecto/profile.js";
import { runGuia } from "../flujos/guia/tutor.js";
import { crearSnippet } from "../proyecto/snippets.js";
import { reglasDiags } from "../garantias/gate.js";
import { runReview } from "../flujos/review.js";
import { coincide, ejecutar, validarExpresion } from "../flujos/predict.js";
import { analizarScript, validarExpresionAislada } from "../flujos/sandbox.js";
import { riesgos } from "../flujos/terminal.js";
import { nuevoAdr } from "../flujos/arquitectura.js";
import { checkBash } from "../garantias/bash.js";
import { findThreads } from "../nucleo/threads.js";
import { parse } from "../nucleo/comments.js";
import { splitQuestions } from "../flujos/guia/tutor.js";
import { insertBelow, renderReply } from "../nucleo/render.js";
import { aplicarExpansion, pedidoDe, planExpansion } from "../flujos/biblioteca.js";
import { acompanar } from "../flujos/guia/acompanante.js";
import { init } from "./init.js";
import { actualizarMemoria, agregarPreguntas, leerMemoria, panorama, preguntasAbiertas, responderPregunta } from "../flujos/panorama.js";
import { planoProyecto } from "../flujos/plano.js";
import { cegar, verificar } from "../flujos/verificar.js";
import { actualizarIndice } from "../proyecto/indice.js";
import { contextoComun } from "../proyecto/contexto.js";
import { cargarDecisiones, decidir, proponerDecisiones, retractar } from "../proyecto/decisiones.js";
import { actualizarConImpacto } from "../flujos/impacto.js";
import { cargarChat, conversar as conversarProyecto } from "../flujos/chat.js";
import { corregir } from "../proyecto/correcciones.js";
import { aplicarPropuesta, crearConversacion, cargarConversacion, listarConversaciones } from "../flujos/chat.js";
import { confirmarObjetivos, leerObjetivos, objetivosHonestos } from "../proyecto/entender.js";
import { contextoIdeas, descartarIdea, registrarIdeas } from "../flujos/ideas.js";
import { definirContrato, editarPlan, pasoDirigido, planFuncion, probarPorcion, propuestaPR, registrarInsercion, validarContrato } from "../flujos/programar.js";
import { buscarEnRepertorio, cargarRepertorio } from "../proyecto/repertorio.js";
import { entenderFuncion, marcarObjetivo } from "../flujos/objetivoFuncion.js";

import { leerVeredictos, revisarCompleto } from "../flujos/revisionCompleta.js";
import { corta } from "../flujos/guia/rapida.js";
import { hoy, resumenSesion } from "../flujos/resumenSesion.js";
import { generarCasos, recorrerCasos } from "../flujos/tests.js";
import { ubicarSnippet } from "../flujos/guia/responder.js";
import { modoEfectivo } from "../proyecto/modos.js";
import { conSesion, Sesion, type Fabrica } from "../ia/sesion.js";
import { atender } from "./servir.js";
import { rapida } from "../flujos/guia/rapida.js";
import { cargarDialogos, conversar, olvidarDialogo } from "../flujos/dialogo.js";
import { sobreElCodigo } from "../nucleo/memoria.js";
import { generadosPor, soloHumano } from "../garantias/snapshot.js";
import { conocer, sugerirAutoria } from "../flujos/conocer.js";
import { execFileSync } from "node:child_process";
import { guardReplies } from "../nucleo/guard.js";
import { verifyCommentOnly } from "../nucleo/soloComentarios.js";
import { langFor } from "../nucleo/lang.js";
import { DatosDanados, leerJson } from "../proyecto/almacen.js";
import { conCandadoSync } from "../proyecto/ocupado.js";
import { sinSoluciones } from "../nucleo/guard.js";
import { esPorHacer, mapaArchivo, leerIndice as leerIndiceInt } from "../proyecto/indice.js";
import { contextoComun as contextoComunInt } from "../proyecto/contexto.js";
import { auditar as auditarC, casosConstruir, conExpresiones, deshacer, deshacerPedido, editarCaso, ideaPaso, ofrecer, ofrecerTodo, ordenar, ordenarPasos, ordenValida, partesDeFuncion, pedidoValido, pedir, predecirConstruir, registrarAuxiliares, resolverAgregado as resolverAgregadoC, stubsAuxiliares, trampas } from "../flujos/construir.js";
import { modoDe, MODOS as MODOS2, modoEfectivo as modoEfectivoC, migrarModos as migrarModosC } from "../nucleo/compartido.js";
import { leerPropuesta as leerPropuestaC, registrarInsercion as registrarInsercionC } from "../flujos/programar.js";
import { cargarDecisiones as cargarDecisionesC } from "../proyecto/decisiones.js";

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

export interface Case {
  name: string;
  run: (root: string) => Promise<boolean>;
}

/** Falla con un mensaje que dice qué se esperaba (en vez de un ✗ sin explicación). */
const esperar = (cond: unknown, msg: string): true => {
  if (!cond) throw new Error(msg);
  return true;
};

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
      const calls = fakeLLM((o) => said(`respuesta a: ${/Responde SOLO esta parte \(\d\/\d\): (.*)|Responde al último/.exec(o.prompt)?.[1] ?? "redondeo"}`));
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
      return antes === 0 && revs.length === 1 && revs[0]!.prompt.split("Partes que acaba de terminar")[1]!.includes("function dos") && !revs[0]!.prompt.split("Partes que acaba de terminar")[1]!.includes("function uno") && res.acciones.some((a) => a.tipo === "comentario") && /@guia\[c\d+\.1\] revision: suggestion: El nombre x/.test(out);
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
      // Desde v0.10 se rechaza antes de correr; si igual corriera (otra forma de invocarlo), se revierte.
      const pre = await bash(r, "cai memoria responder 1 CLP", "m1");
      if (JSON.stringify(pre).includes("deny")) return fs.readFileSync(path.join(r, ".cai/conocimiento.md"), "utf8") === antes;
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
// v1 apaga las sugerencias rápidas por defecto (II.3); los escenarios de esa función las activan.
const conNotas = (r: string, extra: { rapidas?: object } & Record<string, unknown> = {}) => fs.writeFileSync(path.join(r, ".cai/config.json"), JSON.stringify({ vista: "notas", ...extra, rapidas: { activas: true, ...extra.rapidas } }));
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
    name: "responder sobre una función: ve su código y, de las otras, el mapa del archivo (para decir 'usa X'), no sus cuerpos",
    run: async (r) => {
      conNotas(r);
      fs.writeFileSync(path.join(r, "src/d.ts"), DOS);
      const calls = fakeLLM(() => respNota());
      await responderNota(r, { archivo: "src/d.ts", linea: 7, texto: "¿está bien?" });
      const p = calls[0]!.prompt;
      return (
        esperar(p.includes("nota es SOLO de la función `b`"), "falta la instrucción de que la nota es de b") &&
        esperar(p.includes("const z = y * 2;"), "falta el código de b") &&
        esperar(!p.includes("return 10 / x;"), "se coló el cuerpo de otra función") &&
        esperar(p.includes("MAPA DEL ARCHIVO") && p.includes("export function a(x: number)"), "falta el mapa del archivo con la firma de a")
      );
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
      const cfg = (await import("../proyecto/config.js")).loadConfig(r);
      const base = { ...cfg, modo: "sugerir" as const, modos: { porCarpeta: { "src/**": "aprender", "src/legacy/": "sugerir" }, porArchivo: { "src/cuota.ts": "sugerir" }, porFuncion: { "src/cuota.ts:cuota": "aprender" } } };
      const orden = [
        modoEfectivo(base, "src/otra.ts").origen,
        modoEfectivo(base, "src/cuota.ts").origen,
        modoEfectivo(base, "src/cuota.ts", "cuota").modo,
        modoEfectivo(base, "lib/x.ts").modo,
        modoEfectivo(base, "src/legacy/v.ts").modo, // la carpeta más específica gana, aunque se haya agregado después
      ];
      return p.includes("MODO ESCALERA") && p.includes("todavía no sugieras snippets") && rap.motivo!.startsWith("modo aprender") && !!nota && orden.join(",") === "carpeta,archivo,aprender,sugerir,sugerir";
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
    name: "[0.9] tests sin export: el archivo se carga aislado (sin tocarlo), lo del entorno con dobles (datos), y los tests creados funcionan",
    run: async (r) => {
      conNotas(r);
      const f = path.join(r, "src/ui.js");
      fs.writeFileSync(f, 'function titulo(id) {\n  const el = document.getElementById(id);\n  if (!el) return "(sin título)";\n  return el.textContent.trim().toUpperCase();\n}\nclass Contador { sumar(x) { if (typeof x !== "number") throw new Error("x debe ser número"); return x; } }\n');
      const antes = sha(f);
      fakeLLM((o) =>
        o.kind === "tests"
          ? { casos: [
              { tipo: "normal", descripcion: "mayúsculas", llamada: 'titulo("t")', esperado: '"HOLA"', duda: "", dobles: [{ ruta: "document.getElementById(…)", valor: '{"textContent":" hola "}' }] },
              { tipo: "normal", descripcion: "sin elemento", llamada: 'titulo("x")', esperado: '"(sin título)"', duda: "", dobles: [{ ruta: "window.document.getElementById(...)", valor: "null" }] },
              { tipo: "error", descripcion: "no número", llamada: 'new Contador().sumar("a")', esperado: "x debe ser número", duda: "", dobles: [] },
              { tipo: "normal", descripcion: "inventa", llamada: "noExiste(1)", esperado: "1", duda: "", dobles: [] },
            ] }
          : respNota(),
      );
      const { nota } = await responderNota(r, { archivo: "src/ui.js", linea: 2, pedido: "tests" });
      const u = nota.ultimaPrueba!;
      const test = path.join(r, "tests/ui.test.js");
      const creado = fs.existsSync(test) ? fs.readFileSync(test, "utf8") : "";
      // El ayudante creado funciona por sí solo (sin vitest): carga el archivo aislado con dobles.
      const { ejecutarAislado } = (await import(path.join(r, "tests/_cai/aislado.mjs"))) as { ejecutarAislado: (a: string, e: object, x: string, d: object) => Promise<unknown> };
      const v = await ejecutarAislado(f, { declaraciones: ["titulo", "Contador"], globales: ["document"] }, 'titulo("t")', { "document.getElementById(…)": { textContent: " hola " } });
      // Pedí tests de `titulo`: los casos de otra función (Contador) o inventados (noExiste) se descartan.
      return sha(f) === antes && u.pasan === 2 && u.fallan === 0 && u.detalle.length === 2 && creado.includes("ejecutarAislado") && !creado.includes("noExiste") && !creado.includes("Contador()") && v === "HOLA";
    },
  },
  {
    name: "[0.9] índice: cruza quién llama a quién, guarda estado/tests, y el contexto común lo usa (estructura, panorama, decisiones, vecinas)",
    run: async (r) => {
      conNotas(r);
      fs.writeFileSync(path.join(r, "src/a.ts"), "export function normalizar(x: string) {\n  return x.trim();\n}\nexport function existe(p: string) {\n  const n = normalizar(p);\n  return n.length > 0;\n}\n");
      fs.writeFileSync(path.join(r, ".cai/estructura.json"), JSON.stringify({ resumen: "Capas simples.", modulos: [{ archivo: "src/a.ts", responsabilidad: "rutas", funciones: [] }], orden: [] }));
      fs.mkdirSync(path.join(r, ".cai/cache"), { recursive: true });
      fs.writeFileSync(path.join(r, ".cai/cache/panorama.json"), JSON.stringify({ resumenes: {}, sugerencias: { estado: "Va bien.", sugerencias: [{ titulo: "Validar rutas", porque: "entradas vacías", archivos: ["src/a.ts"] }] } }));
      const [d] = proponerDecisiones(r, [{ pregunta: "¿Una ruta vacía es error o false?", opciones: [{ opcion: "error", consecuencia: "lanza" }, { opcion: "false", consecuencia: "devuelve false" }], recomendada: "false" }], { archivo: "src/a.ts" }, "test");
      decidir(r, d!.id, "false");
      const idx = await actualizarIndice(r);
      const norm = idx.archivos["src/a.ts"]!.funciones.find((f) => f.nombre === "normalizar")!;
      const ctx = contextoComun(r, "src/a.ts", { funcion: "existe" });
      const corto = contextoComun(r, "src/a.ts", { funcion: "existe", corto: true });
      // Repetir sin cambios: la huella no cambia (no se rehace).
      const h1 = norm.huella;
      const idx2 = await actualizarIndice(r, ["src/a.ts"]);
      return (
        norm.llamadaPor.includes("src/a.ts:existe") && ctx.includes("Capas simples.") && ctx.includes("Validar rutas") && ctx.includes("→ false") && ctx.includes("normalizar(x: string)") &&
        corto.includes("normalizar") && !corto.includes("Capas simples.") && idx2.archivos["src/a.ts"]!.funciones[0]!.huella === h1
      );
    },
  },
  {
    name: "[0.9] impacto: si cambia una función que otra usa, la nota de la otra avisa (sin IA)",
    run: async (r) => {
      conNotas(r);
      const f = path.join(r, "src/a.ts");
      fs.writeFileSync(f, "export function normalizar(x: string) {\n  return x.trim();\n}\nexport function existe(p: string) {\n  const n = normalizar(p);\n  return n.length > 0;\n}\n");
      fakeLLM(() => respNota());
      await responderNota(r, { archivo: "src/a.ts", linea: 6, texto: "?" }); // existe tiene nota
      await actualizarIndice(r);
      fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("return x.trim();", "return x.trim().toLowerCase();"));
      const imp = await actualizarConImpacto(r, "src/a.ts");
      const n = cargarNotas(r, "src/a.ts").find((x) => x.ancla.funcion === "existe")!;
      return imp.length === 1 && imp[0]!.funcion === "normalizar" && n.impacto?.[0]?.funcion === "normalizar";
    },
  },
  {
    name: "[0.9] impacto: si la función que la usa no tenía nota, se crea una con el aviso",
    run: async (r) => {
      conNotas(r);
      fs.writeFileSync(path.join(r, "src/a.ts"), "export function normalizar(x: string) {\n  return x.trim();\n}\n");
      fs.writeFileSync(path.join(r, "src/b.ts"), "import { normalizar } from './a';\nexport function existe(p: string) {\n  return normalizar(p).length > 0;\n}\n");
      await actualizarIndice(r);
      const f = path.join(r, "src/a.ts");
      fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("return x.trim();", "return x.trim().toLowerCase();"));
      await actualizarConImpacto(r, "src/a.ts");
      const n = cargarNotas(r, "src/b.ts").find((x) => x.ancla.funcion === "existe");
      return !!n && n.estado === "abierta" && n.impacto?.[0]?.funcion === "normalizar" && n.hilo.length === 1;
    },
  },
  {
    name: "[0.9][seg] decisiones: decidir las pone en contexto y no se repiten; retractar las saca (historial); desde el chat no se decide",
    run: async (r) => {
      const [d] = proponerDecisiones(r, [{ pregunta: "¿Monto negativo es error?", opciones: [{ opcion: "sí", consecuencia: "a" }, { opcion: "no", consecuencia: "b" }], recomendada: "" }], {}, "t");
      decidir(r, d!.id, "sí");
      const repetida = proponerDecisiones(r, [{ pregunta: "¿El monto negativo es un error?", opciones: [{ opcion: "sí", consecuencia: "a" }, { opcion: "no", consecuencia: "b" }], recomendada: "" }], {}, "t");
      const en = contextoComun(r, "src/cuota.ts").includes("Monto negativo es error? → sí");
      retractar(r, d!.id);
      const fuera = !contextoComun(r, "src/cuota.ts").includes("→ sí");
      const hist = cargarDecisiones(r)[0]!;
      return en && repetida.length === 0 && fuera && hist.estado === "retractada" && hist.anterior?.[0]?.eleccion === "sí" && generadosPor(`cai decisiones decidir ${d!.id} no`) === null && generadosPor("cai decisiones 'retractar' x") === null;
    },
  },
  {
    name: "[0.9] chat del proyecto: puede leer (no 'sin herramientas'), recibe el índice y deja decisiones y tareas; no escribe código",
    run: async (r) => {
      conNotas(r);
      await actualizarIndice(r);
      const antes = sha(path.join(r, "src/cuota.ts"));
      const calls = fakeLLM(() => ({ texto: "Sigue con validar.", decisiones: [{ pregunta: "¿Moneda con decimales?", opciones: [{ opcion: "sí", consecuencia: "" }, { opcion: "no", consecuencia: "" }], recomendada: "no" }], cambiosTareas: [{ accion: "crear", id: "", titulo: "Validar meses", archivo: "src/cuota.ts", detalle: "" }], correcciones: [] }));
      const res = await conversarProyecto(r, "¿por dónde sigo?");
      const c = calls[0]!;
      return !c.sinHerramientas && c.prompt.includes("cuota(monto: number") && res.decisiones.length === 1 && res.respuesta.cambiosTareas?.length === 1 && cargarChat(r).length === 2 && sha(path.join(r, "src/cuota.ts")) === antes;
    },
  },
  {
    name: "[0.9] revisar --completo: '¿quedó lista?' de cada función + veredicto del archivo (reutiliza lo que no cambió)",
    run: async (r) => {
      conNotas(r, { tests: { avisarSinTests: false } });
      fs.writeFileSync(path.join(r, "src/d.ts"), DOS);
      const calls = fakeLLM((o) =>
        o.kind === "verificar:plan-ciego" ? { pasos: ["p"], casos_borde: ["c"] } : o.kind === "verificar" ? { que_hace: "x", deberia: "y", estado: "lista", resumen: "ok", mejoras: [], que_hacer: "", decisiones: [], otra_mirada: "" } : o.kind === "revisar:consolidar" ? { mantener: [] } : { hallazgos: [] },
      );
      const r1 = await revisarCompleto(r, "src/d.ts");
      const n1 = calls.filter((c) => c.kind === "verificar").length;
      const r2 = await revisarCompleto(r, "src/d.ts");
      const n2 = calls.filter((c) => c.kind === "verificar").length;
      return r1.veredicto.estado === "lista" && r1.veredicto.total === 2 && n1 === 2 && n2 === 2 && r2.veredicto.listas === 2 && leerVeredictos(r)["src/d.ts"]?.estado === "lista";
    },
  },
  {
    name: "[rev9][seg] expresiones de prueba: solo literales (lista blanca); no se sale del aislamiento ni desde la caché de casos",
    run: async (r) => {
      conNotas(r);
      const f = path.join(r, "src/s.js");
      fs.writeFileSync(f, "function suma(a, b) { return a + b; }\nclass C { m(x) { return x; } }\n");
      const D = new Set(["suma", "C"]);
      const malas = [
        'suma(1, console.log.constructor("return process")().pid)',
        "suma(1), process.exit(), suma(2)",
        'suma(this.constructor.constructor("return process")())',
        "suma(1, `${process.pid}`)",
        'suma([1].map(x => x), 2)',
        "suma(1 + 2, 3)",
        'new C(").m(1)").m(process)',
      ];
      const buenas = ['suma(1, -2.5e3)', 'new C().m([1, {a: "x)"}], null)', "C.m('a\\'b')", "suma()"];
      const okAisl = malas.every((e) => validarExpresionAislada(e, D) !== null) && buenas.every((e) => validarExpresionAislada(e, D) === null);
      const okNormal = validarExpresion('suma(1, console.log.constructor("return 1")())', new Set(["suma"])) !== null && validarExpresion("f(1, x=2)", new Set(["f"]), "python") === null && validarExpresion("f(1, x=2)", new Set(["f"])) !== null;
      // Un caso malicioso escrito directo en la caché: al volver a probar (al guardar) se rechaza sin ejecutarse.
      const marca = path.join(r, "pwned.txt");
      fs.mkdirSync(path.join(r, ".cai/cache/casos"), { recursive: true });
      fs.writeFileSync(path.join(r, ".cai/cache/casos", `${encodeURIComponent("src/s.js")}#suma.json`), JSON.stringify([{ tipo: "normal", descripcion: "x", llamada: `suma(1, console.log.constructor("return process")().mainModule)`, esperado: "1", duda: "" }, { tipo: "normal", descripcion: "y", llamada: "suma(1, 2)", esperado: "3", duda: "" }]));
      const rc = await recorrerCasos(r, "src/s.js");
      const det = rc.funciones[0]?.detalle ?? [];
      return okAisl && okNormal && !fs.existsSync(marca) && det[0]?.estado === "no-ejecutable" && /rechazada/.test(det[0]?.obtenido ?? "") && det[1]?.estado === "pasa";
    },
  },
  {
    name: "[rev9][seg] el valor esperado que no es un literal no llega al archivo de tests (queda para que decidas)",
    run: async (r) => {
      conNotas(r);
      fs.writeFileSync(path.join(r, "src/t.ts"), "export function doble(x: number) {\n  return x * 2;\n}\n");
      fakeLLM((o) =>
        o.kind === "tests"
          ? { casos: [
              { tipo: "normal", descripcion: "inyecta", llamada: "doble(1)", esperado: '"a"); (await import("node:child_process")).execSync("touch pwned"); ("b"', duda: "" },
              { tipo: "normal", descripcion: "normal", llamada: "doble(2)", esperado: "4", duda: "" },
            ] }
          : respNota(),
      );
      const g = await generarCasos(r, "src/t.ts", "doble");
      return g.casos[0]?.esperado === "?" && g.casos[1]?.esperado === "4" && g.descartados.some((d) => /no es un literal/.test(d));
    },
  },
  {
    name: "[rev9][seg] decisiones.json desde un comando de la IA: solo agregar pendientes (decidir o cambiar una existente se revierte)",
    run: async () => {
      const b = (ds: object[]) => Buffer.from(JSON.stringify({ version: 1, decisiones: ds }));
      const p1 = { id: "d1", pregunta: "¿a o b?", opciones: [], alcance: {}, estado: "pendiente", creada: "x", origen: "t" };
      const nueva = { ...p1, id: "d2" };
      const tests = generadosPor("cai tests src/a.ts f")!;
      const indice = generadosPor("cai indice actualizar")!;
      return (
        tests(".cai/decisiones.json", b([p1]), b([p1, nueva])) &&
        tests(".cai/decisiones.json", null, b([nueva])) &&
        !tests(".cai/decisiones.json", b([p1]), b([{ ...p1, estado: "vigente", eleccion: "a" }])) &&
        !tests(".cai/decisiones.json", b([p1]), b([p1, { ...nueva, estado: "vigente", eleccion: "a" }])) &&
        !tests(".cai/decisiones.json", b([p1]), b([])) &&
        !indice(".cai/decisiones.json", b([p1]), b([p1, nueva])) && !indice(".cai/tareas.json", null, null) && indice(".cai/indice.json", null, null)
      );
    },
  },
  {
    name: "[rev9] aislado: setTimeout, URL y CommonJS existen (no son 'errores' del código) y la consola no es la de Node",
    run: async (r) => {
      conNotas(r);
      fs.writeFileSync(path.join(r, "src/c.js"), "const util = require('./util');\nfunction espera() { return typeof setTimeout + ' ' + new URL('http://a/b?c=1').searchParams.get('c'); }\nfunction consola() { return console.log === globalThis.console.log && console.log.constructor('return typeof process')(); }\nmodule.exports = { espera };\n");
      const lang = langFor("src/c.js")!;
      const a = await analizarScript(fs.readFileSync(path.join(r, "src/c.js"), "utf8"), lang);
      const e1 = ejecutar(r, "src/c.js", "javascript", { expresion: "espera()", funcion: "espera" }, { aislado: a });
      const e2 = ejecutar(r, "src/c.js", "javascript", { expresion: "consola()", funcion: "consola" }, { aislado: a });
      return !a.globales.includes("setTimeout") && !a.globales.includes("module") && e1.ok && e1.valor === "function 1" && e2.ok && e2.valor === "undefined";
    },
  },
  {
    name: "[rev9] índice: una llamada a una función que aparece DESPUÉS en otro archivo se cruza igual",
    run: async (r) => {
      conNotas(r);
      fs.writeFileSync(path.join(r, "src/a.ts"), "export function usa(x: string) {\n  return ayuda(x);\n}\n");
      await actualizarIndice(r);
      fs.writeFileSync(path.join(r, "src/b.ts"), "export function ayuda(x: string) {\n  return x;\n}\n");
      const idx = await actualizarIndice(r, ["src/b.ts"]);
      // Dos actualizaciones a la vez (como dos guardados juntos) no se pisan.
      fs.writeFileSync(path.join(r, "src/c.ts"), "export function c1() {\n  return 1;\n}\n");
      fs.writeFileSync(path.join(r, "src/d.ts"), "export function d1() {\n  return 1;\n}\n");
      const [, i2] = await Promise.all([actualizarIndice(r, ["src/c.ts"]), actualizarIndice(r, ["src/d.ts"])]);
      return idx.archivos["src/a.ts"]!.funciones[0]!.llama.includes("ayuda") && idx.archivos["src/b.ts"]!.funciones[0]!.llamadaPor.includes("src/a.ts:usa") && !!i2.archivos["src/c.ts"] && !!i2.archivos["src/d.ts"];
    },
  },
  {
    name: "[rev9] revisar --completo: una función que no se pudo verificar no deja el archivo 🟢; el chat ve las decisiones de cada archivo",
    run: async (r) => {
      conNotas(r, { tests: { avisarSinTests: false } });
      fs.writeFileSync(path.join(r, "src/d.ts"), DOS);
      let n = 0;
      fakeLLM((o) => {
        if (o.kind === "verificar" && ++n === 2) throw new Error("se cayó la IA");
        return o.kind === "verificar:plan-ciego" ? { pasos: ["p"], casos_borde: ["c"] } : o.kind === "verificar" ? { que_hace: "x", deberia: "y", estado: "lista", resumen: "ok", mejoras: [], que_hacer: "", decisiones: [], otra_mirada: "" } : o.kind === "revisar:consolidar" ? { mantener: [] } : { hallazgos: [] };
      });
      const v = (await revisarCompleto(r, "src/d.ts")).veredicto;
      const [d] = proponerDecisiones(r, [{ pregunta: "¿Vacío es error?", opciones: [{ opcion: "sí", consecuencia: "" }, { opcion: "no", consecuencia: "" }] }], { archivo: "src/d.ts" }, "test");
      decidir(r, d!.id, "sí");
      return v.estado !== "lista" && v.total === 2 && v.listas === 1 && v.funciones.some((f) => f.estado === "sin verificar") && contextoComun(r, "").includes("¿Vacío es error? → sí (en src/d.ts)");
    },
  },
  {
    name: "[0.10] modos: una configuración vieja con 'programar' se lee como 'sugerir' (nadie pasa al nuevo modo sin elegirlo)",
    run: async (r) => {
      fs.writeFileSync(path.join(r, ".cai/config.json"), JSON.stringify({ modo: "programar", modos: { porArchivo: { "src/a.ts": "programar", "src/b.ts": "aprender" } } }));
      const { loadConfig } = await import("../proyecto/config.js");
      const c1 = loadConfig(r);
      const viejo = c1.modo === "sugerir" && modoEfectivo(c1, "src/a.ts").modo === "sugerir" && modoEfectivo(c1, "src/b.ts").modo === "aprender";
      fs.writeFileSync(path.join(r, ".cai/config.json"), JSON.stringify({ modosVersion: 2, modo: "programar" }));
      const c2 = loadConfig(r);
      return viejo && c2.modo === "programar" && modoEfectivo(c2, "x.ts").c.proponerSolucion && !modoEfectivo(c1, "x.ts").c.proponerSolucion;
    },
  },
  {
    name: "[0.10] la guía no adelanta lo ya escrito: si lo que sugiere está en otra línea, pide lo que falta (y si insiste, nada)",
    run: async (r) => {
      conNotas(r);
      fs.writeFileSync(path.join(r, "src/g.ts"), "export function g(a: number) {\n  const b = a * 2;\n\n  return b;\n}\n");
      let n = 0;
      const calls = fakeLLM((o) => (o.kind === "rapida" ? (++n === 1 ? { texto: "devuelve b", yaEscrito: 4 } : { texto: "valida que a sea número", yaEscrito: 0 }) : respNota()));
      const a = await rapida(r, "src/g.ts", 3, { aPedido: true });
      n = 0;
      fakeLLM((o) => (o.kind === "rapida" ? { texto: "devuelve b", yaEscrito: 4 } : respNota()));
      fs.writeFileSync(path.join(r, "src/g.ts"), "export function g(a: number) {\n  const b = a * 3;\n\n  return b;\n}\n");
      const b = await rapida(r, "src/g.ts", 3, { aPedido: true });
      return a.texto === "valida que a sea número" && calls[0]!.prompt.includes("(ya escrito)") && b.texto === "";
    },
  },
  {
    name: "[0.10] cada comentario en su nota: lo de OTRA función no se anota en esta (ni en la suya); lo general, a la del archivo",
    run: async (r) => {
      conNotas(r, { tests: { avisarSinTests: false } });
      fs.writeFileSync(path.join(r, "src/d.ts"), DOS);
      fakeLLM((o) =>
        o.kind === "verificar:plan-ciego" ? { pasos: ["p"], casos_borde: ["c"] } : { que_hace: "x", deberia: "y", estado: "casi", resumen: "ok", mejoras: [{ texto: "valida x = 0", funcion: "" }, { texto: "b no valida y", funcion: "b" }, { texto: "falta un README", funcion: "archivo" }], que_hacer: "", decisiones: [], otra_mirada: "" },
      );
      await verificar(r, "src/d.ts", { funcion: "a" });
      const notas = cargarNotas(r, "src/d.ts");
      const de = (k: string) => notas.filter((n) => n.ancla.funcion === k).flatMap((n) => n.hilo.map((m) => m.texto)).join("\n");
      const arch = notas.filter((n) => n.alcance === "archivo").flatMap((n) => n.hilo.map((m) => m.texto)).join("\n");
      return (
        esperar(de("a").includes("valida x = 0") && !de("a").includes("b no valida"), `la nota de a: ${de("a")}`) &&
        esperar(!de("b").includes("b no valida y"), `lo de b se anotó en su nota desde la revisión de a: ${de("b")}`) &&
        esperar(!arch.includes("b no valida") && arch.includes("falta un README"), `la nota del archivo: ${arch}`)
      );
    },
  },
  {
    name: "[0.10] correcciones: lo que corriges del proyecto manda y el panorama no lo pisa; toda la IA lo recibe",
    run: async (r) => {
      conNotas(r);
      fs.mkdirSync(path.join(r, ".cai/cache"), { recursive: true });
      fs.writeFileSync(path.join(r, ".cai/cache/panorama.json"), JSON.stringify({ resumenes: { "src/cuota.ts": { hash: "x", resumen: "Una API REST de préstamos." } } }));
      fs.writeFileSync(path.join(r, ".cai/estructura.json"), JSON.stringify({ resumen: "R", modulos: [{ archivo: "src/cuota.ts", responsabilidad: "servidor", funciones: [] }], orden: [] }));
      corregir(r, { tipo: "modulo", archivo: "src/cuota.ts", despues: "Calcula la cuota de un préstamo (CLI, no API).", origen: "t" });
      corregir(r, { tipo: "estructura", archivo: "src/cuota.ts", despues: "cálculo puro, sin red", origen: "t" });
      actualizarMemoria(r, () => {});
      const mem = fs.readFileSync(path.join(r, ".cai/conocimiento.md"), "utf8");
      const est = JSON.parse(fs.readFileSync(path.join(r, ".cai/estructura.json"), "utf8")) as { modulos: { responsabilidad: string }[] };
      const ctx = contextoComun(r, "src/cuota.ts");
      return mem.includes("CLI, no API") && !mem.includes("API REST") && est.modulos[0]!.responsabilidad === "cálculo puro, sin red" && ctx.includes("MANDAN") && ctx.includes("CLI, no API");
    },
  },
  {
    name: "[0.10][seg] chat: varias conversaciones, eliges la IA, y las tareas/correcciones que propone se aplican SOLO con tu clic",
    run: async (r) => {
      conNotas(r);
      agregarTareas(r, [{ titulo: "Validar meses", origen: "manual" }]);
      const calls = fakeLLM(() => ({ texto: "Ok.", decisiones: [], cambiosTareas: [{ accion: "hecha", id: "t1", titulo: "Validar meses", archivo: "", detalle: "" }, { accion: "crear", id: "", titulo: "Agregar tabla", archivo: "src/cuota.ts", detalle: "" }], correcciones: [{ tipo: "proyecto", archivo: "", antes: "API", despues: "Es una CLI." }] }));
      const c1 = await crearConversacion(r, { modelo: "chico" });
      const res = await conversarProyecto(r, "ya terminé de validar; voy a hacer la tabla", { conversacion: c1.id });
      const sinAplicar = cargarTareas(r).length === 1 && !cargarTareas(r)[0]!.hecha;
      await aplicarPropuesta(r, c1.id, res.mensaje, "tarea", 0);
      await aplicarPropuesta(r, c1.id, res.mensaje, "tarea", 1);
      await aplicarPropuesta(r, c1.id, res.mensaje, "correccion", 0);
      const otra = await crearConversacion(r);
      const lista = listarConversaciones(r);
      const marcado = cargarConversacion(r, c1.id).mensajes.find((x) => x.id === res.mensaje)!.cambiosTareas!.every((x) => !!x.aplicado);
      const usoChico = calls[0]!.model === "claude-haiku-5-5";
      return sinAplicar && cargarTareas(r).find((t) => t.id === "t1")!.hecha && cargarTareas(r).some((t) => t.titulo === "Agregar tabla") && contextoComun(r, "").includes("Es una CLI.") && marcado && lista.length === 2 && !!otra && usoChico && generadosPor(`cai chat --aplicar ${c1.id} 1 tarea 0`) === null;
    },
  },
  {
    name: "[0.10][seg] entender el proyecto: borrador → 'creo que entendí' → TÚ confirmas; la IA no puede confirmar ni tocar lo confirmado",
    run: async (r) => {
      conNotas(r);
      fakeLLM(() => ({ texto: "Creo que ya entendí: …", preguntas: [], borrador: { resumen: "Calcular cuotas de préstamos para una cooperativa.", objetivos: ["cuota fija"], usuarios: "socios", criterios: ["cuota correcta al centavo", "tabla de amortización"], restricciones: [], fueraDeAlcance: ["pagos online"], dudas: [] }, creoQueEntendi: true }));
      const r1 = await conversarProyecto(r, "es para la cooperativa", { tipo: "entender" });
      const borrador = leerObjetivos(r);
      const bufA = fs.readFileSync(path.join(r, ".cai/objetivos.json"));
      confirmarObjetivos(r);
      const bufB = fs.readFileSync(path.join(r, ".cai/objetivos.json"));
      // Un comando de la IA no puede confirmar (de borrador a confirmado) ni tocar lo confirmado.
      const honesto = objetivosHonestos(null, bufA) && !objetivosHonestos(bufA, bufB) && !objetivosHonestos(bufB, Buffer.from(bufB.toString().replace("socios", "todos")));
      const ctx = contextoComun(r, "src/cuota.ts");
      return r1.respuesta.creeEntendido === true && borrador.estado === "entendiendo" && leerObjetivos(r).estado === "entendido" && honesto && ctx.includes("confirmados por el programador") && ctx.includes("no lo propongas") && generadosPor("cai entender confirmar") === null;
    },
  },
  {
    name: "[0.10][seg] Claude Code: lo que solo decides tú se registra con TU respuesta (si ya trae respuestas, se rechaza; si el texto no coincide, no se registra)",
    run: async (r) => {
      conNotas(r);
      const [d] = proponerDecisiones(r, [{ pregunta: "¿Un monto negativo lanza error?", opciones: [{ opcion: "Lanzar error", consecuencia: "" }, { opcion: "Devolver 0", consecuencia: "" }] }], {}, "t");
      const q = { question: "¿Un monto negativo lanza error?", header: `cai:${d!.id}`, options: [{ label: "Lanzar error (Recomendado)" }, { label: "Devolver 0" }] };
      const pre = await runHook({ hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_input: { questions: [q], answers: { [q.question]: "Devolver 0" } } }, r);
      const preOk = await runHook({ hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_input: { questions: [q] } }, r);
      // Texto engañoso (no incluye la decisión): no se registra.
      const engano = { ...q, question: "¿Seguimos?" };
      await runHook({ hook_event_name: "PostToolUse", tool_name: "AskUserQuestion", tool_input: { questions: [engano] }, tool_response: { questions: [engano], answers: { "¿Seguimos?": "Devolver 0" } } }, r);
      const sigue = cargarDecisiones(r)[0]!.estado === "pendiente";
      const post = await runHook({ hook_event_name: "PostToolUse", tool_name: "AskUserQuestion", tool_input: { questions: [q] }, tool_response: { questions: [q], answers: { [q.question]: "Lanzar error (Recomendado)" } } }, r);
      const dd = cargarDecisiones(r)[0]!;
      const ok = dd.estado === "vigente" && dd.eleccion === "Lanzar error";
      // Retractar con su encabezado (opciones exactas).
      const qr = { question: "¿Retracto '¿Un monto negativo lanza error?'?", header: `cai:-${d!.id}`, options: [{ label: "Retractar" }, { label: "Mantener" }] };
      await runHook({ hook_event_name: "PostToolUse", tool_name: "AskUserQuestion", tool_input: { questions: [qr] }, tool_response: { answers: { [qr.question]: "Retractar" } } }, r);
      const init0 = fs.readFileSync(path.join(r, ".cai/config.json"), "utf8");
      return JSON.stringify(pre).includes("deny") && preOk === null && sigue && ok && JSON.stringify(post).includes("decidiste") && cargarDecisiones(r)[0]!.estado === "retractada" && !!init0;
    },
  },
  {
    name: "[0.10] ideas: salen del panorama, las descartadas no vuelven, 'aprender' solo si lo activas",
    run: async (r) => {
      conNotas(r);
      const a = registrarIdeas(r, [{ tipo: "funcionalidad", titulo: "Exportar a CSV", porque: "x", archivos: [] }, { tipo: "aprender", titulo: "Aprende redondeo bancario", porque: "y", archivos: [] }]);
      descartarIdea(r, a[0]!.id);
      const b = registrarIdeas(r, [{ tipo: "funcionalidad", titulo: "exportar a csv", porque: "x", archivos: [] }, { tipo: "mejora", titulo: "Tests de bordes", porque: "z", archivos: [] }]);
      conNotas(r, { ideas: { aprender: true } });
      const c = registrarIdeas(r, [{ tipo: "aprender", titulo: "Aprende redondeo bancario", porque: "y", archivos: [] }]);
      return a.length === 1 && b.length === 1 && b[0]!.titulo === "Tests de bordes" && c.length === 1 && contextoIdeas(r).includes("DESCARTÓ") && generadosPor("cai ideas descartar i1") === null;
    },
  },
  {
    name: "[0.10] programar (PR): tus casos (con borde), propuesta probada contra ellos, y el probador exige que TU entrada recorra la porción",
    run: async (r) => {
      conNotas(r);
      fs.writeFileSync(path.join(r, "src/p.js"), "function cuota(m, n) {\n  return 0;\n}\n");
      const sinBorde = validarContrato([{ llamada: "cuota(100, 2)", esperado: "50" }, { llamada: "cuota(90, 3)", esperado: "30" }], "cuota", "javascript");
      await definirContrato(r, "src/p.js", "cuota", [{ llamada: "cuota(100, 2)", esperado: "50" }, { llamada: "cuota(100, 0)", esperado: "error: meses" }]);
      const codigo = "function cuota(m, n) {\n  if (n <= 0) {\n    throw new Error('meses inválido: ' + n);\n  }\n  return m / n;\n}";
      fakeLLM((o) => (o.kind === "programar:pr" ? { codigo, porciones: [{ desde: 2, hasta: 4, paso: 1, porque: "valida" }, { desde: 5, hasta: 5, paso: 2, porque: "divide" }], cambios: [] } : { texto: "explicación" }));
      const antes = sha(path.join(r, "src/p.js"));
      const p = await propuestaPR(r, "src/p.js", "cuota");
      const contratoOk = p.contrato!.every((c) => c.pasa);
      // Porción 1 (la validación, una rama): una entrada que no entra en el if no sirve.
      const noToca = await probarPorcion(r, "src/p.js", "cuota", 0, "cuota(100, 2)", "50");
      const toca = await probarPorcion(r, "src/p.js", "cuota", 0, "cuota(100, -1)", "error");
      let bloqueado = false;
      try {
        await registrarInsercion(r, "src/p.js", "cuota");
      } catch {
        bloqueado = true; // falta probar la porción 2
      }
      const mal = await probarPorcion(r, "src/p.js", "cuota", 1, "cuota(9, 3)", "4");
      const bien = await probarPorcion(r, "src/p.js", "cuota", 1, "cuota(9, 3)", "3");
      const reg = await registrarInsercion(r, "src/p.js", "cuota");
      return (
        !!sinBorde && contratoOk && !noToca.prueba.toca && noToca.porcion.aprobada === false && toca.prueba.toca && toca.prueba.acierto && bloqueado &&
        mal.prueba.toca && !mal.prueba.acierto && mal.prueba.explicacion === "explicación" && bien.prueba.acierto && reg.porciones === 2 && reg.sinProbar === 0 &&
        sha(path.join(r, "src/p.js")) === antes && !fs.readdirSync(path.join(r, "src")).some((f) => f.startsWith(".cai-propuesta")) &&
        generadosPor("cai programar probar src/p.js --funcion cuota --porcion 1 --entrada x --espero y") === null && generadosPor("cai programar contrato src/p.js --funcion cuota") === null
      );
    },
  },
  {
    name: "[0.10] programar: plan de 3-5 pasos (más → auxiliar como tarea aparte), tú diriges un paso, y el repertorio guarda solo lo tuyo 🟢",
    run: async (r) => {
      conNotas(r, { autoria: { heredado: ["src/viejo/**"], terceros: [] } });
      fs.writeFileSync(path.join(r, "src/p.js"), "function cuota(m, n) {\n  return 0;\n}\n");
      fakeLLM((o) =>
        o.kind === "programar:plan"
          ? { pasos: [{ texto: "validar", repertorio: "" }, { texto: "usar validarEntradas", repertorio: "" }, { texto: "dividir", repertorio: "" }], separar: { nombre: "validarEntradas", proposito: "chequea m y n" } }
          : o.kind === "programar:paso"
            ? { codigo: "  if (n <= 0) throw new Error('n');", despues_de: "function cuota(m, n) {", falta: "no dice qué hacer si m es negativo", explicacion: "lanza si n no es positivo" }
            : o.kind === "verificar:plan-ciego" ? { pasos: ["p"], casos_borde: ["c"] } : { que_hace: "x", deberia: "y", estado: "lista", resumen: "divide m en n cuotas", mejoras: [], que_hacer: "", decisiones: [], otra_mirada: "" },
      );
      const pl = await planFuncion(r, "src/p.js", "cuota");
      let seis = "";
      try {
        await editarPlan(r, "src/p.js", "cuota", ["a", "b", "c", "d", "e", "f"]);
      } catch (e) {
        seis = String(e);
      }
      const paso = await pasoDirigido(r, "src/p.js", "cuota", 1, "si n no es positivo, lanza error");
      await verificar(r, "src/p.js", { funcion: "cuota" });
      fs.mkdirSync(path.join(r, "src/viejo"), { recursive: true });
      fs.writeFileSync(path.join(r, "src/viejo/h.js"), "function heredada(x) {\n  return x;\n}\n");
      await verificar(r, "src/viejo/h.js", { funcion: "heredada" });
      const rep = cargarRepertorio();
      return pl.plan.pasos.length === 3 && pl.tarea === "validarEntradas" && cargarTareas(r).some((t) => t.titulo.includes("validarEntradas")) && seis.includes("dos funciones") === false && seis.includes("Separa") && paso.falta!.includes("negativo") && paso.linea === 1 && rep.length === 1 && rep[0]!.nombre === "cuota" && buscarEnRepertorio(r, "cuota en cuotas").length === 1;
    },
  },
  {
    name: "[0.10] objetivo de una función: la IA arma criterios, tú confirmas, y '¿quedó lista?' propone darla por terminada (tu clic)",
    run: async (r) => {
      conNotas(r, { tests: { avisarSinTests: false } });
      fs.writeFileSync(path.join(r, "src/d.ts"), DOS);
      const calls = fakeLLM((o) =>
        o.kind === "entender" ? { objetivo: "Divide 10 por x.", criterios: ["con x = 0 lanza error"], preguntas: [], creoQueEntendi: true } : o.kind === "verificar:plan-ciego" ? { pasos: ["p"], casos_borde: ["c"] } : { que_hace: "x", deberia: "y", estado: "lista", resumen: "ok", mejoras: [], que_hacer: "", decisiones: [], otra_mirada: "" },
      );
      const e = await entenderFuncion(r, "src/d.ts", "a", "que no divida por cero");
      await marcarObjetivo(r, "src/d.ts", "a", "confirmar");
      await verificar(r, "src/d.ts", { funcion: "a" });
      const vp = calls.find((c) => c.kind === "verificar")!.prompt;
      const n = cargarNotas(r, "src/d.ts").find((x) => x.ancla.funcion === "a")!;
      await marcarObjetivo(r, "src/d.ts", "a", "terminado");
      const n2 = cargarNotas(r, "src/d.ts").find((x) => x.ancla.funcion === "a")!;
      return e.creoQueEntendi && vp.includes("Objetivo CONFIRMADO") && n.hilo.some((m) => m.texto.includes("Creo que cumple su objetivo")) && !!n2.objetivo?.terminada && generadosPor("cai entender terminado --funcion src/d.ts:a") === null;
    },
  },
  {
    name: "[rev10][seg] lo que solo hace el humano se rechaza ANTES de correr, y la IA no puede aprobar porciones del probador (ni por otra vía)",
    run: async (r) => {
      conNotas(r);
      const pre = (command: string) => runHook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, tool_use_id: "x" }, r);
      const bloqueados = await Promise.all(["cai programar probar src/a.js --funcion f --porcion 1 --entrada 'f(1)' --espero 1", "cai 'decisiones' decidir d1 a", "node dist/cli.js chat --aplicar c1 m1 tarea 0", "cai repertorio borrar x", "cai entender confirmar", "cai memoria corregir --proyecto --texto x"].map(pre));
      const libre = await pre("cai programar pr src/a.js --funcion f");
      const prop = (aprobada: boolean) => Buffer.from(JSON.stringify({ porciones: [{ aprobada, pruebas: aprobada ? [{}] : [] }] }));
      const g = generadosPor("cai programar pr src/a.js --funcion f")!;
      return bloqueados.every((b) => JSON.stringify(b).includes("deny")) && !JSON.stringify(libre).includes("deny") && g(".cai/cache/propuestas/x.json", null, prop(false)) && !g(".cai/cache/propuestas/x.json", prop(false), prop(true)) && generadosPor("cai programar probar a --funcion f") === null;
    },
  },
  {
    name: "[rev10][seg] AskUserQuestion: sin multiSelect, opciones exactas, texto completo; un 'Sí' ambiguo no registra nada",
    run: async (r) => {
      conNotas(r);
      const [d] = proponerDecisiones(r, [{ pregunta: "¿Redondeo por fila?", opciones: [{ opcion: "Sí", consecuencia: "" }, { opcion: "No", consecuencia: "" }] }], {}, "t");
      decidir(r, d!.id, "Sí");
      const pre = (q: object) => runHook({ hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_input: { questions: [q] } }, r);
      const multi = await pre({ question: "¿Retracto «¿Redondeo por fila?»?", header: `cai:-${d!.id}`, multiSelect: true, options: [{ label: "Retractar" }, { label: "Mantener" }] });
      const ambiguas = await pre({ question: "¿Mantienes «¿Redondeo por fila?»?", header: `cai:-${d!.id}`, options: [{ label: "Sí" }, { label: "No" }] });
      const fin = await pre({ question: "¿Seguimos?", header: "cai:fin", options: [{ label: "Dar por terminado" }, { label: "Seguir" }] });
      // Aunque llegara al PostToolUse (sin el Pre), un "Sí" no retracta.
      const q = { question: "¿Mantienes «¿Redondeo por fila?»?", header: `cai:-${d!.id}`, options: [{ label: "Sí" }, { label: "No" }] };
      await runHook({ hook_event_name: "PostToolUse", tool_name: "AskUserQuestion", tool_input: { questions: [q] }, tool_response: { answers: { [q.question]: "Sí" } } }, r);
      return [multi, ambiguas, fin].every((x) => JSON.stringify(x).includes("deny")) && cargarDecisiones(r).find((x) => x.id === d!.id)!.estado === "vigente";
    },
  },
  {
    name: "[rev10] probador: las marcas no cambian el código (sin ';', if sin llaves) y un error con OTRO mensaje no es acierto",
    run: async (r) => {
      conNotas(r);
      fs.writeFileSync(path.join(r, "src/m.js"), "function f(x) {\n  return 0\n}\n");
      const js = 'function f(x) {\n  const y = x\n  if (y < 0) throw new Error("neg: " + y)\n  else if (y === 0) return "cero"\n  return y * 2\n}';
      fakeLLM((o) => (o.kind === "programar:pr" ? { codigo: js, porciones: [{ desde: 2, hasta: 4, paso: 1, porque: "v" }, { desde: 5, hasta: 5, paso: 2, porque: "d" }], cambios: [] } : { texto: "x" }));
      await definirContrato(r, "src/m.js", "f", [{ llamada: "f(2)", esperado: "4" }, { llamada: "f(-1)", esperado: "error: neg" }]);
      const p = await propuestaPR(r, "src/m.js", "f");
      const otro = await probarPorcion(r, "src/m.js", "f", 0, "f(-3)", "error: otra cosa");
      const bien = await probarPorcion(r, "src/m.js", "f", 0, "f(-3)", "error: neg");
      return p.contrato!.every((c) => c.pasa) && otro.prueba.toca && !otro.prueba.acierto && bien.prueba.acierto && !fs.readdirSync(path.join(r, "src")).some((f) => /cai_propuesta|__pycache__/.test(f));
    },
  },
  {
    name: "[rev10] Claude Code puede definir el objetivo de una función (cai entender --funcion), pero no confirmarlo",
    run: async (r) => {
      const n = (confirmado?: string) => Buffer.from(JSON.stringify({ notas: [{ id: "n1", objetivo: { texto: "x", criterios: [], ...(confirmado ? { confirmado } : {}) } }] }));
      const g = generadosPor('cai entender --funcion src/a.ts:f --texto "que no divida por cero"')!;
      return g(".cai/notas/src__a.ts.json", n(), n()) && !g(".cai/notas/src__a.ts.json", n(), n("2026-10-10")) && generadosPor("cai entender confirmar --funcion src/a.ts:f") === null;
    },
  },
  {
    name: "[0.9] la guía no se corta a mitad de palabra; 'hoy' detecta lo que cambió y 'sesión' mide lo hecho",
    run: async (r) => {
      const larga = "valida que el destino no esté vacío y que la carpeta de destino exista antes de mover el archivo a su nuevo lugar";
      const c = corta(larga);
      fs.writeFileSync(path.join(r, "src/a.ts"), "export function a(x: number) {\n  return x;\n}\n");
      await actualizarIndice(r);
      hoy(r, true);
      fs.writeFileSync(path.join(r, "src/a.ts"), "export function a(x: number) {\n  return x * 2;\n}\n");
      await actualizarIndice(r);
      const h = hoy(r, false);
      const s = await resumenSesion(r, new Date(Date.now() - 3600_000).toISOString(), true);
      return c.endsWith("…") && c.length <= 91 && !/\s…$/.test(c) && larga.startsWith(c.slice(0, -1)) && h.cambiadas.includes("src/a.ts:a") && s.medido.includes("Desde");
    },
  },
  {
    name: "modelos por tamaño: chico = Haiku, mediano = Sonnet, grande = Opus (configurables)",
    run: async (r) => {
      const cfg = (await import("../proyecto/config.js")).loadConfig(r);
      const a = iaOpts(cfg, "chico").model === "claude-haiku-5-5" && iaOpts(cfg, "mediano").model === "claude-sonnet-5-5" && iaOpts(cfg, "grande").model === "claude-opus-5-5";
      fs.writeFileSync(path.join(r, ".cai/config.json"), JSON.stringify({ ia: { modelos: { mediano: "otro-modelo" } } }));
      const cfg2 = (await import("../proyecto/config.js")).loadConfig(r);
      return a && iaOpts(cfg2, "mediano").model === "otro-modelo" && iaOpts(cfg2, "chico").model === "claude-haiku-5-5";
    },
  },
);

// --- v0.11: seguridad y datos -------------------------------------------------------------------
CASES.push(
  {
    name: "[rev11] un decisiones.json dañado no se trata como vacío: no se pisa, queda una copia y el error explica qué hacer",
    run: async (r) => {
      const f = path.join(r, ".cai", "decisiones.json");
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, '{"decisiones": [ {"id": "d1", ');
      let error: unknown;
      try {
        proponerDecisiones(r, [{ pregunta: "¿Lanzar error con negativos?", opciones: [{ texto: "sí" }, { texto: "no" }] as never }], {}, "test");
      } catch (e) {
        error = e;
      }
      const copias = fs.readdirSync(path.dirname(f)).filter((x) => x.startsWith("decisiones.json.danado-"));
      return (
        esperar(error instanceof DatosDanados, `se esperaba DatosDanados, llegó: ${String(error)}`) &&
        esperar(/copia/.test((error as Error).message) && /bórralo/.test((error as Error).message), `el mensaje no explica qué hacer: ${(error as Error).message}`) &&
        esperar(fs.readFileSync(f, "utf8") === '{"decisiones": [ {"id": "d1", ', "el archivo dañado fue sobrescrito") &&
        esperar(copias.length === 1, `se esperaba 1 copia, hay ${copias.length}`) &&
        esperar(leerJson(path.join(r, ".cai", "no-existe.json"), () => 7) === 7, "un archivo que no existe debería dar el valor por defecto")
      );
    },
  },
  {
    name: "[rev11] un candado de un proceso muerto se descarta enseguida; uno de un proceso vivo hace esperar y avisa",
    run: async (r) => {
      const ruta = path.join(r, ".cai", "tareas.json");
      fs.mkdirSync(path.dirname(ruta), { recursive: true });
      // Un pid que no existe (el máximo típico de Linux es 4194304).
      fs.writeFileSync(`${ruta}.lock`, "4194999");
      const t0 = Date.now();
      agregarTareas(r, [{ titulo: "Crear a.ts", origen: "manual" }]);
      const rapido = Date.now() - t0 < 1000;
      // Un proceso vivo que no es este (el padre) tiene el candado: hay que esperar y avisar.
      fs.writeFileSync(`${ruta}.lock`, String(process.ppid));
      let aviso = "";
      try {
        conCandadoSync(ruta, () => 1, 200);
      } catch (e) {
        aviso = (e as Error).message;
      }
      fs.rmSync(`${ruta}.lock`, { force: true });
      // Reentrante: dentro de un candado propio se puede volver a tomar sin esperarse a sí mismo.
      const anidado = conCandadoSync(ruta, () => conCandadoSync(ruta, () => "ok", 200), 200);
      return (
        esperar(rapido && cargarTareas(r).length === 1, "el candado de un proceso muerto no se descartó") &&
        esperar(/otro proceso/.test(aviso) && /borra/.test(aviso), `se esperaba un aviso explicativo, llegó: "${aviso}"`) &&
        esperar(anidado === "ok" && !fs.existsSync(`${ruta}.lock`), "el candado no es reentrante o quedó tomado")
      );
    },
  },
  {
    name: "[rev11] fuera del modo programar se quita el código escrito de los textos libres (bloques y soluciones en línea), no las piezas",
    run: async () => {
      const t = "Valida antes con `Number.isInteger(meses)`.\n```js\nif (meses <= 0) { throw new Error('x'); }\n```\nO así: `if (!x) { return 0; }`. Simplifica a `return !!this.vault.get(p)`.";
      const limpio = sinSoluciones(t);
      const conComando = sinSoluciones("Corre:\n```bash\npnpm test\n```", { permitir: ["bash"] });
      return (
        esperar(limpio.includes("`Number.isInteger(meses)`"), "se quitó una pieza suelta") &&
        esperar(!limpio.includes("throw new Error") && !limpio.includes("return 0") && !limpio.includes("return !!"), `quedó código: ${limpio}`) &&
        esperar(conComando.includes("pnpm test"), "se quitó un comando de terminal permitido")
      );
    },
  },
  {
    name: "[rev11] cai servir avisa que empezó la llamada a la IA solo cuando de verdad la empieza",
    run: async (r) => {
      const empezados: unknown[] = [];
      await atender(r, JSON.stringify({ id: 1, tipo: "ping" }), (id) => empezados.push(id));
      await atender(r, JSON.stringify({ id: 2, tipo: "rapida", archivo: "src/cuota.ts", linea: 1, vence: Date.now() - 1 }), (id) => empezados.push(id));
      return esperar(empezados.length === 0, `avisó "empezado" sin llamar a la IA: ${JSON.stringify(empezados)}`);
    },
  },
);

/** Los escenarios cuyo nombre contiene `filtro` (sin distinguir mayúsculas), o todos. */
// --- v0.11: las funciones se conocen entre sí ----------------------------------------------------
const FILES_JS = "export class Files {\n  exists(rawPath) {\n    const p = this.normalize(rawPath);\n    return !!this.app.vault.getAbstractFileByPath(p);\n  }\n\n  normalize(path) {}\n}\n";
CASES.push(
  {
    name: "[int] una función vacía sale ⬜ en el mapa del archivo, con el propósito que le dio el plano; las previstas que no existen también",
    run: async (r) => {
      fs.writeFileSync(path.join(r, "src/files.js"), FILES_JS);
      agregarTareas(r, [
        { titulo: "Crear normalize en src/files.js: quita las barras sobrantes", archivo: "src/files.js", funcion: "normalize", detalle: "quita las barras sobrantes y los espacios", origen: "plano" },
        { titulo: "Crear ensureFolder en src/files.js: crea la carpeta si falta", archivo: "src/files.js", funcion: "ensureFolder", origen: "plano" },
      ]);
      await actualizarIndice(r);
      const mapa = mapaArchivo(r, leerIndiceInt(r), "src/files.js", "exists");
      return (
        esperar(esPorHacer("normalize(path) {}", "javascript") && esPorHacer("def f(x):\n    pass\n", "python") && esPorHacer("function f() {\n  // TODO\n}", "javascript"), "no detecta funciones vacías") &&
        esperar(!esPorHacer("const f = (x) => x * 2", "javascript") && !esPorHacer("function f() { return 1; }", "javascript"), "marcó como vacía una función con cuerpo") &&
        esperar(/⬜ por hacer normalize\(path\).*quita las barras sobrantes y los espacios/.test(mapa), `normalize no sale ⬜ con su propósito:\n${mapa}`) &&
        esperar(/aún no existe\) ensureFolder — crea la carpeta si falta/.test(mapa), `falta la función prevista:\n${mapa}`) &&
        esperar(!/exists\(rawPath\)/.test(mapa), "el mapa incluye la función actual")
      );
    },
  },
  {
    name: "[int] con una memoria enorme, el contexto se recorta por la memoria y no pierde el mapa del archivo",
    run: async (r) => {
      fs.writeFileSync(path.join(r, "src/files.js"), FILES_JS);
      fs.mkdirSync(path.join(r, ".cai"), { recursive: true });
      fs.writeFileSync(path.join(r, ".cai", "conocimiento.md"), `# Memoria\n${"Algo que se sabe del proyecto. ".repeat(400)}`);
      fs.writeFileSync(path.join(r, ".cai", "proyecto.md"), `# Proyecto\n${"Detalle del proyecto. ".repeat(300)}`);
      await actualizarIndice(r);
      const ctx = contextoComunInt(r, "src/files.js", { funcion: "exists" });
      const corto = contextoComunInt(r, "src/files.js", { funcion: "exists", corto: true });
      return (
        esperar(ctx.length <= 9100, `el contexto mide ${ctx.length}`) &&
        esperar(ctx.includes("MAPA DEL ARCHIVO") && ctx.includes("normalize(path)"), "se perdió el mapa del archivo") &&
        esperar(corto.includes("normalize(path)"), "la versión corta (guía gris) no trae el mapa")
      );
    },
  },
  {
    name: "[int] verificar: de otra función solo el aviso 'aún no está lista' (sin IA); sus correcciones no se anotan en ninguna nota y lo general no se repite",
    run: async (r) => {
      conNotas(r);
      fs.writeFileSync(path.join(r, "src/files.js"), FILES_JS);
      const calls = fakeLLM(() => ({
        estado: "casi",
        resumen: "Usa normalize, que todavía no hace nada.",
        mejoras: [
          { texto: "Sigue usando normalize para limpiar la ruta (no repitas esa lógica aquí).", funcion: "" },
          { texto: "Completa normalize: quita las barras finales y devuelve '' si no es texto.", funcion: "normalize" },
          { texto: "El archivo no exporta la clase Files.", funcion: "archivo" },
        ],
        que_hacer: "Revisa exists cuando normalize esté lista.",
        decisiones: [],
      }));
      await verificar(r, "src/files.js", { funcion: "exists" });
      await verificar(r, "src/files.js", { funcion: "exists", forzar: true });
      const notas = cargarNotas(r, "src/files.js");
      const texto = (n?: { hilo: { texto: string }[] }) => n?.hilo.map((m) => m.texto).join("\n") ?? "";
      const todo = notas.map(texto).join("\n");
      const arch = notas.find((n) => n.alcance === "archivo");
      const ex = notas.find((n) => n.ancla.funcion === "exists");
      return (
        esperar(/Las otras funciones/.test(calls[0]!.system ?? "") && calls[0]!.prompt.includes("MAPA DEL ARCHIVO"), "el prompt no trae la regla ni el mapa") &&
        esperar(!/Completa normalize/.test(todo), "una corrección de normalize quedó anotada en alguna nota") &&
        esperar(!notas.some((n) => n.ancla.funcion === "normalize"), "se creó una nota para normalize desde la revisión de exists") &&
        esperar(ex?.dependencias?.length === 1 && ex.dependencias[0]!.funcion === "normalize" && ex.dependencias[0]!.estado === "por hacer", `aviso de dependencias: ${JSON.stringify(ex?.dependencias)}`) &&
        esperar((texto(arch).match(/no exporta la clase/g) ?? []).length === 1, `lo general del archivo se repitió:\n${texto(arch)}`)
      );
    },
  },

);

// --- v0.11: modos en dos ejes y "construir juntos" ---------------------------------------------
// Un script sin export (se prueba aislado, con Node; un módulo necesitaría tsx en el proyecto).
const DOBLE = "function doble(x) {\n}\n";
const IDEA_1 = "Revisaría al principio que x sea un número con typeof y, si no lo es, lanzaría un error que diga qué llegó.";
/** IA falsa para construir juntos: responde según qué se le pide (y en qué pasos). */
const CODIGO_PASO: Record<number, string> = { 1: 'if (typeof x !== "number") throw new Error("x debe ser un número");', 2: "return x * 2;" };
const OFERTA_PASO: Record<number, string> = { 1: IDEA_1, 2: "Devolvería x multiplicado por dos." };
const iaConstruir = (extra: Record<string, unknown> = {}) =>
  fakeLLM((o) => {
    const k = o.kind ?? "";
    if (k in extra) return typeof extra[k] === "function" ? (extra[k] as (o: AskOptions) => unknown)(o) : extra[k];
    if (k === "programar:plan") return { pasos: [{ texto: "Validar que x sea un número", repertorio: "" }, { texto: "Devolver el doble", repertorio: "" }], separar: { nombre: "", proposito: "" } };
    if (k === "programar:oferta" || k === "programar:otra") {
      const pasos = [...(/Pasos para los que propones[^:]*: (.*)/.exec(o.prompt)?.[1] ?? "").matchAll(/(\d+)\. /g)].map((m) => Number(m[1]));
      return {
        ofertas: pasos.map((n) => ({ paso: n, idea: OFERTA_PASO[n] ?? "algo", alternativas: n === 1 ? ["Convertir con Number() y comprobar NaN, si quieres aceptar textos numéricos."] : [], sobreTuIdea: /Cómo lo haría el programador/.test(o.prompt) ? "Sirve; cuida que NaN también es number." : "" })),
        previo: /YA TENÍA/.test(o.prompt) ? [{ texto: "No revisas que x sea un número.", porque: "doble('a') daría NaN sin avisar." }] : [],
      };
    }
    if (k === "programar:orden") {
      const pedidos = [...o.prompt.matchAll(/^Paso (\d+) \([^)]*\): (.*)$/gm)].map((m) => ({ n: Number(m[1]), t: m[2]! }));
      return { pasos: pedidos.map(({ n, t }) => ({ paso: n, codigo: n === 2 && /suma/.test(t) ? "return x + x;" : (CODIGO_PASO[n] ?? "return x;"), falta: "", fuera: "", entrada: n === 1 ? 'doble("a")' : "doble(3)", explicacion: "hecho" })) };
    }
    if (k === "programar:fiel") return { agregado: [], falta: [] };
    if (k === "tests") return { casos: [{ tipo: "normal", descripcion: "duplica", llamada: "doble(5)", esperado: "10", duda: "" }, { tipo: "normal", descripcion: "cero", llamada: "doble(0)", esperado: "0", duda: "" }] };
    if (k === "programar:caso") return { encaja: false, porque: "contradice que la función duplica" };
    if (k === "programar:diferencia") return { texto: "La línea 3 multiplica por dos." };
    return {};
  });
const conProgramar = (r: string, modo = "programar") => fs.writeFileSync(path.join(r, ".cai/config.json"), JSON.stringify({ vista: "notas", modo, modosVersion: 2, tests: { avisarSinTests: false } }));
const falla = (f: () => Promise<unknown>) => f().then(() => "", (e: Error) => e.message);
CASES.push(
  {
    name: "[ejes] cuatro modos en dos ejes (quién escribe × cuánta ayuda); lo de antes de v0.10 se sigue migrando igual",
    run: async () => {
      const cfg = { modo: "sugerir", modos: { porCarpeta: { "src/": "programar" }, porFuncion: { "src/a.ts:f": "programar-aprender" } } };
      const viejo = migrarModosC({ modo: "programar", modos: { porArchivo: { "a.ts": "programar" } } }) as { modo: string; modos: { porArchivo: Record<string, string> } };
      return (
        esperar(modoDe("ia", "aprender") === "programar-aprender" && modoDe("manual", "sugerir") === "sugerir" && modoDe("ia", "sugerir") === "programar", "modoDe no combina bien los ejes") &&
        esperar(MODOS2["programar-aprender"].decidirAntes && MODOS2["programar-aprender"].probarCadaPorcion, "programar · aprender no pide decidir antes y probar cada paso") &&
        esperar(!MODOS2.programar.decidirAntes && !MODOS2.programar.probarCadaPorcion && MODOS2.programar.proponerSolucion, "programar (sugerir) no debería pedir la idea antes ni probar cada paso") &&
        esperar(modoEfectivoC(cfg, "src/a.ts", "f").modo === "programar-aprender" && modoEfectivoC(cfg, "src/a.ts", "g").modo === "programar" && modoEfectivoC(cfg, "b.ts").modo === "sugerir", "la precedencia función > carpeta > proyecto falló") &&
        esperar(viejo.modo === "sugerir" && viejo.modos.porArchivo["a.ts"] === "sugerir", "la migración de antes de v0.10 cambió")
      );
    },
  },  {
    name: "[pedido] programar: pides con tus palabras qué debe hacer la función entera; un cambio toca solo lo suyo; si es mucho, propone separarla y te da las auxiliares vacías",
    run: async (r) => {
      conProgramar(r);
      fs.writeFileSync(path.join(r, "src/doble.js"), DOBLE);
      const calls = iaConstruir({
        "programar:oferta": { idea: "Revisaría que x sea un número y devolvería su doble.", alternativas: [], previo: [] },
        "programar:auditoria": { que_hace: "línea 2 valida", estado: "casi", resumen: "Bien, el mensaje podría ser más claro.", casos: [{ llamada: "doble(5)", comentario: "pasa" }, { llamada: "doble(0)", comentario: "pasa" }], que_hacer: ["nada urgente"], mejoras: [{ texto: "mensaje más claro", porque: "dice qué tipo llegó" }], ideal: { descripcion: "Igual, con un mensaje que diga el tipo recibido.", cuerpo: 'if (typeof x !== "number") throw new Error("x debe ser number, llegó " + typeof x);\nreturn x * 2;' } },
        "programar:pedido": (o: AskOptions) =>
          /lea el archivo/.test(o.prompt) && !/UNA sola/.test(o.prompt)
            ? { cuerpo: "", falta: "", entrada: "", explicacion: "", separar: [{ nombre: "leerNota", firma: "leerNota(ruta)", proposito: "lee el archivo de la nota" }, { nombre: "moverNota", firma: "moverNota(nota, carpeta)", proposito: "mueve la nota a su carpeta" }], motivo: "hace tres cosas distintas" }
            : /mensaje de error más claro/.test(o.prompt)
              ? { cuerpo: 'if (typeof x !== "number") throw new Error("x debe ser number, llegó " + typeof x);\nreturn x * 2;', falta: "", entrada: "doble(3)", explicacion: "", separar: [], motivo: "" }
              : /NaN/.test(o.prompt)
              ? { cuerpo: 'if (typeof x !== "number" || Number.isNaN(x)) throw new Error("x debe ser un número");\nreturn x * 2;', falta: "", entrada: "doble(NaN)", explicacion: "", separar: [], motivo: "" }
              : { cuerpo: 'if (typeof x !== "number") throw new Error("x debe ser un número");\nreturn x * 2;', falta: "", entrada: "doble(3)", explicacion: "", separar: [], motivo: "" },
      });
      const of = await ofrecerTodo(r, "src/doble.js", "doble");
      const vaga = await falla(() => pedir(r, "src/doble.js", "doble", "haz la función completa por favor"));
      const copia = await falla(() => pedir(r, "src/doble.js", "doble", "revisaría que x sea un número y devolvería su doble"));
      const p1 = await pedir(r, "src/doble.js", "doble", "que valide que x sea número y devuelva el doble");
      const p2 = await pedir(r, "src/doble.js", "doble", "que también rechace NaN con el mismo error");
      const cambiadas = p2.porciones.filter((x) => x.orden === "que también rechace NaN con el mismo error");
      const d = await deshacerPedido(r, "src/doble.js", "doble");
      const sep = await pedir(r, "src/doble.js", "doble", "que lea el archivo, lo normalice, lo mueva a su carpeta y avise al usuario");
      const st = await stubsAuxiliares(r, "src/doble.js", "doble");
      fs.writeFileSync(path.join(r, "src/doble.js"), `${DOBLE}${st.texto}\n`);
      const reg = await registrarAuxiliares(r, "src/doble.js", "doble");
      const tareas = cargarTareas(r).filter((t) => t.funcion === "leerNota" || t.funcion === "moverNota");
      const casos = await casosConstruir(r, "src/doble.js", "doble");
      await predecirConstruir(r, "src/doble.js", "doble", "0");
      const sinAuditar = await falla(() => registrarInsercionC(r, "src/doble.js", "doble"));
      const au = await auditarC(r, "src/doble.js", "doble");
      const conIdeal = await pedir(r, "src/doble.js", "doble", "toma de la versión ideal el mensaje de error más claro", { ideal: true });
      const pedidoIdeal = calls.filter((c) => c.kind === "programar:pedido").pop()!;
      const vieja = await falla(() => registrarInsercionC(r, "src/doble.js", "doble"));
      await auditarC(r, "src/doble.js", "doble");
      await predecirConstruir(r, "src/doble.js", "doble", "0").catch(() => undefined);
      const ins = await registrarInsercionC(r, "src/doble.js", "doble");
      return (
        esperar(of.construir.forma === "pedido" && of.construir.ofertas?.[0]?.paso === 0 && !calls.some((c) => c.kind === "programar:plan"), "en programar no debería haber plan por pasos, sino una propuesta de la función") &&
        esperar(/no dice qué debe hacer/.test(vaga), `aceptó un pedido sin contenido: "${vaga}"`) &&
        esperar(/TUS palabras/.test(copia), `aceptó copiar la propuesta: "${copia}"`) &&
        esperar(p1.codigo === 'function doble(x) {\n  if (typeof x !== "number") throw new Error("x debe ser un número");\n  return x * 2;\n}' && p1.porciones[0]?.entrada === "doble(3)", `la función entera:\n${p1.codigo}`) &&
        esperar(cambiadas.length === 1 && cambiadas[0]!.codigo!.includes("isNaN") && p2.porciones.some((x) => x.codigo === "  return x * 2;" && x.orden !== cambiadas[0]!.orden), `el cambio tocó más de lo suyo: ${JSON.stringify(p2.porciones.map((x) => [x.orden, x.codigo]))}`) &&
        esperar(d.codigo === p1.codigo, "deshacer no volvió al borrador anterior") &&
        esperar(sep.construir.separar?.auxiliares.length === 2 && sep.codigo === p1.codigo, "si es mucho, debería proponer separar sin escribir") &&
        esperar(st.texto.includes("// lee el archivo de la nota\nfunction leerNota(ruta) {\n}") && st.texto.includes("function moverNota(nota, carpeta) {"), `auxiliares vacías:\n${st.texto}`) &&
        esperar(reg.construir.pedidoPendiente?.startsWith("que lea el archivo") && !reg.construir.separar && tareas.length === 2, `registrar auxiliares: ${JSON.stringify({ pend: reg.construir.pedidoPendiente, tareas })}`) &&
        esperar(/auditoría final/.test(sinAuditar), `dejó insertar sin la auditoría final: "${sinAuditar}"`) &&
        esperar(au.construir.auditoria?.casos?.length === 2 && au.construir.auditoria.queHacer?.[0] === "nada urgente" && au.construir.auditoria.ideal?.codigo.includes("debe ser number"), `auditoría de un paso: ${JSON.stringify(au.construir.auditoria)}`) &&
        esperar(/Versión ideal que propuso la auditoría/.test(pedidoIdeal.prompt) && conIdeal.construir.auditoria?.codigo !== conIdeal.codigo, "tomar algo de la versión ideal no le pasó la versión como referencia") &&
        esperar(/de esta versión/.test(vieja), `dejó insertar con una auditoría de una versión anterior: "${vieja}"`) &&
        esperar(casos.construir?.casos?.length === 2 && ins.ordenes! >= 1, `casos e insertar por pedidos: ${JSON.stringify(ins)}`) &&
        esperar(pedidoValido("que devuelva el nombre en minúsculas y sin tildes", []) === null, "rechazó un pedido concreto")
      );
    },
  },
  {
    name: "[construir] tu orden decide: se rechaza lo vago ('dale, haz eso'), lo de más de un paso y lo copiado; las trampas con casos se detectan sin IA",
    run: async () => {
      const of = [IDEA_1];
      const rechazos = ["dale, haz eso", "sí, dale", "haz lo que me dijiste", "usa la segunda opción", "ok, hazlo así como está", "haz que valide x y lo demás también", "escribe toda la función de una vez", "revisaría al principio que x sea un número con typeof y si no lo es lanzaría un error"].map((t) => [t, ordenValida(t, of)] as const);
      const propia = ordenValida("haz que lance un error si x no es number", of) ?? ordenValida("si no me pasan un texto, que tire un TypeError diciendo qué llegó", of);
      const t = trampas('function n(r) {\n  if (r === "a/b/") return 42;\n  return r;\n}', [{ llamada: 'n("a/b/")', esperado: "42" }], "normaliza la ruta");
      const consigna = trampas('function n(r) {\n  if (r === "sin título") return 0;\n}', [{ llamada: 'n("sin título")', esperado: "0" }], 'si es "sin título" devuelve 0');
      const js = partesDeFuncion("function doble(x) {\n}", "javascript");
      const una = partesDeFuncion("  normalize(path) {}", "javascript");
      const py = partesDeFuncion("def doble(x):\n    pass", "python");
      return (
        esperar(rechazos.every(([, e]) => e), `aceptó una orden vaga, amplia o copiada: ${rechazos.filter(([, e]) => !e).map(([x]) => x).join(" | ")}`) &&
        esperar(/TUS palabras/.test(rechazos[7]![1] ?? ""), `la copia no se rechazó por copia: ${rechazos[7]![1]}`) &&
        esperar(propia === null, `rechazó una orden propia y concreta: ${propia}`) &&
        esperar(conExpresiones('revisa con `typeof titulo !== "string"` y lanza') && !conExpresiones("usa `String()` o `Number.isInteger`"), "conExpresiones confunde una pieza con una expresión") &&
        esperar(t.some((x) => x.includes('"a/b/"')) && t.some((x) => x.includes("devuelve 42")), `no detectó la trampa: ${JSON.stringify(t)}`) &&
        esperar(!consigna.length, `marcó como trampa un valor que pide la consigna: ${JSON.stringify(consigna)}`) &&
        esperar(js.cabecera.join() === "function doble(x) {" && js.cierre.join() === "}" && !js.cuerpo.length && js.sangria === "  ", `partes JS: ${JSON.stringify(js)}`) &&
        esperar(una.cabecera[0] === "  normalize(path) {" && una.cierre[0] === "  }" && una.sangria === "    ", `partes en una línea: ${JSON.stringify(una)}`) &&
        esperar(py.cabecera.join() === "def doble(x):" && py.cuerpo.join() === "    pass", `partes Python: ${JSON.stringify(py)}`)
      );
    },
  },
  {
    name: "[construir] la IA ofrece todos los pasos en palabras; tus órdenes (de corrido) escriben SOLO esos pasos al final de lo hecho; rehacer, deshacer, casos y predicción antes de insertar",
    run: async (r) => {
      conProgramar(r);
      fs.writeFileSync(path.join(r, "src/doble.js"), DOBLE);
      const calls = iaConstruir();
      const p1 = await ofrecer(r, "src/doble.js", "doble");
      const saltado = await falla(() => ordenarPasos(r, "src/doble.js", "doble", [{ paso: 2, texto: "haz que devuelva x multiplicado por dos" }]));
      const vaga = await falla(() => ordenarPasos(r, "src/doble.js", "doble", [{ paso: 1, texto: "dale, haz eso que dijiste" }]));
      const q = await ordenarPasos(r, "src/doble.js", "doble", [
        { paso: 1, texto: "haz que lance un error si x no es number" },
        { paso: 2, texto: "haz que devuelva x multiplicado por dos" },
      ]);
      const unaLlamada = calls.filter((c) => c.kind === "programar:orden").length === 1;
      const fieles = calls.filter((c) => c.kind === "programar:fiel");
      const re = await ordenar(r, "src/doble.js", "doble", "mejor que devuelva la suma de x consigo mismo", { rehacer: true });
      const sinCasos = await falla(() => registrarInsercionC(r, "src/doble.js", "doble"));
      const d = await deshacer(r, "src/doble.js", "doble");
      await ordenar(r, "src/doble.js", "doble", "haz que devuelva x multiplicado por dos");
      const conCasos = await casosConstruir(r, "src/doble.js", "doble");
      const sinPredecir = await falla(() => registrarInsercionC(r, "src/doble.js", "doble"));
      const pred = await predecirConstruir(r, "src/doble.js", "doble", "0");
      const reg = await registrarInsercionC(r, "src/doble.js", "doble");
      return (
        esperar(calls.some((c) => c.kind === "programar:plan") && p1.construir.ofertas?.map((x) => x.paso).join() === "1,2" && p1.porciones.length === 0, `sin plan, debería pedir el plan y ofrecer los 2 pasos sin código: ${JSON.stringify(p1.construir.ofertas)}`) &&
        esperar(/de corrido/.test(saltado), `dejó ordenar el paso 2 sin el 1: "${saltado}"`) &&
        esperar(/QUÉ hacer/.test(vaga), `aceptó una orden vaga: "${vaga}"`) &&
        esperar(unaLlamada && q.porciones.length === 2 && q.porciones[0]!.entrada === 'doble("a")' && q.porciones[1]!.entrada === "doble(3)" && q.codigo.endsWith("  return x * 2;\n}") && !q.construir.ofertas?.length, `dos pasos en una orden: ${JSON.stringify(q.porciones.map((x) => x.codigo))}`) &&
        esperar(fieles.length === 2 && fieles.every((c) => /Orden del programador/.test(c.prompt) && !/Puedo hacerlo|Devolvería|hecho/.test(c.prompt)) && /ya estaba escrito antes/.test(fieles[1]!.prompt), "la IA chica no verificó cada paso a ciegas (orden, código y lo anterior; sin las explicaciones)") &&
        esperar(re.porciones.length === 2 && re.porciones[1]!.codigo === "  return x + x;" && re.porciones[0]!.codigo === q.porciones[0]!.codigo, `rehacer el último paso: ${JSON.stringify(re.porciones.map((x) => x.codigo))}`) &&
        esperar(/pide los casos/.test(sinCasos), `dejó insertar sin casos: "${sinCasos}"`) &&
        esperar(d.porciones.length === 1 && d.construir.ofertas?.[0]?.paso === 2, "deshacer no quitó el paso o no devolvió su propuesta") &&
        esperar(conCasos.construir?.prediccion?.llamada === "doble(0)" && conCasos.construir.casos!.every((x) => x.pasa), `casos: ${JSON.stringify(conCasos.construir)}`) &&
        esperar(/predice/.test(sinPredecir), `dejó insertar sin predecir: "${sinPredecir}"`) &&
        esperar(pred.acierto && reg.ordenes === 2 && reg.prediccion?.acierto === true && !leerPropuestaC(r, "src/doble.js", "doble"), `registro: ${JSON.stringify(reg)}`)
      );
    },
  },
  {
    name: "[construir] la IA chica avisa si un paso agregó algo que tu orden no pedía (a ciegas): quitarlo o dejarlo lo decides tú",
    run: async (r) => {
      conProgramar(r);
      fs.writeFileSync(path.join(r, "src/doble.js"), DOBLE);
      iaConstruir({
        "programar:orden": { pasos: [{ paso: 1, codigo: 'if (typeof x !== "number" || Number.isNaN(x)) throw new Error("x debe ser un número");', falta: "", fuera: "", entrada: 'doble("a")', explicacion: "" }] },
        "programar:fiel": (o: AskOptions) => (/isNaN/.test(o.prompt) ? { agregado: ["también rechaza NaN"], falta: [] } : { agregado: [], falta: [] }),
        "programar:quitar": { codigo: 'if (typeof x !== "number") throw new Error("x debe ser un número");' },
      });
      await ofrecer(r, "src/doble.js", "doble");
      const q = await ordenarPasos(r, "src/doble.js", "doble", [{ paso: 1, texto: "haz que lance un error si x no es number" }]);
      const quitado = await resolverAgregadoC(r, "src/doble.js", "doble", 0, "quitar");
      const nada = await falla(() => resolverAgregadoC(r, "src/doble.js", "doble", 0, "dejar"));
      return (
        esperar(q.porciones[0]!.verificacion?.agregado[0] === "también rechaza NaN", `no avisó lo agregado: ${JSON.stringify(q.porciones[0]!.verificacion)}`) &&
        esperar(!quitado.porciones[0]!.codigo!.includes("isNaN") && quitado.porciones[0]!.orden === "haz que lance un error si x no es number" && !quitado.porciones[0]!.verificacion?.agregado.length, `quitar: ${JSON.stringify(quitado.porciones[0])}`) &&
        esperar(/nada agregado/.test(nada), `después de quitarlo no debería quedar nada que resolver: "${nada}"`)
      );
    },
  },
  {
    name: "[construir] si la función ya tenía código tuyo, la IA lo revisa sin anclarse (sugerencias); 'dejarlo así' o cambiarlo con tu orden",
    run: async (r) => {
      conProgramar(r);
      fs.writeFileSync(path.join(r, "src/doble.js"), "function doble(x) {\n  return x * 2;\n}\n");
      iaConstruir({ "programar:ajuste": { cuerpo: 'if (typeof x !== "number") throw new Error("x debe ser un número");\nreturn x * 2;', falta: "", entrada: 'doble("a")', explicacion: "Valida x." } });
      const p = await ofrecer(r, "src/doble.js", "doble");
      const trasReturn = await falla(() => ordenarPasos(r, "src/doble.js", "doble", [{ paso: 1, texto: "haz que lance un error si x no es number" }]));
      const copia = await falla(() => ordenar(r, "src/doble.js", "doble", "No revisas que x sea un número", { sugerencia: 0 }));
      const q = await ordenar(r, "src/doble.js", "doble", "haz que lance un error si x no es number antes de calcular", { sugerencia: 0 });
      return (
        esperar(p.porciones[0]?.tipo === "ya-estaba" && p.construir.previo?.length === 1 && p.construir.previo[0]!.estado === "pendiente", `no revisó tu código previo: ${JSON.stringify(p.construir.previo)}`) &&
        esperar(/termina con un return/.test(trasReturn), `agregó un paso después de tu return: "${trasReturn}"`) &&
        esperar(/TUS palabras/.test(copia), `aceptó copiar la sugerencia como orden: "${copia}"`) &&
        esperar(q.construir.previo![0]!.estado === "aplicado" && q.porciones.some((x) => x.tipo === "ajuste" && x.codigo!.includes("throw")) && q.porciones.some((x) => x.tipo === "ya-estaba" && x.codigo === "  return x * 2;"), `cambiarlo con tu orden: ${JSON.stringify(q.porciones.map((x) => [x.tipo, x.codigo]))}`)
      );
    },
  },

  {
    name: "[construir] programar · aprender: dices cómo lo harías antes de ver la propuesta (la IA comenta tu idea) y pruebas cada paso antes del siguiente",
    run: async (r) => {
      conProgramar(r, "programar-aprender");
      fs.writeFileSync(path.join(r, "src/doble.js"), DOBLE);
      iaConstruir();
      const sinIdea = await falla(() => ofrecer(r, "src/doble.js", "doble"));
      const p = await ideaPaso(r, "src/doble.js", "doble", "veo si es un número y si no lanzo error");
      await ordenar(r, "src/doble.js", "doble", "haz que lance un error si x no es number");
      const sinProbar = await falla(() => ideaPaso(r, "src/doble.js", "doble", "lo multiplico por dos y lo devuelvo"));
      const { probarPorcion } = await import("../flujos/programar.js");
      const pr = await probarPorcion(r, "src/doble.js", "doble", 0, "", "error: número");
      const q = await ideaPaso(r, "src/doble.js", "doble", "lo multiplico por dos y lo devuelvo");
      return (
        esperar(/cómo harías/.test(sinIdea), `mostró la propuesta sin tu idea: "${sinIdea}"`) &&
        esperar(p.construir.ofertas?.length === 1 && p.construir.ofertas[0]!.ideaTuya === "veo si es un número y si no lanzo error" && /NaN/.test(p.construir.ofertas[0]!.sobreTuIdea ?? ""), `en aprender, de a un paso y comentando tu idea: ${JSON.stringify(p.construir.ofertas)}`) &&
        esperar(/prueba el anterior/.test(sinProbar), `dejó pasar al paso 2 sin probar el 1: "${sinProbar}"`) &&
        esperar(pr.prueba.entrada === 'doble("a")' && pr.prueba.toca && pr.prueba.acierto, `la prueba con la entrada sugerida: ${JSON.stringify(pr.prueba)}`) &&
        esperar(q.construir.ofertas?.[0]?.paso === 2, "después de probar no ofreció el paso 2")
      );
    },
  },
  {
    name: "[construir] un caso que no tiene sentido no se fuerza (raro + tu decisión); uno que falla se ajusta con TU orden y lo demás queda igual",
    run: async (r) => {
      conProgramar(r);
      fs.writeFileSync(path.join(r, "src/doble.js"), DOBLE);
      iaConstruir({ "programar:ajuste": { cuerpo: 'if (typeof x !== "number" || Number.isNaN(x)) throw new Error("x debe ser un número");\nreturn x * 2;', falta: "", entrada: "doble(NaN)", explicacion: "También rechaza NaN." } });
      await ofrecer(r, "src/doble.js", "doble");
      await ordenar(r, "src/doble.js", "doble", "haz que lance un error si x no es number");
      await ofrecer(r, "src/doble.js", "doble");
      await ordenar(r, "src/doble.js", "doble", "haz que devuelva x multiplicado por dos");
      await casosConstruir(r, "src/doble.js", "doble");
      const raro = await editarCaso(r, "src/doble.js", "doble", -1, "doble(2)", "7");
      const pend = cargarDecisionesC(r).filter((x) => x.estado === "pendiente");
      const vaga = await falla(() => ordenar(r, "src/doble.js", "doble", "arréglalo como dijiste"));
      const aj = await ordenar(r, "src/doble.js", "doble", "haz que también rechace NaN con el mismo error");
      return (
        esperar(raro.pasa === false && raro.raro === "contradice que la función duplica", `caso: ${JSON.stringify(raro)}`) &&
        esperar(pend.length === 1 && pend[0]!.pregunta.includes("doble(2)"), `decisión: ${JSON.stringify(pend)}`) &&
        esperar(/QUÉ hacer/.test(vaga), `aceptó un ajuste vago: "${vaga}"`) &&
        esperar(aj.porciones.some((x) => x.tipo === "ajuste" && x.codigo!.includes("Number.isNaN")) && aj.porciones.some((x) => x.paso === 2 && !x.tipo && x.codigo === "  return x * 2;"), `ajuste: ${JSON.stringify(aj.porciones.map((x) => [x.tipo ?? x.paso, x.codigo]))}`) &&
        esperar(aj.construir.casos!.every((x) => x.pasa === undefined), "los casos no quedaron para volver a probar tras el ajuste")
      );
    },
  },
  {
    name: "[construir][seg] desde el chat la IA puede ofrecer y pedir casos, pero no dar tu orden, tu idea, deshacer, predecir ni editar casos",
    run: async () => {
      const rel = ".cai/cache/propuestas/a.js%23doble.json";
      const base = { tipo: "construir", porciones: [{ tipo: "ya-estaba", codigo: "  let y;" }, { paso: 1, codigo: "  if (!x) throw 1;", orden: "haz que lance si no hay x", pruebas: [{}] }], construir: { ofertas: [{ paso: 2, idea: "a", alternativas: [] }], previo: [{ texto: "s", porque: "p", estado: "pendiente" }], casos: [{ llamada: "doble(1)", esperado: "2", tuyo: true }] } };
      const b = (x: unknown) => Buffer.from(JSON.stringify(x));
      const ofrecerIA = generadosPor("cai programar otra a.js --funcion doble")!;
      const nuevaOferta = ofrecerIA(rel, b(base), b({ ...base, construir: { ...base.construir, ofertas: [{ paso: 2, idea: "b", alternativas: [] }] } }));
      const nuevaConCodigoPrevio = ofrecerIA(rel, null, b({ tipo: "construir", porciones: [{ tipo: "ya-estaba", codigo: "  let y;" }], construir: { ofertas: [{ paso: 1, idea: "a", alternativas: [] }], previo: [{ texto: "s", porque: "p", estado: "pendiente" }] } }));
      const dejaSugerencia = ofrecerIA(rel, b(base), b({ ...base, construir: { ...base.construir, previo: [{ texto: "s", porque: "p", estado: "dejado" }] } }));
      const dejaAgregado = ofrecerIA(rel, b(base), b({ ...base, porciones: [base.porciones[0], { ...base.porciones[1], verificacion: { agregado: ["x"], falta: [], dejado: true } }] }));
      // Sin orden tampoco: la IA no puede meter código al borrador por su cuenta.
      const sinOrden = ofrecerIA(rel, b(base), b({ ...base, porciones: [...base.porciones, { paso: 2, codigo: "  return x * 2;" }] }));
      const escribe = ofrecerIA(rel, b(base), b({ ...base, porciones: [...base.porciones, { paso: 2, codigo: "  return x * 2;", orden: "haz que devuelva el doble" }] }));
      const idea = ofrecerIA(rel, b(base), b({ ...base, construir: { ...base.construir, ofertas: [{ paso: 2, idea: "b", alternativas: [], ideaTuya: "yo lo haría así" }] } }));
      const predice = ofrecerIA(rel, b(base), b({ ...base, construir: { ...base.construir, prediccion: { llamada: "doble(0)", espero: "0" } } }));
      const caso = ofrecerIA(rel, b(base), b({ ...base, construir: { ...base.construir, casos: [...base.construir.casos, { llamada: "doble(2)", esperado: "5", tuyo: true }] } }));
      return (
        esperar(["orden", "idea", "deshacer", "predecir", "caso", "quitar", "dejar"].every((x) => generadosPor(`cai programar ${x} a.js --funcion doble --texto hola`) === null && soloHumano(`cai programar ${x} a.js --funcion doble`) !== null), "algún comando del programador lo puede correr la IA") &&
        esperar(nuevaOferta && nuevaConCodigoPrevio, `se revirtió algo legítimo: oferta=${nuevaOferta} nueva=${nuevaConCodigoPrevio}`) &&
        esperar(!escribe && !sinOrden && !idea && !predice && !caso && !dejaSugerencia && !dejaAgregado, `la IA pudo hacer algo del programador: escribe=${escribe} sinOrden=${sinOrden} idea=${idea} predice=${predice} caso=${caso} dejaSugerencia=${dejaSugerencia} dejaAgregado=${dejaAgregado}`)
      );
    },
  },
);

export function escenarios(filtro?: string): Case[] {
  const f = filtro?.trim().toLowerCase();
  return f ? CASES.filter((c) => c.name.toLowerCase().includes(f)) : CASES;
}

/** Corre un escenario en un proyecto temporal propio. `error` dice por qué falló (si se sabe). */
export async function correrEscenario(c: Case): Promise<{ ok: boolean; error?: string }> {
  const root = project();
  process.env.CAI_HOME = path.join(root, ".home");
  process.env.CAI_REPERTORIO = path.join(root, ".home", "repertorio"); // nunca el repertorio real
  process.env.CAI_VISTA = "comentarios"; // los escenarios clásicos usan comentarios; los de notas lo declaran (conNotas)
  try {
    return (await c.run(root)) ? { ok: true } : { ok: false };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    setLLM(null);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

export async function runSelftest(log: (s: string) => void = console.log, filtro?: string): Promise<boolean> {
  const lista = escenarios(filtro);
  if (!lista.length) {
    log(`ningún escenario contiene "${filtro}"`);
    return false;
  }
  let ok = 0;
  for (const c of lista) {
    const r = await correrEscenario(c);
    if (r.error) log(`    error: ${r.error}`);
    log(`${r.ok ? "✓" : "✗"} ${c.name}`);
    if (r.ok) ok++;
  }
  log(`\n${ok}/${lista.length} escenarios OK${filtro ? ` (filtro: "${filtro}")` : ""}`);
  return ok === lista.length;
}
