#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { CommentKind } from "./comments.js";
import { makeZoner } from "./config.js";
import { listFiles } from "./files.js";
import { cleanText, conversation } from "./guia.js";
import { runHook, type HookInput } from "./hook.js";
import { init, KEYBINDINGS, refrescarClaudeMd } from "./init.js";
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
import { verificar } from "./verificar.js";
import { servir } from "./servir.js";
import { deuda, hoy, resumenSesion } from "./resumenSesion.js";
import { aplicarPropuesta, borrarConversacion, cargarConversacion, crearConversacion, conversar as conversarProyecto, elegirModelo, listarConversaciones, type Tamano } from "./chat.js";
import { revisarCompleto } from "./revisionCompleta.js";
import { actualizarIndice, leerIndice, lineaIndice } from "./indice.js";
import { cargarDecisiones, decidir, proponerDecisiones, retractar } from "./decisiones.js";
import { esModo, migrarModos, MODOS, modoEfectivo } from "./modos.js";
import { funcionesDe, funcionPorClave } from "./notasFuncion.js";
import { rapida } from "./rapida.js";
import { cargarDialogos, conversar, olvidarDialogo } from "./dialogo.js";
import { correrTests, probarCasos, proponerTests, recorrerCasos } from "./tests.js";
import { estadoPanorama, leerMemoria, panorama, preguntasAbiertas, responderPregunta } from "./panorama.js";
import { conBloqueo, enCurso, OcupadoError, ocuparEsperando } from "./ocupado.js";
import { responderNota } from "./responder.js";
import { cargarNotas, guardarNotas, nuevaNota, mensaje, todasLasNotas } from "./notas.js";
import { cargarCorrecciones, corregir, quitarCorreccion } from "./correcciones.js";
import { proponerCorreccion } from "./confirmar.js";
import { entenderFuncion, marcarObjetivo } from "./objetivoFuncion.js";
import { definirContrato, descartarPropuesta, deudaComprension, editarPlan, leerPropuesta, medicion, pasoDirigido, pendienteDiferida, planFuncion, probarDiferida, probarPorcion, propuestaPR, registrarInsercion } from "./programar.js";
import { borrarDeRepertorio, cargarRepertorio, dirRepertorio, politica } from "./repertorio.js";
import { cargarIdeas, descartarIdea, ideaATarea, masIdeas } from "./ideas.js";
import { confirmarObjetivos, darPorTerminado, leerEvaluacion, leerObjetivos, objetivosMd, reabrirObjetivos } from "./entender.js";
import { aplicarCambioTarea, cargarTareas, guardarTareas, siguiente, actualizarTareas, agregarTareas, type CambioTarea } from "./siguiente.js";
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
  cai hoy [--marcar]              qué cambió desde tu última visita (sin IA)
  cai deuda                      lo pendiente por archivo: notas, tests apagados, sin tests, decisiones
  cai sesion [--desde hoy]       resumen de la sesión + mensaje de commit sugerido (lo usas tú)
  cai chat --texto "…"           chat del proyecto (lee el proyecto, conoce estructura, índice y decisiones)
  cai indice [actualizar [archivo]]   mapa de funciones (estado, tests, quién llama a quién), sin IA
  cai decisiones [decidir <id> "<opción>" | retractar <id>]   lo que decidiste (la IA lo respeta; se puede retractar)
  cai servir                      proceso abierto para la extensión (sugerencias rápidas sin esperar el arranque)
  cai actividad [--n 20]          qué hizo la IA (hora, qué, archivo, modelo, costo, tiempo)
  cai modo [sugerir|aprender|programar|heredar] [--archivo f | --funcion f:nombre | --carpeta glob]
                                    modo de trabajo (gana función > archivo > carpeta > proyecto); no toca lo ya hecho
  cai rapida <archivo> --linea N  pista de una línea donde estás (VSCode la muestra en gris)
  cai verificar <archivo> [--funcion X]  "¿quedó lista?": sin IA primero; lista → cierra la nota, si no deja mejoras
  cai notas [<archivo>|--todas]  notas abiertas · cai notas resolver <archivo> <id> · cai notas importar <archivo>
  cai tareas [hecha|pendiente|descartar <id>]  tareas del plano, la estructura y el panorama
                                    (las hechas se archivan solas al día siguiente)
  cai memoria [responder <n> "..."]  preguntas que la IA te hizo sobre el proyecto (y tus respuestas)
  cai memoria conversar <n> --texto "..."  preguntarle a la IA sobre su pregunta antes de responder
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
      if (argv.includes("--solo-claude")) {
        // Solo actualiza las instrucciones de Claude Code (sección ComplementAIry del CLAUDE.md).
        const target = path.resolve(sub && !sub.startsWith("--") ? sub : ".");
        const c = refrescarClaudeMd(target);
        console.log(c.length ? `✓ ${c.join(" · ")}` : "✓ CLAUDE.md ya estaba al día");
        return 0;
      }
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
          `  1. Completa .cai/proyecto.md y .cai/reglas.md con tus palabras (o, con código ya escrito: cai conocer; en VSCode, el panel te guía).\n` +
          `  2. Declara lo que sabes: cai perfil set typescript experto (aprendiz | intermedio | experto)\n` +
          `  3. Atajos: instala la extensión de VSCode o pega esto en tus keybindings.json\n` +
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
      if (rest.includes("--completo")) {
        // Revisión + "¿quedó lista?" de cada función + tests + veredicto del archivo.
        const r = await revisarCompleto(root, rel, rest.includes("--json") ? () => {} : (l) => console.log(l));
        if (rest.includes("--json")) process.stdout.write(JSON.stringify(r));
        else console.log(`${{ lista: "🟢", casi: "🟡", falta: "🔴" }[r.veredicto.estado]} ${rel}: ${r.veredicto.listas}/${r.veredicto.total} funciones listas${r.veredicto.testsFallan ? ` · ${r.veredicto.testsFallan} tests fallan` : ""} · US$${r.costoUsd.toFixed(3)}`);
        return 0;
      }
      const soloI = rest.indexOf("--solo");
      const r = await runReview(root, rel, {
        sinIa: rest.includes("--sin-ia"),
        todo: rest.includes("--todo"),
        ediciones: rest.includes("--ediciones"),
        otraMirada: rest.includes("--otra-mirada"),
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
      if (sub === "anotar") {
        // cai notas anotar <archivo> <id> --texto "..."   (lo usa la extensión: "insertaste el snippet X en la línea N")
        const [archivo, id] = rest;
        const t = rest.includes("--texto") ? rest[rest.indexOf("--texto") + 1] : undefined;
        if (!archivo || !id || !t) throw new Error('uso: cai notas anotar <archivo> <id> --texto "..."');
        const rel = path.relative(root, path.resolve(archivo));
        // Con el archivo tomado: no pisa una respuesta que se esté guardando a la vez.
        await conBloqueo(root, rel, "anotando", async () => {
          const notas = cargarNotas(root, rel);
          const n = notas.find((x) => x.id === id);
          if (!n) throw new Error(`no existe la nota ${id} en ${rel}`);
          n.hilo.push(mensaje("tu", t, { kind: "registro" }));
          n.actualizada = new Date().toISOString();
          guardarNotas(root, rel, notas);
        });
        console.log(`✓ anotado en ${id}`);
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
    case "hoy": {
      // Qué cambió desde tu última visita (sin IA). --marcar: esta visita pasa a ser la referencia.
      const h = hoy(root, argv.includes("--marcar"));
      if (argv.includes("--json")) {
        process.stdout.write(JSON.stringify(h));
        return 0;
      }
      if (h.desde) console.log(`Desde ${h.desde.slice(0, 16).replace("T", " ")}:`);
      if (h.cambiadas.length) console.log(`  cambiaron: ${h.cambiadas.join(", ")}`);
      if (h.nuevas.length) console.log(`  nuevas: ${h.nuevas.join(", ")}`);
      if (h.empezaronAFallar.length) console.log(`  ❌ empezaron a fallar sus tests: ${h.empezaronAFallar.join(", ")}`);
      if (h.decisionesPendientes) console.log(`  ❓ ${h.decisionesPendientes} decisión(es) esperan que elijas`);
      for (const c of h.conviene) console.log(`  · ${c}`);
      if (h.diferida) console.log(`  🎯 prueba diferida: ${h.diferida.funcion.replace(/#\d+$/, "")} (${h.diferida.archivo}), la insertaste desde una propuesta: ¿qué devuelve con otra entrada?`);
      if (h.creeTerminado) console.log("  🏁 Cree que el proyecto cumple todos sus criterios de terminado: cai entender (y, si estás de acuerdo, cai entender terminado)");
      return 0;
    }
    case "deuda": {
      const d = deuda(root);
      if (argv.includes("--json")) {
        process.stdout.write(JSON.stringify(d));
        return 0;
      }
      for (const [rel, x] of Object.entries(d))
        console.log(`${rel}: ${x.notasAbiertas} nota(s)${x.bloqueantes ? ` (${x.bloqueantes} bloqueantes)` : ""} · ${x.testsApagados} test(s) apagados · ${x.sinTests.length ? `sin tests: ${x.sinTests.join(", ")}` : "todas con tests"}${x.decisionesPendientes ? ` · ${x.decisionesPendientes} decisión(es)` : ""}${x.sinEntender?.length ? ` · ⚠ sin entender (insertadas sin probar): ${x.sinEntender.join(", ")}` : ""}`);
      if (!Object.keys(d).length) console.log("✓ sin deuda pendiente");
      return 0;
    }
    case "sesion": {
      // cai sesion [--desde ISO|hoy] [--sin-ia] [--json]: resumen de lo hecho + commit sugerido (lo usas tú)
      const desdeArg = argv.includes("--desde") ? argv[argv.indexOf("--desde") + 1] : "hoy";
      const fecha = !desdeArg || desdeArg === "hoy" ? new Date(new Date().setHours(0, 0, 0, 0)) : new Date(desdeArg);
      if (Number.isNaN(fecha.getTime())) throw new Error(`--desde "${desdeArg}" no es una fecha válida: usa "hoy" o una fecha como 2026-10-09 o 2026-10-09T14:30`);
      const desde = fecha.toISOString();
      const r = await resumenSesion(root, desde, argv.includes("--sin-ia"));
      if (argv.includes("--json")) process.stdout.write(JSON.stringify(r));
      else console.log(`${r.medido}${r.resumen ? `\n\nResumen:\n${r.resumen}` : ""}${r.commit ? `\n\nCommit sugerido (edítalo):\n${r.commit}` : ""}`);
      return 0;
    }
    case "chat": {
      // cai chat --texto "…" [--conversacion <id> | --nueva] [--entender] [--modelo chico|mediano|grande] [--json]
      // cai chat --lista [--json] · cai chat --historial [--conversacion <id>] [--json] · cai chat --borrar <id>
      // cai chat --aplicar <id> <mensaje> tarea|correccion <k>   (tu clic en la extensión: solo humano)
      const opt = (k: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
      const json = argv.includes("--json");
      if (argv.includes("--lista")) {
        const cs = listarConversaciones(root);
        if (json) process.stdout.write(JSON.stringify(cs));
        else for (const c of cs) console.log(`[${c.id}] ${c.titulo} · ${c.tipo} · ${c.modelo} · ${c.actualizada.slice(0, 16).replace("T", " ")}`);
        if (!cs.length && !json) console.log("(sin conversaciones)");
        return 0;
      }
      if (argv.includes("--aplicar")) {
        const [id, msg, tipo, k] = argv.slice(argv.indexOf("--aplicar") + 1);
        if (!id || !msg || (tipo !== "tarea" && tipo !== "correccion") || k === undefined) throw new Error("uso: cai chat --aplicar <conversación> <mensaje> tarea|correccion <número>");
        console.log(`✓ ${await aplicarPropuesta(root, id, msg, tipo, Number(k))}`);
        return 0;
      }
      if (opt("--borrar")) {
        borrarConversacion(root, opt("--borrar")!);
        console.log("✓ conversación borrada");
        return 0;
      }
      if (argv.includes("--limpiar") || (argv.includes("--nueva") && !argv.includes("--texto"))) {
        // "Limpiar" (v0.9) = empezar una conversación nueva; la anterior queda en la lista.
        const c = await crearConversacion(root, { ...(argv.includes("--entender") ? { tipo: "entender" as const } : {}), ...(opt("--modelo") ? { modelo: opt("--modelo") as Tamano } : {}) });
        if (json) process.stdout.write(JSON.stringify(c));
        else console.log(`✓ conversación nueva: ${c.id}`);
        return 0;
      }
      if (opt("--modelo") && opt("--conversacion") && !argv.includes("--texto")) {
        const c = await elegirModelo(root, opt("--conversacion")!, opt("--modelo")!);
        console.log(`✓ ${c.titulo}: responde el modelo ${c.modelo}`);
        return 0;
      }
      if (argv.includes("--historial")) {
        const id = opt("--conversacion") ?? listarConversaciones(root)[0]?.id;
        const c = id ? cargarConversacion(root, id) : undefined;
        if (json) process.stdout.write(JSON.stringify(c ?? null));
        else for (const m of c?.mensajes ?? []) console.log(`${m.quien === "ia" ? "IA" : "Tú"}: ${m.texto}\n`);
        return 0;
      }
      const t = opt("--texto") ?? argv.slice(1).filter((a) => !a.startsWith("--")).join(" ");
      if (!t?.trim()) throw new Error('uso: cai chat --texto "<tu pregunta sobre el proyecto>"');
      const conversacion = argv.includes("--nueva") ? (await crearConversacion(root, { ...(argv.includes("--entender") ? { tipo: "entender" as const } : {}) })).id : opt("--conversacion");
      const r = await conversarProyecto(root, t, { ...(conversacion ? { conversacion } : {}), ...(opt("--modelo") ? { modelo: opt("--modelo")! } : {}), ...(argv.includes("--entender") ? { tipo: "entender" as const } : {}) });
      if (json) process.stdout.write(JSON.stringify(r));
      else {
        console.log(r.respuesta.texto);
        for (const d of r.decisiones) console.log(`\n❓ [${d.id}] ${d.pregunta}: ${d.opciones.map((o) => o.opcion).join(" / ")}  (la decide el programador)`);
        r.respuesta.cambiosTareas?.forEach((x, k) => console.log(`\n📋 propuesta de tarea (${x.accion}${x.id ? ` ${x.id}` : ""}): ${x.titulo}  → la aplica el programador: cai chat --aplicar ${r.conversacion} ${r.mensaje} tarea ${k}`));
        r.respuesta.correcciones?.forEach((x) => console.log(`\n✎ corrección propuesta (${x.tipo}${x.archivo ? ` ${x.archivo}` : ""}): ${x.despues}`));
        for (const p of r.respuesta.preguntas ?? []) console.log(`\n❓ ${p.pregunta}${p.opciones.length ? ` (${p.opciones.join(" / ")})` : ""}`);
        if (r.respuesta.creeEntendido) console.log("\n✓ Cree que ya entendió: confírmalo (cai entender confirmar) o sigue corrigiendo.");
      }
      return 0;
    }
    case "programar": {
      // Modo programar (la IA escribe; entra a tu archivo SOLO con tu clic en la extensión):
      // cai programar plan <archivo> --funcion f [--pasos "a" --pasos "b"…]      proponer (o editar: tú) el plan de 3-5 pasos
      // cai programar paso <archivo> --funcion f --paso n --texto "cómo hacerlo"   tú diriges, la IA escribe ese paso
      // cai programar contrato <archivo> --funcion f --caso "f(1)" "3" …          tus casos (tú pones lo esperado)
      // cai programar pr <archivo> --funcion f [--desde <id del repertorio>]       propuesta por porciones (o tu versión adaptada)
      // cai programar probar <archivo> --funcion f --porcion k --entrada "f(2)" --espero "4"   el probador (tú)
      // cai programar insertado <archivo> --funcion f    (la extensión, tras tu clic) · descartar · ver [--json]
      // cai programar diferida <archivo> --funcion f --entrada … --espero …  ·  cai programar estado [--json]
      const opt = (k: string) => (rest.includes(k) ? rest[rest.indexOf(k) + 1] : undefined);
      const json = argv.includes("--json");
      if (sub === "estado") {
        const m = medicion(root);
        const pend = pendienteDiferida(root);
        if (json) process.stdout.write(JSON.stringify({ ...m, deuda: deudaComprension(root), diferida: pend }));
        else console.log(`Modo programar: ${m.funciones} función(es) insertadas desde propuestas · ${m.pruebas} pruebas (${m.aciertosPrimera}/${m.porciones} porciones acertadas a la primera) · ${m.sinProbar} porción(es) sin probar · diferidas: ${m.diferidasAcertadas}/${m.diferidas}${pend ? `\nPrueba diferida pendiente: ${pend.funcion} (${pend.archivo})` : ""}`);
        return 0;
      }
      const archivo = rest.find((a) => !a.startsWith("--") && !["--funcion", "--paso", "--texto", "--caso", "--desde", "--porcion", "--entrada", "--espero", "--pasos"].includes(rest[rest.indexOf(a) - 1] ?? ""));
      const funcion = opt("--funcion");
      if (!sub || !archivo || !funcion) throw new Error("uso: cai programar plan|paso|contrato|pr|probar|insertado|descartar|ver|diferida <archivo> --funcion <nombre> … (detalle: cai --help)");
      const rel = path.relative(root, path.resolve(archivo));
      const out = (x: unknown, texto: string) => (json ? process.stdout.write(JSON.stringify(x)) : console.log(texto));
      if (sub === "plan") {
        const pasos = rest.flatMap((a, i) => (rest[i - 1] === "--pasos" ? [a] : []));
        if (pasos.length) {
          const plan = await editarPlan(root, rel, funcion, pasos);
          out(plan, `✓ plan (${plan.pasos.length} pasos)`);
        } else {
          const r = await planFuncion(root, rel, funcion);
          out(r, `${r.plan.pasos.map((p, i) => `${i + 1}. ${p.texto}${p.repertorio ? " (ya lo hiciste antes)" : ""}`).join("\n")}${r.tarea ? `\n→ separa ${r.tarea}: quedó como tarea (trabájala en su propia nota)` : ""}\n  · US$${r.costoUsd.toFixed(3)}`);
        }
        return 0;
      }
      if (sub === "paso") {
        const p = await pasoDirigido(root, rel, funcion, Number(opt("--paso") ?? 1), opt("--texto") ?? "");
        out(p, `${p.falta ? `⚠ Tu paso no dice: ${p.falta}\n` : ""}${p.explicacion}\n\n${p.codigo}\n\n(irá ${p.linea ? `después de la línea ${p.linea}` : "donde elijas"}; lo inserta el programador con un clic)`);
        return 0;
      }
      if (sub === "contrato") {
        const casos = rest.flatMap((a, i) => (rest[i - 1] === "--caso" ? [{ llamada: a, esperado: rest[i + 1] ?? "" }] : []));
        await definirContrato(root, rel, funcion, casos);
        out({ casos }, `✓ ${casos.length} casos (el resultado esperado lo pusiste tú)`);
        return 0;
      }
      if (sub === "pr") {
        const p = await propuestaPR(root, rel, funcion, { ...(opt("--desde") ? { desde: opt("--desde")! } : {}) });
        out(p, `Propuesta en ${p.porciones?.length ?? 1} porción(es); contra tus casos: ${p.contrato?.filter((c) => c.pasa).length}/${p.contrato?.length} ✓\n${p.porciones?.map((x, i) => `${i + 1}. líneas ${x.desde}-${x.hasta}: ${x.porque}`).join("\n")}\n(se revisa porción por porción en el panel Nota, con el probador)`);
        return 0;
      }
      if (sub === "probar") {
        const r = await probarPorcion(root, rel, funcion, Number(opt("--porcion") ?? 1) - 1, opt("--entrada") ?? "", opt("--espero") ?? "");
        out(r, `${!r.prueba.toca ? "✗ Tu entrada no pasa por esta porción: elige una que la recorra." : r.prueba.acierto ? "✓ Coincide." : `✗ Esperabas ${r.prueba.espero}, da ${r.prueba.obtenido}.${r.prueba.explicacion ? ` ${r.prueba.explicacion}` : ""}`} (${r.aprobadas}/${r.total} porciones probadas)`);
        return 0;
      }
      if (sub === "insertado") {
        const r = await registrarInsercion(root, rel, funcion);
        out(r, `✓ registrado: ${r.porciones} porción(es), ${r.pruebas} prueba(s)${r.sinProbar ? ` · ${r.sinProbar} sin probar (deuda de comprensión)` : ""}`);
        return 0;
      }
      if (sub === "descartar") {
        descartarPropuesta(root, rel, funcion);
        out({ ok: true }, "✓ propuesta descartada");
        return 0;
      }
      if (sub === "ver") {
        const p = leerPropuesta(root, rel, funcion);
        out(p, p ? `${p.tipo} · ${p.fecha}\n${p.codigo}` : "(sin propuesta)");
        return 0;
      }
      if (sub === "diferida") {
        const r = await probarDiferida(root, rel, funcion, opt("--entrada") ?? "", opt("--espero") ?? "");
        out(r, r.acierto ? `✓ coincide (${r.obtenido})` : `✗ da ${r.obtenido}`);
        return 0;
      }
      throw new Error(`subcomando desconocido: programar ${sub}`);
    }
    case "repertorio": {
      // cai repertorio [--json] · cai repertorio borrar <id>   (tu repertorio personal, entre proyectos)
      if (sub === "borrar") {
        const e = borrarDeRepertorio(rest[0] ?? "");
        console.log(`✓ quitado del repertorio: ${e.nombre} (${e.proyecto}); queda en su historial de git`);
        return 0;
      }
      const es = cargarRepertorio();
      if (argv.includes("--json")) process.stdout.write(JSON.stringify({ dir: dirRepertorio(), politica: politica(root), entradas: es }));
      else {
        console.log(`Repertorio: ${dirRepertorio()} · en este proyecto: guardar ${politica(root).guardar ? "sí" : "no"}, usar "${politica(root).usar}"`);
        for (const e of es) console.log(`[${e.id}] ${e.firma} — ${e.resumen} (${e.proyecto}/${e.archivo})`);
        if (!es.length) console.log("(vacío: se llena con tus funciones 🟢)");
      }
      return 0;
    }
    case "ideas": {
      // cai ideas [--json] · mas · tarea <id> · descartar <id> (descartar: solo humano)
      if (sub === "mas") {
        const r = await masIdeas(root);
        console.log(r.ideas.length ? r.ideas.map((i) => `💡 [${i.id}] (${i.tipo}) ${i.titulo} — ${i.porque}`).join("\n") : "(no se me ocurrió nada nuevo que no hayas visto o descartado)");
        console.log(`  · US$${r.costoUsd.toFixed(3)}`);
        return 0;
      }
      if (sub === "tarea" || sub === "descartar") {
        const i = sub === "tarea" ? ideaATarea(root, rest[0] ?? "") : descartarIdea(root, rest[0] ?? "");
        console.log(`✓ ${sub === "tarea" ? `tarea agregada: ${i.titulo}` : `no se volverá a proponer: ${i.titulo}`}`);
        return 0;
      }
      const ideas = cargarIdeas(root).filter((i) => !i.descartada && !i.tarea);
      if (argv.includes("--json")) process.stdout.write(JSON.stringify(ideas));
      else for (const i of ideas) console.log(`💡 [${i.id}] (${i.tipo}) ${i.titulo} — ${i.porque}`);
      if (!ideas.length && !argv.includes("--json")) console.log("(sin ideas: salen con el panorama, o pide más con: cai ideas mas)");
      return 0;
    }
    case "entender": {
      // cai entender [--texto "…"] [--nueva] [--json]   conversar para entender el proyecto (borrador)
      // cai entender estado [--json] · confirmar · reabrir [--motivo "…"] · terminado   (estos tres, solo humano)
      const json = argv.includes("--json");
      // Una función (--funcion archivo:nombre) o un archivo (--archivo f): su objetivo y criterios.
      const fArg = argv.includes("--funcion") ? argv[argv.indexOf("--funcion") + 1] : undefined;
      const aArg = argv.includes("--archivo") ? argv[argv.indexOf("--archivo") + 1] : undefined;
      if (fArg || aArg) {
        const [fa, fn] = fArg ? [fArg.slice(0, fArg.lastIndexOf(":")), fArg.slice(fArg.lastIndexOf(":") + 1)] : [aArg!, undefined];
        if (!fa) throw new Error("uso: cai entender [confirmar|terminado|reabrir] --funcion <archivo>:<nombre> | --archivo <archivo> [--texto \"…\"]");
        const rel = path.relative(root, path.resolve(fa));
        if (sub === "confirmar" || sub === "reabrir" || sub === "terminado") {
          const o = await marcarObjetivo(root, rel, fn, sub);
          console.log(`✓ ${fn ?? rel}: ${sub === "confirmar" ? "objetivo confirmado" : sub === "terminado" ? "terminada" : "reabierta"} (${o.texto})`);
          return 0;
        }
        const t = argv.includes("--texto") ? argv[argv.indexOf("--texto") + 1]! : "";
        const r = await entenderFuncion(root, rel, fn, t);
        if (json) process.stdout.write(JSON.stringify(r));
        else console.log(`🎯 ${r.objetivo.texto}\n${r.objetivo.criterios.map((c) => `  - ${c}`).join("\n")}${r.preguntas.length ? `\n${r.preguntas.map((p) => `❓ ${p.pregunta}${p.opciones.length ? ` (${p.opciones.join(" / ")})` : ""}`).join("\n")}` : ""}${r.creoQueEntendi ? "\n✓ Cree que ya lo entendió: el programador lo confirma (cai entender confirmar --funcion …)" : ""}`);
        return 0;
      }
      if (sub === "confirmar" || sub === "reabrir" || sub === "terminado") {
        const opt = (k: string) => (rest.includes(k) ? rest[rest.indexOf(k) + 1] : undefined);
        const o = sub === "confirmar" ? confirmarObjetivos(root) : sub === "reabrir" ? reabrirObjetivos(root, opt("--motivo") ?? "") : darPorTerminado(root);
        console.log(`✓ objetivos: ${o.estado}${sub === "reabrir" ? " (sigue la conversación en el chat → 🎯 Entender el proyecto)" : ""}`);
        return 0;
      }
      if (!sub || sub === "estado" || sub.startsWith("--")) {
        const t = argv.includes("--texto") ? argv[argv.indexOf("--texto") + 1] : undefined;
        if (t) {
          const r = await conversarProyecto(root, t, { tipo: "entender", ...(argv.includes("--nueva") ? { conversacion: (await crearConversacion(root, { tipo: "entender" })).id } : {}) });
          if (json) process.stdout.write(JSON.stringify(r));
          else {
            console.log(r.respuesta.texto);
            for (const p of r.respuesta.preguntas ?? []) console.log(`\n❓ ${p.pregunta}${p.opciones.length ? ` (${p.opciones.join(" / ")})` : ""}`);
            if (r.respuesta.creeEntendido) console.log("\n✓ Cree que ya entendió: el programador lo confirma (cai entender confirmar) o sigue corrigiendo.");
          }
          return 0;
        }
        const o = leerObjetivos(root);
        const ev = leerEvaluacion(root);
        if (json) process.stdout.write(JSON.stringify({ ...o, evaluacion: ev }));
        else {
          console.log(objetivosMd(o));
          if (ev) console.log(`Revisión de "terminado" (${ev.fecha.slice(0, 10)}): ${ev.criterios.map((c) => `${{ cumple: "✓", parcial: "◐", no: "✗" }[c.estado]} ${o.criterios.find((x) => x.id === c.id)?.texto ?? c.id}`).join(" · ")}${ev.creeTerminado ? "\n🏁 Cree que se cumplen todos: el programador puede darlo por terminado (cai entender terminado)." : ""}`);
        }
        return 0;
      }
      throw new Error('uso: cai entender [--texto "…"] | estado | confirmar | reabrir [--motivo "…"] | terminado');
    }
    case "indice": {
      // cai indice [actualizar [archivo…]] [--json]: el mapa de funciones del proyecto (sin IA)
      const archivos = sub === "actualizar" ? rest.filter((a) => !a.startsWith("--")).map((a) => path.relative(root, path.resolve(a))) : undefined;
      const idx = sub === "actualizar" ? await actualizarIndice(root, archivos?.length ? archivos : undefined) : leerIndice(root);
      if (argv.includes("--json")) {
        process.stdout.write(JSON.stringify(idx));
        return 0;
      }
      for (const [rel, a] of Object.entries(idx.archivos)) {
        if (!a.funciones.length) continue;
        console.log(rel);
        for (const f of a.funciones) console.log(`  ${lineaIndice(f)}${f.llamadaPor.length ? `  ← la usan: ${f.llamadaPor.map((x) => x.split(":").pop()).join(", ")}` : ""}`);
      }
      if (!Object.keys(idx.archivos).length) console.log("(índice vacío: cai indice actualizar)");
      return 0;
    }
    case "decisiones": {
      // cai decisiones [--json] · decidir <id> "<opción>" · retractar <id>  (estos dos: solo humano)
      // cai decisiones proponer "<pregunta>" --opcion "a" --opcion "b" [--recomendada "a"] [--archivo f] [--funcion nombre]
      if (sub === "proponer") {
        const pregunta = rest.find((a, i) => !a.startsWith("--") && !["--opcion", "--recomendada", "--archivo", "--funcion"].includes(rest[i - 1] ?? ""));
        const opciones = rest.flatMap((a, i) => (rest[i - 1] === "--opcion" ? [{ opcion: a, consecuencia: "" }] : []));
        const opt = (k: string) => (rest.includes(k) ? rest[rest.indexOf(k) + 1] : undefined);
        if (!pregunta || opciones.length < 2) throw new Error('uso: cai decisiones proponer "<pregunta>" --opcion "a" --opcion "b" [--recomendada "a"] [--archivo f] [--funcion nombre]');
        const archivo = opt("--archivo") ? path.relative(root, path.resolve(opt("--archivo")!)) : undefined;
        const [d] = proponerDecisiones(root, [{ pregunta, opciones, ...(opt("--recomendada") ? { recomendada: opt("--recomendada")! } : {}) }], { ...(archivo ? { archivo } : {}), ...(opt("--funcion") ? { funcion: opt("--funcion")! } : {}) }, "Claude Code");
        console.log(d ? `decisión ${d.id} pendiente. Pregúntale al programador con AskUserQuestion, encabezado "cai:${d.id}", con la pregunta "${d.pregunta}" y sus opciones como opciones.` : "(ya hay una decisión parecida pendiente o vigente: míralas con cai decisiones)");
        return 0;
      }
      if (sub === "decidir") {
        const d = decidir(root, rest[0] ?? "", rest.slice(1).filter((a) => !a.startsWith("--")).join(" "));
        console.log(`✓ ${d.pregunta} → ${d.eleccion} (la IA la respeta desde ahora; puedes retractarla)`);
        return 0;
      }
      if (sub === "retractar") {
        const d = retractar(root, rest[0] ?? "");
        console.log(`✓ retractada: ${d.pregunta} (queda en el historial; ya no rige)`);
        return 0;
      }
      const ds = cargarDecisiones(root);
      if (argv.includes("--json")) {
        process.stdout.write(JSON.stringify(ds));
        return 0;
      }
      for (const d of ds) console.log(`${{ pendiente: "❓", vigente: "✓", retractada: "↩" }[d.estado]} [${d.id}] ${d.pregunta}${d.eleccion ? ` → ${d.eleccion}` : ` (${d.opciones.map((o) => o.opcion).join(" / ")})`}`);
      if (!ds.length) console.log("(sin decisiones)");
      return 0;
    }
    case "servir": {
      // Proceso de larga vida para la extensión (pedidos JSON por línea). Ver servir.ts.
      await servir(root);
      return 0;
    }
    case "actividad": {
      // cai actividad [--json] [--n 20]: qué hizo la IA en este proyecto (sin IA: el registro de uso)
      const n = argv.includes("--n") ? Number(argv[argv.indexOf("--n") + 1]) || 20 : 20;
      const proyecto = path.basename(root);
      const items = leerUso(7)
        .filter((u) => u.tipo === "llamada" && (!u.proyecto || u.proyecto === proyecto))
        .slice(-n)
        .reverse();
      if (argv.includes("--json")) {
        process.stdout.write(JSON.stringify(items));
        return 0;
      }
      for (const u of items)
        console.log(`${(u as { fecha?: string }).fecha?.slice(11, 16) ?? ""}  ${u.kind}${u.archivo ? ` · ${u.archivo}${u.funcion ? `:${u.funcion}` : ""}` : ""}  ${u.modelos?.[0] ?? ""}  US$${(u.costo ?? 0).toFixed(3)}  ${u.ms ? `${(u.ms / 1000).toFixed(1)} s` : ""}`);
      if (!items.length) console.log("(sin actividad de la IA en los últimos 7 días)");
      return 0;
    }
    case "modo": {
      // cai modo [sugerir|aprender|programar|heredar] [--archivo f | --funcion f:nombre | --carpeta ruta/] [--json]
      const args = argv.slice(1);
      const opt = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
      const cfgFile = path.join(dataDir(root), "config.json");
      let raw: Record<string, unknown> = {};
      if (fs.existsSync(cfgFile))
        try {
          raw = JSON.parse(fs.readFileSync(cfgFile, "utf8")) as Record<string, unknown>;
        } catch (e) {
          throw new Error(`${path.relative(root, cfgFile)} no es un JSON válido (${(e as Error).message}); arréglalo antes de cambiar el modo`);
        }
      migrarModos(raw); // lo de antes de v0.10 ("programar" = hoy "sugerir") se guarda ya migrado
      const fnArg = opt("--funcion");
      const [fnArchivo, fnNombre] = fnArg ? [fnArg.slice(0, fnArg.lastIndexOf(":")), fnArg.slice(fnArg.lastIndexOf(":") + 1)] : [];
      if (!sub || sub.startsWith("--")) {
        // Consultar: el modo que rige (y de dónde viene).
        const archivo = opt("--archivo") ?? fnArchivo;
        const rel = archivo ? path.relative(root, path.resolve(archivo)) : undefined;
        const cfg = loadConfig(root);
        const ef = rel ? modoEfectivo(cfg, rel, fnNombre) : { modo: cfg.modo, origen: "proyecto" };
        if (args.includes("--json")) process.stdout.write(JSON.stringify({ modo: ef.modo, origen: ef.origen, proyecto: cfg.modo, ...cfg.modos }));
        else console.log(`modo: ${ef.modo} (por ${ef.origen})`);
        return 0;
      }
      const heredar = sub === "heredar";
      if (!heredar && !esModo(sub)) throw new Error(`modo desconocido "${sub}": usa ${Object.keys(MODOS).join(" | ")} (o "heredar" para quitarlo)`);
      // Se guarda en la configuración (no en las notas): cambiar de modo no toca lo ya hecho.
      const modos = (raw.modos ??= {}) as Record<string, Record<string, string>>;
      const poner = (grupo: string, clave: string) => {
        modos[grupo] ??= {};
        if (heredar) delete modos[grupo]![clave];
        else modos[grupo]![clave] = sub;
      };
      let donde: string;
      if (fnArg) {
        if (!fnArchivo || !fnNombre) throw new Error("uso: cai modo <modo> --funcion <archivo>:<función>");
        const rel = path.relative(root, path.resolve(fnArchivo));
        const funciones = await funcionesDe(fs.readFileSync(path.join(root, rel), "utf8"), langFor(rel));
        if (!funcionPorClave(funciones, fnNombre)) throw new Error(`no encuentro la función "${fnNombre}" en ${rel}`);
        poner("porFuncion", `${rel}:${fnNombre}`);
        donde = `${fnNombre.replace(/#\d+$/, "")} (${rel})`;
      } else if (opt("--archivo")) {
        const rel = path.relative(root, path.resolve(opt("--archivo")!));
        poner("porArchivo", rel);
        donde = rel;
      } else if (opt("--carpeta")) {
        // Una carpeta como prefijo literal ("src/legacy/"); también se aceptan globs ("src/**/viejo/**").
        const c = opt("--carpeta")!;
        poner("porCarpeta", /[*?]/.test(c) ? c : `${path.relative(root, path.resolve(c)).split(path.sep).join("/")}/`);
        donde = c;
      } else if (heredar) throw new Error("el proyecto no hereda de nadie: elige sugerir, aprender o programar");
      else {
        raw.modo = sub;
        donde = "el proyecto";
      }
      fs.mkdirSync(path.dirname(cfgFile), { recursive: true });
      const tmp = `${cfgFile}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(raw, null, 2) + "\n");
      fs.renameSync(tmp, cfgFile);
      console.log(`✓ ${donde}: ${heredar ? "hereda el modo" : `modo ${sub}`} (lo ya hecho no cambia)`);
      return 0;
    }
    case "rapida": {
      // cai rapida <archivo> --linea N [--json]: pista de una línea donde estás escribiendo
      const n = rest.includes("--linea") ? Number(rest[rest.indexOf("--linea") + 1]) : NaN;
      if (!sub || !Number.isInteger(n)) throw new Error("uso: cai rapida <archivo> --linea <n> [--json]");
      const r = await rapida(root, path.relative(root, path.resolve(sub)), n);
      if (rest.includes("--json")) process.stdout.write(JSON.stringify(r));
      else console.log(r.texto || `(nada${r.motivo ? `: ${r.motivo}` : ""})`);
      return 0;
    }
    case "verificar": {
      // cai verificar <archivo> [--funcion X] [--chico] [--forzar] [--json]   ("¿quedó lista?")
      if (!sub) throw new Error("uso: cai verificar <archivo> [--funcion <nombre>] [--json]");
      const opt = (k: string) => (rest.includes(k) ? rest[rest.indexOf(k) + 1] : undefined);
      const json = rest.includes("--json");
      try {
        const r = await verificar(root, path.relative(root, path.resolve(sub)), {
          ...(opt("--funcion") ? { funcion: opt("--funcion")! } : {}),
          ...(rest.includes("--forzar") ? { forzar: true } : {}),
          ...(rest.includes("--independiente") ? { independiente: true } : {}),
          ...(opt("--explicacion") ? { explicacion: opt("--explicacion")! } : {}),
          tamano: rest.includes("--chico") ? "chico" : "mediano",
          log: json ? () => {} : (l) => console.log(l),
        });
        if (json) process.stdout.write(JSON.stringify(r));
        else {
          const icono = { lista: "🟢", casi: "🟡", falta: "🔴" };
          for (const v of r.veredictos) console.log(`${icono[v.estado]} ${v.funcion}: ${v.resumen}${v.omitida ? " (sin cambios desde la última vez)" : ""}`);
          if (!r.veredictos.length) console.log("(nada que verificar: ninguna función con nota abierta; usa --funcion <nombre>)");
        }
        return 0;
      } catch (e) {
        if (json && e instanceof OcupadoError) {
          process.stdout.write(JSON.stringify({ mensaje: e.message, ocupado: true }));
          return 3;
        }
        throw e;
      }
    }
    case "memoria": {
      // cai memoria [--json] · cai memoria responder <n> "<respuesta>"  (las preguntas que la IA te hizo)
      if (sub === "responder") {
        const n = Number(rest[0]);
        const r = rest.slice(1).join(" ").trim();
        if (!Number.isInteger(n) || n < 1 || !r) throw new Error('uso: cai memoria responder <número de pregunta> "<respuesta>" (los números salen en: cai memoria)');
        const p = responderPregunta(root, n, r);
        olvidarDialogo(root, p);
        console.log(`✓ Anotado en la memoria del proyecto: ${p} → ${r}`);
        return 0;
      }
      if (sub === "conversar") {
        // cai memoria conversar <n> --texto "..." [--json]: preguntarle a la IA sobre su pregunta
        const n = Number(rest[0]);
        const t = rest.includes("--texto") ? rest[rest.indexOf("--texto") + 1] : undefined;
        if (!Number.isInteger(n) || !t) throw new Error('uso: cai memoria conversar <n> --texto "<lo que quieres preguntarle>"');
        const r = await conversar(root, n, t);
        if (rest.includes("--json")) process.stdout.write(JSON.stringify(r));
        else console.log(r.hilo[r.hilo.length - 1]!.texto);
        return 0;
      }
      if (sub === "corregir") {
        // cai memoria corregir --modulo <archivo> | --estructura <archivo> | --proyecto  --texto "lo que debe decir"
        // Lo tuyo manda sobre lo generado (el panorama y el plano no lo pisan). Solo humano: desde el chat se revierte.
        const opt = (k: string) => (rest.includes(k) ? rest[rest.indexOf(k) + 1] : undefined);
        const texto = opt("--texto");
        const tipo = opt("--modulo") !== undefined ? "modulo" : opt("--estructura") !== undefined ? "estructura" : rest.includes("--proyecto") ? "proyecto" : undefined;
        if (!tipo || !texto) throw new Error('uso: cai memoria corregir --modulo <archivo> | --estructura <archivo> | --proyecto  --texto "lo que debe decir"');
        const archivo = tipo === "modulo" ? opt("--modulo") : tipo === "estructura" ? opt("--estructura") : undefined;
        const c = corregir(root, { tipo, ...(archivo ? { archivo: path.relative(root, path.resolve(archivo)) } : {}), despues: texto, ...(opt("--antes") ? { antes: opt("--antes")! } : {}), origen: "tú" });
        console.log(`✓ corrección ${c.id} guardada: ${c.archivo ? `${c.archivo}: ` : ""}${c.despues} (manda sobre lo generado; se quita con: cai memoria quitar ${c.id})`);
        return 0;
      }
      if (sub === "proponer") {
        // Claude Code: cai memoria proponer --modulo f | --estructura f | --proyecto --texto "…" → luego te pregunta con el encabezado cai:<id>
        const opt = (k: string) => (rest.includes(k) ? rest[rest.indexOf(k) + 1] : undefined);
        const texto = opt("--texto");
        const tipo = opt("--modulo") !== undefined ? "modulo" : opt("--estructura") !== undefined ? "estructura" : rest.includes("--proyecto") ? "proyecto" : undefined;
        if (!tipo || !texto) throw new Error('uso: cai memoria proponer --modulo <archivo> | --estructura <archivo> | --proyecto  --texto "lo que debe decir"');
        const archivo = tipo === "modulo" ? opt("--modulo") : tipo === "estructura" ? opt("--estructura") : undefined;
        const p = proponerCorreccion(root, { tipo, ...(archivo ? { archivo: path.relative(root, path.resolve(archivo)) } : {}), despues: texto });
        console.log(`propuesta ${p.id}. Pregúntale al programador con AskUserQuestion, encabezado "cai:${p.id}", incluyendo en la pregunta el texto exacto: "${p.despues}", opciones "Aplicar" / "No".`);
        return 0;
      }
      if (sub === "quitar") {
        const c = quitarCorreccion(root, rest[0] ?? "");
        console.log(`✓ corrección quitada: ${c.archivo ? `${c.archivo}: ` : ""}${c.despues}`);
        return 0;
      }
      if (sub === "correcciones") {
        const cs = cargarCorrecciones(root);
        if (argv.includes("--json")) process.stdout.write(JSON.stringify(cs));
        else for (const c of cs) console.log(`[${c.id}] ${c.tipo}${c.archivo ? ` ${c.archivo}` : ""}: ${c.despues}`);
        if (!cs.length && !argv.includes("--json")) console.log("(sin correcciones)");
        return 0;
      }
      const dialogos = cargarDialogos(root);
      const abiertas = preguntasAbiertas(root).map((a) => ({ ...a, dialogo: dialogos[a.pregunta] ?? [] }));
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
      // cai tareas [--json] · agregar "<t>" [--archivo f] [--detalle "…"] · editar <id> [--titulo "…"] [--detalle "…"] [--archivo f]
      // · hecha|pendiente|reabrir|descartar <id>   (descartar es solo humano: desde el chat se revierte)
      const opt = (k: string) => (rest.includes(k) ? rest[rest.indexOf(k) + 1] : undefined);
      const cambio: CambioTarea | undefined =
        sub === "agregar"
          ? { accion: "crear", titulo: rest.find((a, i) => !a.startsWith("--") && !["--archivo", "--detalle"].includes(rest[i - 1] ?? "")) ?? "", ...(opt("--archivo") ? { archivo: opt("--archivo")! } : {}), ...(opt("--detalle") ? { detalle: opt("--detalle")! } : {}) }
          : sub === "editar"
            ? { accion: "editar", id: rest[0]!, ...(opt("--titulo") !== undefined ? { titulo: opt("--titulo")! } : {}), ...(opt("--detalle") !== undefined ? { detalle: opt("--detalle")! } : {}), ...(opt("--archivo") !== undefined ? { archivo: opt("--archivo")! } : {}) }
            : sub === "hecha" || sub === "descartar"
              ? { accion: sub, id: rest[0]! }
              : sub === "pendiente" || sub === "reabrir"
                ? { accion: "reabrir", id: rest[0]! }
                : undefined;
      if (cambio) {
        if (cambio.accion === "crear" && !cambio.titulo) throw new Error('uso: cai tareas agregar "<título>" [--archivo f] [--detalle "…"]');
        console.log(`✓ ${aplicarCambioTarea(root, cambio)}`);
        return 0;
      }
      // Al listar: se actualizan (hechas solas, separadas, archivadas) y no se muestran las archivadas.
      const tareas = (await actualizarTareas(root)).filter((t) => !t.archivada);
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
      if (argv.includes("--estado")) {
        // Sin IA: ¿cuántos archivos cambiaron desde el último panorama? (para el aviso del panel)
        const e = estadoPanorama(root);
        if (argv.includes("--json")) process.stdout.write(JSON.stringify(e));
        else console.log(e.existe ? `${e.cambiados.length} archivo(s) cambiaron desde el último panorama (${e.fecha})` : "todavía no hay panorama");
        return 0;
      }
      const r = await panorama(root, { sinIa: argv.includes("--sin-ia"), log: (l) => console.log(l) });
      for (const l of r.resumen) console.log(`· ${l}`);
      console.log(`✓ ${path.relative(root, r.archivo)}${r.costoUsd ? ` · US$${r.costoUsd.toFixed(3)}` : ""}`);
      return 0;
    }
    case "tests": {
      if (!sub) throw new Error("uso: cai tests <archivo> [función] [--probar | --guardar | --correr] [--json]");
      const rel = path.relative(root, path.resolve(sub));
      const fn = rest.find((a) => !a.startsWith("--"));
      const json = rest.includes("--json");
      if (rest.includes("--probar")) {
        // Propone casos y los EJECUTA ya contra tu código (no escribe archivos).
        const r = await probarCasos(root, rel, fn);
        if (json) process.stdout.write(JSON.stringify(r));
        else for (const c of r.resultados) console.log(`${{ pasa: "✓", falla: "✗", decidir: "?", "no-ejecutable": "!" }[c.estado]} ${c.descripcion}: ${c.llamada} → esperado ${c.esperado}${c.obtenido ? `, obtuvo ${c.obtenido}` : ""}${c.duda ? ` (${c.duda})` : ""}`);
        return 0;
      }
      if (rest.includes("--guardar")) {
        // Con tu clic: los casos probados se escriben como tests (activos; los que tienen pregunta, apagados).
        const r = await proponerTests(root, rel, fn, { usarProbados: true, activos: true });
        if (json) process.stdout.write(JSON.stringify(r));
        else console.log(`✓ ${r.casos} caso(s) en ${r.archivo}${r.preguntas ? ` (${r.preguntas} apagados, esperan tu respuesta)` : ""}`);
        return 0;
      }
      if (rest.includes("--recorrer")) {
        // Sin IA: vuelve a probar los casos guardados de este archivo (lo que corre al guardar).
        const r = await recorrerCasos(root, rel);
        if (json) process.stdout.write(JSON.stringify(r));
        else for (const f of r.funciones) console.log(`🧪 ${f.funcion}: ${f.pasan} ✅ · ${f.fallan} ❌`);
        return 0;
      }
      if (rest.includes("--correr")) {
        const r = await correrTests(root, rel);
        if (json) process.stdout.write(JSON.stringify(r));
        else console.log(r.ok ? `✓ los tests de ${r.archivo} pasan` : `✗ ${r.archivo}:\n  ${r.fallos.join("\n  ")}`);
        return r.ok ? 0 : 1;
      }
      const r = await proponerTests(root, rel, fn);
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
      if (!temas.length) console.log("Perfil vacío. Declara lo que sabes: cai perfil set typescript experto");
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
  else if (["panorama", "conocer", "plano", "arquitectura"].includes(cmd ?? "") && !argv.includes("--estado")) objetivo = "__proyecto__";
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
