#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { CommentKind } from "./comments.js";
import { makeZoner } from "./config.js";
import { listFiles } from "./files.js";
import { cleanText, conversation } from "./guia.js";
import { runHook, type HookInput } from "./hook.js";
import { init, KEYBINDINGS } from "./init.js";
import { langFor } from "./lang.js";
import { runSelftest } from "./selftest.js";
import { verifyCommentOnly } from "./verify.js";
import { loadPatrones } from "./context.js";
import { declarar, loadPerfil, nivelDe, type Nivel } from "./profile.js";
import { loadEstado, saveEstado } from "./state.js";
import { resolveMissing, runGuia } from "./tutor.js";
import { watch } from "./watch.js";
import { acompanar } from "./acompanante.js";
import { planoProyecto } from "./plano.js";
import { proponerTests } from "./tests.js";
import { leerMemoria, panorama, preguntasAbiertas, responderPregunta } from "./panorama.js";
import { enCurso, OcupadoError, ocuparEsperando } from "./ocupado.js";
import { responderNota } from "./responder.js";
import { cargarNotas, guardarNotas, nuevaNota, mensaje, todasLasNotas } from "./notas.js";
import { cargarTareas, guardarTareas, siguiente } from "./siguiente.js";
import { planoArchivo } from "./planoArchivo.js";
import { conContenido, conocer, sugerirAutoria } from "./conocer.js";
import { createInterface } from "node:readline/promises";
import { dataDir, loadConfig, origenDe } from "./config.js";
import { leerUso } from "./llm.js";
import { crearSnippet } from "./snippets.js";
import { aplicarExpansion, biblioteca, expandir, paraLenguaje, parseLlamada, planExpansion } from "./biblioteca.js";
import { runReview } from "./review.js";
import { runGate } from "./gate.js";
import { runCheck, runPredecir } from "./predict.js";
import { doctor, instalar } from "./doctor.js";
import { corre, error, explica, pregunta, SHELL_SNIPPET } from "./terminal.js";
import { arquitectura, nuevoAdr } from "./arquitectura.js";

const HELP = `ComplementAIry (cai) — tú programas, la IA te acompaña

  cai init [dir]                 instala hooks, config y pre-commit en un proyecto
  cai siguiente                  qué hacer ahora (una sola cosa, elegida sin IA) y qué viene después
  cai responder <archivo> (--linea N | --nota <id> | --archivo-entero) [--texto "..."] [--pedido pista|piezas|pseudo|ejemplo|tests|explica]
                                    pregunta en una nota (en modo notas el archivo no se toca)
  cai notas [<archivo>|--todas]  notas abiertas · cai notas resolver <archivo> <id> · cai notas importar <archivo>
  cai tareas [hecha|pendiente <id>]  tareas del plano, la estructura y el panorama
  cai memoria [responder <n> "..."]  preguntas que la IA te hizo sobre el proyecto (y tus respuestas)
  cai guia <archivo>             responde los @ia? / @yo: pendientes con comentarios @guia
  cai revisar <archivo> [--sin-ia] [--solo bugs,seguridad] [--todo]
                                    verificaciones deterministas + revisores de IA, como comentarios
  cai gate [archivos...] [--staged] [--rapido] [--mutacion]
                                    solo verificaciones deterministas (falla si hay problemas)
  cai conocer [--sin-preguntas]     proyecto ya armado: analiza, redacta proyecto.md/reglas.md y te pregunta
                                    (con respuestas sugeridas); detecta qué código no escribiste (git)
  cai origen                        quién escribió qué (según git) y cómo está marcado en .cai/config.json
  cai tests <archivo> [función]     propone casos de prueba (apagados) en la carpeta de tests
  cai panorama [--sin-ia]           visión del proyecto completo: estado, sugerencias de diseño, alternativas,
                                    preguntas para ti, prácticas medidas, funciones sin tests (en .cai/panorama.md)
  cai predecir <archivo>         preguntas "¿qué devuelve...?" sobre tus funciones
  cai check <archivo>            ejecuta tu código y compara con tus predicciones (@yo:)
  cai doctor [--instalar]        qué está listo, qué falta y cómo arreglarlo
  cai explica -- <comando>       explica un comando y sus riesgos (no lo ejecuta)
  cai pregunta "<texto>" [--mas | --intente "..."]
                                    preguntas de terminal con escalera de pistas
  cai corre -- <comando>         corre tu comando; si falla, guarda la salida para \`cai error\`
  cai error                      te ayuda a entender el último error
  cai shell                      atajos para tu ~/.bashrc (ia, iamas, ex, c)
  cai arquitectura "<tema>"      prepara un ADR con preguntas y opciones; decidís y escribís vos
  cai adr nuevo "<título>"       ADR vacío con la estructura
  cai acompanar <archivo>        lo que pasa al guardar: expande snippets activados [x], responde @ia?,
                                    propone planos y ofrece ayuda si una función sigue con errores
  cai plano ["<qué construyes>"] plano del proyecto en docs/ESTRUCTURA.md; lo que falta crear, a tus tareas
  cai plano --archivo <archivo>  plano de un archivo: resumen, nota por función y tareas
  cai uso [--dias 7]             consumo de IA: llamadas, tokens, caché, costo y llamadas evitadas
  cai watch                      responde solo al guardar (cualquier editor)
  cai perfil                     muestra tu perfil (nivel por tema, errores frecuentes)
  cai perfil set <tema> <nivel>  declara tu nivel: aprendiz | intermedio | experto
  cai snippet nuevo <nombre> [--archivo f --lineas 10-20] [--lenguaje ts]
                                    crea un snippet propio desde código que ya escribiste
  cai expandir <archivo> [--linea N]
                                    reemplaza // @snippet: nombre arg=valor por el snippet real
                                    (con --linea también acepta una sugerencia @guia ... snippet:)
  cai snippet lista [archivo]    snippets disponibles (tuyos y base)
  cai snippet cuerpo <archivo> "<nombre clave=valor>"  el snippet listo para VSCode (con huecos)
  cai guia list [archivos...]    lista comentarios @guia / @ia? / @yo:
  cai guia clean [archivos...]   borra los comentarios de conversación (--solo-guia: solo @guia)
  cai guia check [--staged]      falla si quedan comentarios de conversación (pre-commit)
  cai verify <antes> <después>   ¿la diferencia es solo comentarios @guia?
  cai hook                       (lo llama Claude Code; lee JSON por stdin)
  cai selftest                   corre los escenarios de verificación
`;

function projectRoot(): string {
  return process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function targetFiles(root: string, args: string[]): string[] {
  const files = args.filter((a) => !a.startsWith("--"));
  const rel = files.length ? files.map((f) => path.relative(root, path.resolve(f))) : listFiles(makeZoner(root));
  return rel.filter((f) => langFor(f));
}

function stagedFiles(root: string): { file: string; text: string }[] {
  const names = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], { cwd: root })
    .toString()
    .split("\0")
    .filter((f) => f && langFor(f));
  return names.map((file) => ({ file, text: execFileSync("git", ["show", `:${file}`], { cwd: root, maxBuffer: 64 << 20 }).toString() }));
}

async function ejecutar(argv: string[]): Promise<number> {
  const [cmd, sub, ...rest] = argv;
  const root = projectRoot();

  switch (cmd) {
    case "hook": {
      const input = JSON.parse(await readStdin()) as HookInput;
      const out = await runHook(input, root);
      if (out) process.stdout.write(JSON.stringify(out));
      return 0;
    }
    case "init": {
      const target = path.resolve(sub ?? ".");
      const { changes } = init(target);
      console.log(`cai instalado en ${target}:\n` + changes.map((c) => `  · ${c}`).join("\n"));
      // Proyecto ya armado y sin proyecto.md: ofrecer el arranque guiado.
      const yaArmado = listFiles(makeZoner(target)).filter((f) => langFor(f) && !/\.(md|ya?ml|toml|json)$/i.test(f)).length >= 3;
      if (yaArmado && !conContenido(path.join(dataDir(target), "proyecto.md"))) {
        if (process.stdin.isTTY && target === path.resolve(root)) {
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          const r = (await rl.question("\nEste proyecto ya tiene código. ¿Lo analizo para ayudarte a llenar proyecto.md y reglas.md con unas pocas preguntas? [S/n] ")).trim().toLowerCase();
          rl.close();
          if (r === "" || r.startsWith("s")) return main(["conocer"]);
        } else console.log("\nEste proyecto ya tiene código: corre `cai conocer` para que te ayude a llenar proyecto.md y reglas.md.");
      }
      console.log(
        `\nPróximos pasos:\n` +
          `  1. Completá .cai/proyecto.md y .cai/reglas.md con tus palabras.\n` +
          `  2. Declará lo que sabés: cai perfil set typescript experto (aprendiz | intermedio | experto)\n` +
          `  3. Atajos: instalá la extensión de VSCode (packages/vscode-complementairy) o pegá esto en tus keybindings.json\n` +
          `     (Ctrl+Shift+P → "Preferences: Open Keyboard Shortcuts (JSON)"):\n${KEYBINDINGS.replace(/^/gm, "     ")}\n` +
          `  4. O sin editor: cai watch (responde solo al guardar).`,
      );
      return 0;
    }
    case "verify": {
      if (!sub || !rest[0]) throw new Error("uso: cai verify <antes> <después>");
      const lang = langFor(rest[0]);
      if (!lang) throw new Error(`tipo de archivo sin soporte: ${rest[0]}`);
      const v = await verifyCommentOnly(fs.readFileSync(sub, "utf8"), fs.readFileSync(rest[0], "utf8"), lang);
      console.log(v.ok ? "OK: solo cambiaron comentarios @guia" : "RECHAZADO:\n- " + v.reasons.join("\n- "));
      return v.ok ? 0 : 1;
    }
    case "guia": {
      const kinds: CommentKind[] = rest.includes("--solo-guia") ? ["guia"] : ["guia", "ia", "yo"];
      if (sub === "check") kinds.push("snippet"); // un @snippet: sin expandir tampoco se commitea
      if (sub === "list" || sub === "check") {
        const items = rest.includes("--staged")
          ? stagedFiles(root)
          : targetFiles(root, rest).map((file) => ({ file, text: fs.readFileSync(path.join(root, file), "utf8") }));
        let n = 0;
        for (const { file, text } of items) {
          for (const c of await conversation(file, text, kinds)) {
            n++;
            console.log(`${file}:${c.row + 1}  ${c.content}`);
          }
        }
        if (sub === "check" && n > 0) {
          console.error(`\n✗ Quedan ${n} comentarios de conversación. Corré \`cai guia clean\` (o borralos) antes de commitear.`);
          return 1;
        }
        if (sub === "check") console.log("✓ Sin comentarios de conversación pendientes.");
        return 0;
      }
      if (sub === "clean") {
        let total = 0;
        const estado = loadEstado(root);
        let resueltos = 0;
        for (const file of targetFiles(root, rest)) {
          const abs = path.join(root, file);
          const { text, removed } = await cleanText(file, fs.readFileSync(abs, "utf8"), kinds);
          if (removed) {
            fs.writeFileSync(abs, text);
            total += removed;
            console.log(`  ${file}: ${removed}`);
            if (kinds.includes("ia")) resueltos += resolveMissing(estado, file, new Set());
          }
        }
        saveEstado(root, estado);
        console.log(`✓ ${total} comentarios borrados.${resueltos ? ` ${resueltos} hilo(s) registrados como resueltos en tu perfil.` : ""}`);
        return 0;
      }
      if (sub && !sub.startsWith("-")) {
        const rel = path.relative(root, path.resolve(sub));
        const r = await runGuia(root, rel, (l) => console.log(l));
        console.log(`✓ ${r.respondidos} hilo(s) respondido(s)${r.resueltos ? `, ${r.resueltos} resuelto(s)` : ""}${r.costoUsd ? ` · US$${r.costoUsd.toFixed(3)}` : ""}`);
        for (const a of r.avisos) console.log(`  ! ${a}`);
        if (!r.respondidos && !r.resueltos) console.log("  (no hay @ia? ni @yo: pendientes en este archivo)");
        return 0;
      }
      break;
    }
    case "expandir": {
      if (!sub) throw new Error("uso: cai expandir <archivo> [--linea N] [--vscode]");
      const rel = path.relative(root, path.resolve(sub));
      const li = rest.indexOf("--linea");
      const linea = li >= 0 ? Number(rest[li + 1]) : undefined;
      const src = fs.readFileSync(path.join(root, rel), "utf8");
      const exps = await planExpansion(root, rel, src, linea, rest.includes("--vscode") ? "vscode" : "texto");
      if (rest.includes("--vscode")) {
        process.stdout.write(JSON.stringify(exps.map((e) => ({ desde: e.desde, hasta: e.hasta, texto: e.texto, nombre: e.snippet.nombre }))));
        return 0;
      }
      if (!exps.length) {
        console.log(linea ? `(no hay un pedido de snippet en la línea ${linea})` : "(no hay comentarios // @snippet: en este archivo)");
        return 0;
      }
      fs.writeFileSync(path.join(root, rel), aplicarExpansion(src, exps));
      for (const e of exps) console.log(`✓ línea ${e.desde}: ${e.snippet.nombre} (${e.snippet.origen})`);
      return 0;
    }
    case "snippet": {
      if (sub === "cuerpo") {
        // cai snippet cuerpo <archivo> "<nombre clave=valor ...>" → el snippet en formato VSCode (con huecos)
        const [archivo, llamadaTxt] = rest;
        const lang = archivo ? langFor(archivo) : null;
        const ll = llamadaTxt ? parseLlamada(llamadaTxt) : null;
        if (!lang || !ll) throw new Error('uso: cai snippet cuerpo <archivo> "<nombre clave=valor>"');
        const sn = paraLenguaje(biblioteca(root), lang.id).find((x) => x.nombre === ll.nombre);
        if (!sn) throw new Error(`no existe el snippet "${ll.nombre}" para ${lang.id}`);
        process.stdout.write(JSON.stringify({ nombre: sn.nombre, cuerpo: expandir(sn.body, ll.args, "vscode", archivo) }));
        return 0;
      }
      if (sub === "lista") {
        const archivo = rest.find((a) => !a.startsWith("--"));
        const lang = archivo ? langFor(archivo) : null;
        const lib = lang ? paraLenguaje(biblioteca(root), lang.id) : biblioteca(root);
        if (rest.includes("--json")) {
          process.stdout.write(JSON.stringify(lib.map((x) => ({ nombre: x.nombre, descripcion: x.descripcion, origen: x.origen, body: x.body.join("\n") }))));
          return 0;
        }
        for (const s of lib) console.log(`${s.nombre.padEnd(16)} ${s.descripcion.padEnd(48)} [${s.origen}${s.scopes.length ? ` · ${s.scopes.slice(0, 2).join(",")}` : ""}]`);
        console.log("\nUso: // @snippet: <nombre> arg=valor   y luego Ctrl+Alt+E (o cai expandir <archivo>)");
        return 0;
      }
      if (sub !== "nuevo" || !rest[0]) throw new Error("uso: cai snippet nuevo <nombre> [--archivo f --lineas a-b] [--lenguaje id]");
      const opt = (k: string) => {
        const i = rest.indexOf(k);
        return i >= 0 ? rest[i + 1] : undefined;
      };
      const lineas = opt("--lineas")?.split("-").map(Number) as [number, number] | undefined;
      const archivo = opt("--archivo");
      const lenguaje = opt("--lenguaje");
      const { file, body } = crearSnippet(root, { nombre: rest[0], ...(archivo ? { archivo } : {}), ...(lineas ? { lineas } : {}), ...(lenguaje ? { lenguaje } : {}) });
      console.log(`✓ snippet "${rest[0]}" creado en ${path.relative(root, file)} (${body.length} líneas).`);
      console.log("  Ahora reemplazá lo que cambia cada vez por ${1:nombre}, ${2:otro}... y usalo escribiendo el prefix + Tab.");
      return 0;
    }
    case "revisar": {
      if (!sub) throw new Error("uso: cai revisar <archivo>");
      const rel = path.relative(root, path.resolve(sub));
      const soloI = rest.indexOf("--solo");
      const r = await runReview(root, rel, {
        sinIa: rest.includes("--sin-ia"),
        todo: rest.includes("--todo"),
        ediciones: rest.includes("--ediciones"),
        ...(soloI >= 0 && rest[soloI + 1] ? { solo: rest[soloI + 1]!.split(",") } : {}),
        log: rest.includes("--json") ? () => {} : (l) => console.log(l),
      });
      if (rest.includes("--json")) {
        process.stdout.write(JSON.stringify(r));
        return 0;
      }
      for (const c of r.corridas) console.log(`  ${c.estado === "ok" ? "✓" : c.estado === "con hallazgos" ? "✗" : "·"} ${c.tool}: ${c.estado}${c.detalle ? ` (${c.detalle})` : ""}`);
      console.log(`✓ ${r.insertados} comentario(s) de revisión agregados (${r.bloqueantes} bloqueante(s))${r.costoUsd ? ` · US$${r.costoUsd.toFixed(3)}` : ""}`);
      for (const o of r.omitidos) console.log(`  ! ${o}`);
      return 0;
    }
    case "gate": {
      const files = rest.includes("--staged") || sub === "--staged"
        ? stagedFiles(root).map((f) => f.file)
        : [sub, ...rest].filter((a): a is string => !!a && !a.startsWith("--")).map((f) => path.relative(root, path.resolve(f)));
      const flags = [sub, ...rest];
      if (flags.includes("--staged") && !files.length) {
        console.log("✓ nada para verificar en lo preparado (staged)");
        return 0;
      }
      const r = runGate(root, files.length ? files : targetFiles(root, []), {
        ...(flags.includes("--rapido") ? { solo: ["tipos", "lint", "reglas"] } : {}),
        ...(flags.includes("--mutacion") ? { mutacion: true } : {}),
      });
      for (const c of r.corridas) console.log(`${c.estado === "ok" ? "✓" : c.estado === "con hallazgos" ? "✗" : "·"} ${c.tool}: ${c.estado}${c.detalle ? ` (${c.detalle})` : ""}`);
      for (const d of r.diags) console.log(`  ${d.file}:${d.line}  [${d.tool}${d.code ? ` ${d.code}` : ""}] ${d.msg}`);
      const bloq = r.diags.filter((d) => d.bloqueante).length;
      if (bloq) console.error(`\n✗ ${bloq} problema(s) bloqueante(s).`);
      return bloq ? 1 : 0;
    }
    case "predecir": {
      if (!sub) throw new Error("uso: cai predecir <archivo>");
      const r = await runPredecir(root, path.relative(root, path.resolve(sub)));
      console.log(`✓ ${r.creadas} pregunta(s) de predicción agregadas · US$${r.costoUsd.toFixed(3)}`);
      for (const a of r.avisos) console.log(`  ! ${a}`);
      return 0;
    }
    case "check": {
      if (!sub) throw new Error("uso: cai check <archivo>");
      const r = await runCheck(root, path.relative(root, path.resolve(sub)));
      console.log(`✓ ${r.correctas} correcta(s), ${r.incorrectas} incorrecta(s), ${r.pendientes} sin responder o sin calificar`);
      for (const a of r.avisos) console.log(`  ! ${a}`);
      return 0;
    }
    case "doctor": {
      if (sub === "--instalar") instalar(root);
      const checks = doctor(root);
      for (const c of checks) console.log(`${c.ok === true ? "✓" : c.ok === "aviso" ? "·" : "✗"} ${c.que}${c.ok !== true && c.arreglo ? `\n    → ${c.arreglo}` : ""}`);
      return checks.some((c) => c.ok === false) ? 1 : 0;
    }
    case "explica": {
      const cmdArgs = argv.slice(argv.indexOf("--") + 1);
      if (!argv.includes("--") || !cmdArgs.length) throw new Error("uso: cai explica -- <comando>");
      console.log(await explica(root, cmdArgs.join(" ")));
      return 0;
    }
    case "pregunta": {
      const i = argv.indexOf("--intente");
      console.log(
        await pregunta(root, argv.slice(1).filter((a, k) => !a.startsWith("--") && !(i >= 0 && k + 1 === i + 1)).join(" "), {
          mas: argv.includes("--mas"),
          ...(i >= 0 && argv[i + 1] ? { intente: argv[i + 1] } : {}),
        }),
      );
      return 0;
    }
    case "corre": {
      const cmdArgs = argv.slice(argv.indexOf("--") + 1);
      if (!argv.includes("--") || !cmdArgs.length) throw new Error("uso: cai corre -- <comando>");
      return corre(process.cwd(), cmdArgs);
    }
    case "error":
      console.log(await error(process.cwd()));
      return 0;
    case "shell":
      console.log(SHELL_SNIPPET);
      return 0;
    case "arquitectura": {
      const tema = argv.slice(1).join(" ");
      if (!tema) throw new Error('uso: cai arquitectura "<qué hay que decidir>"');
      const r = await arquitectura(root, tema);
      console.log(`✓ ${path.relative(root, r.file)} creado con preguntas y opciones como comentarios @guia · US$${r.costoUsd.toFixed(3)}\n  Escribí vos el contexto, la decisión y las consecuencias. Para seguir: cai guia ${path.relative(root, r.file)}`);
      return 0;
    }
    case "adr": {
      if (sub !== "nuevo" || !rest.length) throw new Error('uso: cai adr nuevo "<título>"');
      console.log(`✓ ${path.relative(root, nuevoAdr(root, rest.join(" ")))}`);
      return 0;
    }
    case "responder": {
      // cai responder <archivo> (--nota <id> | --linea <n> | --archivo-entero) [--pedido pseudo] [--texto "..."] [--seleccion "..."] [--json]
      if (!sub) throw new Error('uso: cai responder <archivo> (--nota <id> | --linea <n>) [--pedido pista|piezas|pseudo|ejemplo|plano|snippet|tests|explica] [--texto "..."]');
      const opt = (k: string) => (rest.includes(k) ? rest[rest.indexOf(k) + 1] : undefined);
      const json = rest.includes("--json");
      try {
        const r = await responderNota(
          root,
          {
            archivo: path.relative(root, path.resolve(sub)),
            ...(opt("--nota") ? { notaId: opt("--nota")! } : {}),
            ...(opt("--linea") ? { linea: Number(opt("--linea")) } : {}),
            ...(opt("--pedido") ? { pedido: opt("--pedido")! } : {}),
            ...(opt("--texto") ? { texto: opt("--texto")! } : {}),
            ...(opt("--seleccion") ? { seleccion: opt("--seleccion")! } : {}),
            ...(rest.includes("--archivo-entero") ? { archivoEntero: true } : {}),
          },
          json ? () => {} : (l) => console.log(l),
        );
        if (json) process.stdout.write(JSON.stringify({ nota: r.nota, costoUsd: r.costoUsd }));
        else console.log(`✓ nota ${r.nota.id} (${r.nota.archivo}:${r.nota.ancla.linea}) · ${r.nota.titulo}\n${r.nota.hilo[r.nota.hilo.length - 1]?.texto ?? ""}`);
        return 0;
      } catch (e) {
        if (json && e instanceof OcupadoError) {
          process.stdout.write(JSON.stringify({ mensaje: e.message, ocupado: true }));
          return 3;
        }
        throw e;
      }
    }
    case "notas": {
      // cai notas [<archivo>|--todas] [--json] · cai notas resolver <archivo> <id> · cai notas importar <archivo>
      if (sub === "resolver") {
        const [archivo, id] = rest;
        if (!archivo || !id) throw new Error("uso: cai notas resolver <archivo> <id>");
        const rel = path.relative(root, path.resolve(archivo));
        const notas = cargarNotas(root, rel);
        const n = notas.find((x) => x.id === id);
        if (!n) throw new Error(`no existe la nota ${id}`);
        n.estado = "resuelta";
        n.actualizada = new Date().toISOString();
        guardarNotas(root, rel, notas);
        console.log(`✓ ${id} resuelta`);
        return 0;
      }
      if (sub === "importar") {
        if (!rest[0]) throw new Error("uso: cai notas importar <archivo>");
        const rel = path.relative(root, path.resolve(rest[0]));
        const abs = path.join(root, rel);
        const src = fs.readFileSync(abs, "utf8");
        const guias = await conversation(rel, src, ["guia"]);
        const grupos = new Map<string, typeof guias>();
        for (const c of guias) {
          const id = /^@guia\[([\w-]+)\./.exec(c.content)?.[1] ?? c.content.slice(0, 12);
          grupos.set(id, [...(grupos.get(id) ?? []), c]);
        }
        const notas = cargarNotas(root, rel, src);
        const lineas = src.split(/\r?\n/);
        for (const [, cs] of grupos) {
          let l = cs[cs.length - 1]!.row + 2;
          while (l <= lineas.length && /^\s*(\/\/|#|--|\/\*|\*|<!--|$)/.test(lineas[l - 1]!)) l++;
          const texto = cs.map((c) => c.content.replace(/^@guia\[[^\]]*\]\s*/, "")).join("\n");
          const tipo = /^(\w+)/.exec(texto)?.[1] ?? "nota";
          nuevaNota(notas, { archivo: rel, ancla: { linea: Math.min(l, lineas.length), texto: (lineas[l - 1] ?? "").trim() }, tipo, titulo: texto.replace(/^\w+( \[.\])?:\s*/, "").slice(0, 60), origen: "importada", hilo: [mensaje("ia", texto)] });
        }
        guardarNotas(root, rel, notas);
        const { text, removed } = await cleanText(rel, src, ["guia"]);
        if (removed) fs.writeFileSync(abs, text);
        console.log(`✓ ${grupos.size} nota(s) importadas; ${removed} comentario(s) @guia quitados de ${rel}`);
        return 0;
      }
      const lista = sub && sub !== "--todas" && sub !== "--json" ? cargarNotas(root, path.relative(root, path.resolve(sub))) : todasLasNotas(root);
      if ([sub, ...rest].includes("--json")) {
        process.stdout.write(JSON.stringify(lista));
        return 0;
      }
      const abiertas = lista.filter((n) => n.estado === "abierta");
      for (const n of abiertas) console.log(`${n.bloqueante ? "⚠" : "·"} ${n.archivo}:${n.ancla.linea}${n.desanclada ? " (desanclada)" : ""}  [${n.id}] ${n.titulo}${n.accion ? `\n    → ${n.accion}` : ""}`);
      if (!abiertas.length) console.log("(sin notas abiertas)");
      return 0;
    }
    case "memoria": {
      // cai memoria [--json] · cai memoria responder <n> "<respuesta>"  (las preguntas que la IA te hizo)
      if (sub === "responder") {
        const n = Number(rest[0]);
        const r = rest.slice(1).join(" ").trim();
        if (!Number.isInteger(n) || n < 1 || !r) throw new Error('uso: cai memoria responder <número de pregunta> "<respuesta>" (los números salen en: cai memoria)');
        const p = responderPregunta(root, n, r);
        console.log(`✓ Anotado en la memoria del proyecto: ${p} → ${r}`);
        return 0;
      }
      const abiertas = preguntasAbiertas(root);
      if (argv.includes("--json")) {
        process.stdout.write(JSON.stringify({ abiertas, respondidas: leerMemoria(path.join(dataDir(root), "conocimiento.md")).respondidas }));
        return 0;
      }
      for (const a of abiertas) console.log(`${a.n}. ${a.pregunta}${a.sugerencia ? `\n   (sugerencia: ${a.sugerencia})` : ""}`);
      if (!abiertas.length) console.log("(sin preguntas abiertas)");
      else console.log('\nResponde con: cai memoria responder <n> "<tu respuesta>"');
      return 0;
    }
    case "siguiente": {
      const pasos = await siguiente(root);
      const ocup = enCurso(root);
      if (argv.includes("--json")) {
        process.stdout.write(JSON.stringify({ pasos, ocupado: ocup }));
        return 0;
      }
      for (const o of ocup) console.log(`⏳ La IA está ${o.tarea}${o.archivo !== "__proyecto__" ? ` en ${o.archivo}` : ""}`);
      const p = pasos[0];
      if (!p) console.log("✓ Nada pendiente. Sigue con tu plan o pide un panorama (cai panorama).");
      else {
        console.log(`▶ ${p.accion}${p.archivo ? `  (${p.archivo}${p.linea ? `:${p.linea}` : ""})` : ""}\n  ${p.titulo}`);
        if (pasos.length > 1) console.log(`\nDespués:\n${pasos.slice(1, 6).map((x) => `  · ${x.accion}${x.archivo ? ` (${x.archivo}${x.linea ? `:${x.linea}` : ""})` : ""}`).join("\n")}`);
      }
      return 0;
    }
    case "tareas": {
      const tareas = cargarTareas(root);
      if (sub === "hecha" || sub === "pendiente") {
        const t = tareas.find((x) => x.id === rest[0]);
        if (!t) throw new Error(`no existe la tarea ${rest[0]}`);
        t.hecha = sub === "hecha";
        guardarTareas(root, tareas);
        console.log(`✓ ${t.id}: ${t.hecha ? "hecha" : "pendiente"}`);
        return 0;
      }
      if (argv.includes("--json")) {
        process.stdout.write(JSON.stringify(tareas));
        return 0;
      }
      for (const t of tareas) console.log(`${t.hecha ? "☑" : "☐"} [${t.id}] ${t.titulo}`);
      if (!tareas.length) console.log("(sin tareas: salen del plano de cada archivo y del panorama)");
      return 0;
    }
    case "acompanar": {
      if (!sub) throw new Error("uso: cai acompanar <archivo>");
      const json = rest.includes("--json");
      const r = await acompanar(root, path.relative(root, path.resolve(sub)), json ? () => {} : (l) => console.log(l));
      if (json) {
        process.stdout.write(JSON.stringify(r));
        return 0;
      }
      for (const a of r.acciones) console.log(`✓ ${a.tipo}: ${a.detalle}`);
      if (!r.acciones.length) console.log("(nada que hacer: vas bien)");
      if (r.costoUsd) console.log(`  · US$${r.costoUsd.toFixed(3)}`);
      return 0;
    }
    case "plano": {
      if (argv.includes("--archivo")) {
        const f = argv[argv.indexOf("--archivo") + 1];
        if (!f) throw new Error("uso: cai plano --archivo <archivo>");
        const r = await planoArchivo(root, path.relative(root, path.resolve(f)));
        console.log(`✓ plano de ${f}: ${r.notas} nota(s), ${r.tareas} tarea(s) nueva(s) · US$${r.costoUsd.toFixed(3)}`);
        return 0;
      }
      const desc = argv.slice(1).join(" ").trim();
      const r = await planoProyecto(root, desc || undefined);
      console.log(`✓ ${path.relative(root, r.file)} con la propuesta de arquitectura${r.tareas ? ` · ${r.tareas} archivo(s) por crear en tus tareas` : ""} · US$${r.costoUsd.toFixed(3)}\n  Edítalo con lo que decidas; en VSCode la ves en el panel → Proyecto → Estructura.`);
      return 0;
    }
    case "conocer": {
      const tty = process.stdin.isTTY && !argv.includes("--sin-preguntas");
      const rl = tty ? createInterface({ input: process.stdin, output: process.stdout }) : null;
      try {
        const r = await conocer(root, { log: (l) => console.log(l), ...(rl ? { preguntar: (t: string) => rl.question(t) } : {}) });
        console.log(`\n${r.resumen}`);
        for (const e of r.escritos) console.log(`✓ ${e}`);
        if (r.autoriaAplicada.length) console.log(`  marcado: ${r.autoriaAplicada.map((a) => `${a.glob} (${a.tipo})`).join(", ")}`);
        if (!rl && r.autoriaSugerida.length) console.log(`  sugerencia de autoría (agrégala en .cai/config.json → autoria): ${r.autoriaSugerida.map((a) => `${a.glob} → ${a.tipo}`).join(", ")}`);
        if (r.pendientes) console.log(`  ${r.pendientes} pregunta(s) para responder en .cai/conocimiento.md (después de "R:")`);
        if (r.escritos.some((e) => e.includes(".borrador."))) console.log("  Como ya tenías contenido, dejé borradores (*.borrador.md) para que combines lo que quieras.");
        console.log(`  · US$${r.costoUsd.toFixed(3)}`);
      } finally {
        rl?.close();
      }
      return 0;
    }
    case "origen": {
      const z0 = makeZoner(root);
      const archivos = listFiles(z0);
      const { autoria, resumen } = sugerirAutoria(root, archivos);
      const cfg = loadConfig(root);
      console.log(`Autoría (${resumen})`);
      console.log(`  heredado: ${cfg.autoria.heredado.join(", ") || "(nada)"}`);
      console.log(`  terceros: ${cfg.autoria.terceros.join(", ") || "(nada)"}`);
      const nuevas = autoria.filter((a) => !cfg.autoria[a.tipo].includes(a.glob));
      if (nuevas.length) {
        console.log("\nSugerencias (sin IA, según git y nombres de carpeta):");
        for (const a of nuevas) console.log(`  ${a.glob} → ${a.tipo}: ${a.motivo}`);
        console.log('\nPara aplicarlas: .cai/config.json → "autoria": { "heredado": [...], "terceros": [...] }  (o cai conocer)');
      }
      const ejemplo = archivos.filter((f) => langFor(f)).slice(0, 5);
      if (ejemplo.length) console.log(`\nEjemplo: ${ejemplo.map((f) => `${f} = ${origenDe(cfg, f)}`).join(", ")}`);
      return 0;
    }
    case "panorama": {
      const r = await panorama(root, { sinIa: argv.includes("--sin-ia"), log: (l) => console.log(l) });
      for (const l of r.resumen) console.log(`· ${l}`);
      console.log(`✓ ${path.relative(root, r.archivo)}${r.costoUsd ? ` · US$${r.costoUsd.toFixed(3)}` : ""}`);
      return 0;
    }
    case "tests": {
      if (!sub) throw new Error("uso: cai tests <archivo> [función]");
      const r = await proponerTests(root, path.relative(root, path.resolve(sub)), rest.find((a) => !a.startsWith("--")));
      console.log(`✓ ${r.casos} caso(s) propuestos en ${r.archivo}${r.preguntas ? ` (${r.preguntas} con pregunta para ti)` : ""} · US$${r.costoUsd.toFixed(3)}`);
      for (const d of r.descartados) console.log(`  ! descartado: ${d}`);
      console.log("  Revisa cada caso, ajusta el valor esperado y márcalo [x] (se convierte en test al guardar o con Ctrl+Alt+E).");
      return 0;
    }
    case "uso": {
      const di = argv.indexOf("--dias");
      const dias = di >= 0 ? Number(argv[di + 1]) || 7 : 7;
      const uso = leerUso(dias);
      const llamadas = uso.filter((u) => u.tipo === "llamada");
      const evitadas = uso.filter((u) => u.tipo === "evitada");
      const sum = (k: "entrada" | "salida" | "cacheLeida" | "cacheCreada" | "costo", xs = llamadas) => xs.reduce((a, u) => a + (u[k] ?? 0), 0);
      const fmt = (n: number) => n.toLocaleString("es-CL");
      console.log(`Uso de IA, últimos ${dias} días`);
      console.log(`  ${llamadas.length} llamadas · US$${sum("costo").toFixed(2)} (estimado) · tokens: ${fmt(sum("entrada") + sum("cacheLeida") + sum("cacheCreada"))} de entrada, ${fmt(sum("salida"))} de salida`);
      const totalIn = sum("entrada") + sum("cacheLeida") + sum("cacheCreada");
      if (totalIn) console.log(`  caché de prompts: ${Math.round((100 * sum("cacheLeida")) / totalIn)}% de la entrada se leyó de caché (más barato)`);
      const porKind = new Map<string, typeof llamadas>();
      for (const u of llamadas) porKind.set(u.kind.split(":")[0]!, [...(porKind.get(u.kind.split(":")[0]!) ?? []), u]);
      if (porKind.size) console.log("\n  por comando:");
      for (const [k, xs] of [...porKind].sort((a, b) => sum("costo", b[1]) - sum("costo", a[1])))
        console.log(`    ${k.padEnd(12)} ${String(xs.length).padStart(4)} llamadas  US$${sum("costo", xs).toFixed(3).padStart(7)}  ${fmt(Math.round(sum("salida", xs) / xs.length))} tokens de salida/llamada`);
      const modelos = new Map<string, number>();
      for (const u of llamadas) for (const m of u.modelos ?? []) modelos.set(m, (modelos.get(m) ?? 0) + 1);
      if (modelos.size) console.log(`\n  modelos: ${[...modelos].map(([m, n]) => `${m} (${n})`).join(", ")}`);
      if (evitadas.length) {
        console.log(`\n  ${evitadas.length} veces se evitó llamar a la IA o se mandó menos:`);
        const motivos = new Map<string, number>();
        for (const u of evitadas) motivos.set(`${u.kind}: ${u.motivo}`, (motivos.get(`${u.kind}: ${u.motivo}`) ?? 0) + 1);
        for (const [m, n] of [...motivos].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`    ${String(n).padStart(4)}× ${m}`);
      }
      if (!uso.length) console.log("  (sin registros todavía)");
      return 0;
    }
    case "watch":
      watch(root);
      await new Promise(() => {});
      return 0;
    case "perfil": {
      if (sub === "set") {
        const [tema, nivel] = rest;
        if (!tema || !["aprendiz", "intermedio", "experto"].includes(nivel ?? "")) throw new Error("uso: cai perfil set <tema> aprendiz|intermedio|experto");
        declarar(tema, nivel as Nivel);
        console.log(`✓ ${tema}: ${nivel}`);
        return 0;
      }
      const p = loadPerfil();
      const temas = Object.entries(p.temas).sort((a, b) => b[1].puntaje - a[1].puntaje);
      if (!temas.length) console.log("Perfil vacío. Declará lo que sabés: cai perfil set typescript experto");
      for (const [t, v] of temas) console.log(`${t.padEnd(24)} ${nivelDe(v.puntaje).padEnd(11)} ${v.puntaje.toFixed(2)}  (${v.eventos} eventos${v.declarado ? `, declarado ${v.declarado}` : ""})`);
      const pat = Object.entries(loadPatrones()).sort((a, b) => b[1].veces - a[1].veces);
      if (pat.length) {
        console.log("\nErrores frecuentes:");
        for (const [k, v] of pat.slice(0, 10)) console.log(`  ${String(v.veces).padStart(3)}× ${k}`);
      }
      return 0;
    }
    case "selftest":
      return (await runSelftest()) ? 0 : 1;
    case undefined:
    case "help":
    case "--help":
      console.log(HELP);
      return 0;
  }
  console.error(HELP);
  return 2;
}

/** Qué está haciendo la IA (para el bloqueo y la barra de estado de la extensión). */
const TAREA: Record<string, string> = {
  guia: "respondiendo tus preguntas",
  revisar: "revisando",
  predecir: "preparando predicciones",
  check: "comprobando predicciones",
  tests: "proponiendo tests",
  panorama: "mirando el proyecto completo",
  conocer: "conociendo el proyecto",
  plano: "armando el plano",
  arquitectura: "preparando la decisión de arquitectura",
};

/** Un pedido a la vez por archivo (o por proyecto): si ya hay uno en curso, se avisa y no se pisa. */
async function main(argv: string[]): Promise<number> {
  const [cmd, sub] = argv;
  const root = projectRoot();
  const relDe = (f: string) => path.relative(root, path.resolve(f));
  let objetivo: string | null = null;
  if (cmd === "guia" && sub && !["list", "clean", "check"].includes(sub)) objetivo = relDe(sub);
  else if (["revisar", "predecir", "check", "tests"].includes(cmd ?? "") && sub) objetivo = relDe(sub);
  else if (cmd === "plano" && argv.includes("--archivo")) objetivo = relDe(argv[argv.indexOf("--archivo") + 1] ?? ".");
  else if (["panorama", "conocer", "plano", "arquitectura"].includes(cmd ?? "")) objetivo = "__proyecto__";
  if (!objetivo) return ejecutar(argv);
  const r = await ocuparEsperando(root, objetivo, TAREA[cmd!] ?? cmd!);
  if (!r.ok) {
    const msg = `ya estoy ${r.por.tarea}${r.por.archivo !== "__proyecto__" ? ` en ${r.por.archivo}` : ""} (desde hace ${Math.round((Date.now() - Date.parse(r.por.desde)) / 1000)} s); espera a que termine`;
    if (argv.includes("--json")) process.stdout.write(JSON.stringify({ ocupado: r.por, mensaje: msg }));
    else console.error(`cai: ${msg}`);
    return 3;
  }
  try {
    return await ejecutar(argv);
  } finally {
    r.liberar();
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`cai: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  },
);
