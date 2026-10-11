/**
 * La superficie v1 de `cai`: pocos verbos, centrados en la TAREA (manifiesto V). Cada comando dice qué
 * falta en vez de fallar en silencio. Los que solo puede correr el humano están en SOLO_HUMANO_V1 (el hook
 * de Bash los rechaza si los intenta la IA; ver snapshot.ts).
 *
 *   pedir · tarea · avanzar · revisar --tarea · decidir · pruebas · volver · desconectar
 *   informe · mapa · repaso · kata · reconstruir · yo · hoy · git · paralelo · agente · traspaso
 *   reglas · ia · adoptar · migrar · ci · githook · merge-procedencia
 */
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../proyecto/config.js";
import { entero, uso, valor, valores } from "./args.js";
import { cargarDecisiones } from "../proyecto/decisiones.js";
import { TIPOS, type TipoTarea } from "../nucleo/flujo.js";
import { describir } from "../nucleo/construcciones.js";
import { cargarPedido, cargarTarea, fijarFoco, listarPedidos, listarTareas, rastroPedido, cerrarSesionDelDia, conTarea } from "../proyecto/tareas.js";
import { exportarExpediente, importarExpediente, resumenExpediente } from "../proyecto/expediente.js";
import { compilarReglas, derivaDeStack, reglaEfectiva, seccionesFaltantes, globales } from "../proyecto/reglas.js";
import * as tarea from "../flujos/tarea.js";
import * as rev from "../flujos/revision.js";
import * as dec from "../flujos/decidir.js";
import * as pr from "../flujos/pruebas.js";
import * as des from "../garantias/bucle.js";
import * as inf from "../flujos/informe.js";
import * as mapa from "../flujos/mapa.js";
import * as prac from "../flujos/practica.js";
import * as ag from "../flujos/agentes.js";
import { migrar } from "../flujos/migrar.js";
import { evaluar } from "../ia/evaluar.js";
import { CADENA_POR_DEFECTO } from "../ia/decisor.js";
import { refDeRol, ROLES_POR_DEFECTO, motoresDe, permitido, type Rol } from "../ia/roles.js";
import { disponible } from "../ia/motores.js";
import { leerUso } from "../ia/llm.js";
import { ci, commitMsg, mergeProcedencia, postCheckout, postCommit, preCommit, prePush, sarif } from "../garantias/gitHooks.js";
import { rebatir } from "../flujos/juez.js";

type Run = (args: string[], root: string) => Promise<number>;
const log = (s: string | string[]) => console.log(Array.isArray(s) ? s.join("\n") : s);
const json = (args: string[]) => args.includes("--json");
const out = (args: string[], datos: unknown, texto: () => string[] | string): number => {
  if (json(args)) process.stdout.write(JSON.stringify(datos));
  else log(texto());
  return 0;
};
const faltan = (f: string[]) => (f.length ? `✘ Falta:\n${f.map((x) => `  - ${x}`).join("\n")}` : "");

const AYUDA_V1 = `ComplementAIry v1 — programar CON IA sin vibe coding (ver Manifiesto.md)

La tarea (V, pasos 1–7)
  cai pedir "<qué quieres>"            separa los temas, una tarea por tema (nada se olvida)  [solo tú]
  cai tarea [id]                       lista o muestra una tarea (entrevista, diseño, plan, restricciones)
  cai tarea <id> --sugerir             la IA sugiere cada restricción con su porqué
  cai tarea <id> --responder <clave> "…"   tu respuesta a la entrevista (con tus palabras)  [solo tú]
  cai tarea <id> --diseno --problema "…" --enfoque "…" --contexto a,b --criterio "f(x) → y"  [solo tú]
  cai tarea <id> --planificar          plan SIN código (modelo de razonamiento); ambigüedades → decisiones
  cai tarea <id> --aprobar "<tu paráfrasis>" [--alcance g1,g2] [--presupuesto N]  [solo tú]
  cai tarea <id> --ejecutar [--aislada] la IA escribe SOLO dentro del alcance (el hook lo impone)  [solo tú]
  cai avanzar [id]                     pasa al siguiente estado o dice EXACTAMENTE qué falta
  cai revisar --tarea <id> [--tramo N --explicacion "…" | --llamada "f(…)" --espero "…" | --bordes "a; b" --rendimiento "…" | --mutante "tests|ninguno"]
  cai pruebas <id> [--resolver <clave> --como test|no-aplica|explicacion --nota "…"]   detectores V.5
  cai decidir [id] [--criterios a:50,b:50 | --ia | --puntuar "A:a=4,b=3;B:…" | --elegir "X" --porque "…" [--adr]]
  cai desconectar <id> "<por qué>" · cai volver <id> --replanteo "…" [--manual]   pull the plug (V.7)

Lo que sabes y lo que no se revisó
  cai informe [--yo] [--semana]        qué código no revisó un humano (o tú), por riesgo
  cai mapa [--modulo m] [--recorrido [--hacia ruta]] [--parada N --hipotesis "…" | --diferencia "…"] [--tarjeta m]
  cai repaso [--item N --llamada "…" --espero "…"]   predicciones espaciadas (1, 7, 30 días)
  cai kata <construccion> | cai kata verificar <id>  ganar una licencia (I.6) sin IA
  cai reconstruir [--empezar N | --terminar "reflexión"]  el ejercicio semanal (VI.3)
  cai yo [--exportar f | --importar f] tu expediente: licencias, dominios, calibración, proyectos
  cai hoy [--foco "…"] [--cerrar]      qué buscas hoy, lo pendiente y lo olvidado

Equipo, git e IA
  cai git "<pedido>" [--ejecutar [--confirmo <rama>]]   git en lenguaje natural (los riesgos sin IA)
  cai paralelo <id…> · cai agente <id> implementador|tester|revisor|refactorizador
  cai traspaso <id>                    resumen para seguir en una sesión NUEVA (IV.6)
  cai reglas [archivo] [--compilar]    reglas efectivas y su origen (global > proyecto > carpeta)
  cai ia [roles|evaluar|uso]           motores por rol, decisor System One y su evaluación
  cai adoptar · cai migrar [--aplicar] · cai ci [--sarif f] · cai doctor · cai init

Acompañamiento a tu código (se conserva): cai guia, cai responder, cai verificar, cai revisar <archivo>,
cai tests, cai notas, cai siguiente (ver \`cai help --todo\`).`;

export { SOLO_HUMANO_V1 } from "./soloHumano.js";

function tareaId(args: string[], root: string): string {
  const id = args.find((a) => /^t\d+$/.test(a));
  return id ?? tarea.elegirActiva(root).id;
}

const COMANDOS: Record<string, Run> = {
  async pedir(args, root) {
    const texto = args.filter((a) => !a.startsWith("--")).join(" ").trim() || uso('cai pedir "<qué quieres, con tus palabras>"');
    const tipo = valor(args, "--tipo") as TipoTarea | undefined;
    if (tipo && !TIPOS.includes(tipo)) uso(`--tipo: ${TIPOS.join(" | ")}`);
    const r = await tarea.pedir(root, texto, { ...(tipo ? { tipo } : {}), ...(args.includes("--aprender") ? { intencion: "aprender" as const } : {}), ...(valor(args, "--rebatir") ? { rebatir: valor(args, "--rebatir")! } : {}) });
    return out(args, r, () => [`Pedido ${r.pedido.id}: ${r.tareas.length} tema(s)`, ...rastroPedido(root, r.pedido).map((x) => `  ${x}`), ...r.avisos.map((a) => `⚠ ${a}`), "", `Siguiente: ${tarea.sugerencia(r.tareas[0]!)}`]);
  },

  async pedido(args, root) {
    const id = args.find((a) => /^p\d+$/.test(a));
    if (!id) return out(args, listarPedidos(root), () => listarPedidos(root).flatMap((p) => [`${p.id}: «${p.texto.slice(0, 80)}»`, ...rastroPedido(root, p).map((x) => `  ${x}`)]));
    const comun = valor(args, "--comun");
    if (comun) {
      const texto = args[args.indexOf("--comun") + 2] ?? uso(`cai pedido ${id} --comun <clave> "<tu respuesta>"`);
      const ts = await tarea.respuestaComun(root, id, comun, texto, valor(args, "--rebatir"));
      log(`✔ «${comun}» respondida para ${ts.map((t) => t.id).join(", ")}`);
    }
    if (valor(args, "--asignar") || valor(args, "--descartar")) await tarea.ajustarPedido(root, id, { ...(valor(args, "--asignar") ? { asignar: valor(args, "--asignar")! } : {}), ...(valor(args, "--descartar") ? { descartar: valor(args, "--descartar")!, porque: valor(args, "--porque") ?? "" } : {}) });
    const p = cargarPedido(root, id);
    return out(args, p, () => [`${p.id}: «${p.texto}»`, ...rastroPedido(root, p).map((x) => `  ${x}`)]);
  },

  async tarea(args, root) {
    const id = args.find((a) => /^t\d+$/.test(a));
    if (args[0] === "nueva") {
      const t = await tarea.pedir(root, args.slice(1).filter((a) => !a.startsWith("--")).join(" "), { ...(args.includes("--humano") ? { ejecutor: "humano" as const } : {}), ...(args.includes("--aprender") ? { intencion: "aprender" as const } : {}) });
      return out(args, t, () => `✔ ${t.tareas.map((x) => x.id).join(", ")} creada(s). ${tarea.sugerencia(t.tareas[0]!)}`);
    }
    if (!id) {
      const ts = listarTareas(root).filter((t) => args.includes("--todas") || !["cerrada", "descartada"].includes(t.estado));
      if (args.includes("--tablero")) return out(args, ts, () => ag.tablero(root));
      return out(args, ts, () => (ts.length ? ts.map((t) => `${t.id.padEnd(5)} ${t.estado.padEnd(13)} ${t.intencion.padEnd(9)} ${t.titulo}`) : ['no hay tareas: `cai pedir "…"`']));
    }
    if (args.includes("--faltan")) {
      const t0 = cargarTarea(root, id);
      const f = (await import("../nucleo/flujo.js")).faltantes(t0, await tarea.hechosDe(root, t0));
      return out(args, { tarea: t0, faltan: f, siguiente: tarea.sugerencia(t0), decisiones: cargarDecisiones(root).filter((d) => d.tarea === id) }, () => [...tarea.describirTarea(root, t0), faltan(f)]);
    }
    if (args.includes("--sugerir")) await tarea.sugerirEntrevista(root, id);
    const resp = valor(args, "--responder");
    if (resp) {
      const texto = args[args.indexOf("--responder") + 2] ?? uso(`cai tarea ${id} --responder <clave> "<tu respuesta>"`);
      await tarea.responder(root, id, resp, texto, valor(args, "--rebatir"));
    }
    if (args.includes("--diseno")) {
      await tarea.fijarDiseno(
        root,
        id,
        {
          ...(valor(args, "--problema") ? { problema: valor(args, "--problema")! } : {}),
          ...(valor(args, "--enfoque") ? { enfoque: valor(args, "--enfoque")! } : {}),
          ...(valor(args, "--contexto") ? { contexto: valor(args, "--contexto")!.split(",").map((s) => s.trim()) } : {}),
          ...(valores(args, "--criterio").length ? { criterios: valores(args, "--criterio") } : {}),
        },
        valor(args, "--rebatir"),
      );
    }
    if (valor(args, "--adjuntar")) tarea.adjuntar(root, id, valor(args, "--adjuntar")!);
    if (valor(args, "--alcance")) conTarea(root, id, (t) => ({ ...t, restricciones: { ...t.restricciones, alcance: valor(args, "--alcance")!.split(",").map((s) => s.trim()) } }));
    if (valor(args, "--ejecutor")) conTarea(root, id, (t) => ({ ...t, ejecutor: valor(args, "--ejecutor") as typeof t.ejecutor }));
    if (args.includes("--planificar")) await tarea.planificar(root, id);
    if (valor(args, "--aprobar") !== undefined) {
      const r = await tarea.aprobar(root, id, valor(args, "--aprobar")!, {
        ...(valor(args, "--alcance") ? { alcance: valor(args, "--alcance")!.split(",") } : {}),
        ...(valor(args, "--presupuesto") ? { presupuesto: Number(valor(args, "--presupuesto")) } : {}),
        ...(args.includes("--con-dependencias") ? { sinDependencias: false } : {}),
      });
      if (r.faltan.length) {
        log(faltan(r.faltan));
        return 1;
      }
      log(`✔ ${id} aprobada. ${tarea.sugerencia(r.tarea)}`);
    }
    if (args.includes("--ejecutar")) {
      let o: { worktree?: string; rama?: string } = {};
      if (args.includes("--aislada")) {
        const w = ag.crearWorktree(root, id);
        o = { worktree: w.dir, rama: w.rama };
        log(`worktree ${w.dir} (rama ${w.rama}): abre Claude Code ahí`);
      }
      const r = await tarea.ejecutar(root, id, { ...o, ...(valor(args, "--sesion") ? { sesion: valor(args, "--sesion")! } : {}) });
      if (r.faltan.length) {
        log(faltan(r.faltan));
        return 1;
      }
      log(`✔ ${id} en ejecución. ${r.tarea.ejecutor === "humano" ? "Escríbela tú." : "Pídele a Claude Code que implemente " + id + " (una sesión = una tarea)."}`);
    }
    if (valor(args, "--refactorizar")) tarea.refactorizarAlrededor(root, id, valor(args, "--refactorizar")!);
    if (valor(args, "--descartar")) tarea.descartar(root, id, valor(args, "--descartar")!);
    const t = cargarTarea(root, id);
    return out(args, t, () => tarea.describirTarea(root, t));
  },

  async avanzar(args, root) {
    const r = await tarea.avanzar(root, args.find((a) => /^t\d+$/.test(a)));
    return out(args, r, () => (r.a ? [`✔ ${r.tarea.id}: ${r.de} → ${r.a}`, `Siguiente: ${r.siguiente}`] : [`${r.tarea.id} (${r.de})`, faltan(r.faltan)]));
  },

  async revisar(args, root) {
    const id = valor(args, "--archivo") ? `@${path.relative(root, path.resolve(root, valor(args, "--archivo")!)).split(path.sep).join("/")}` : (valor(args, "--tarea") ?? tareaId(args, root));
    const tramo = valor(args, "--tramo");
    const seg = valor(args, "--seguridad") ? Number(valor(args, "--seguridad")) : undefined;
    if (!tramo) {
      const ls = await rev.listarParaRevisar(root, id);
      return out(args, await rev.tramosARevisar(root, rev.objetivo(root, id)), () => ls);
    }
    let r: rev.ResultadoRevision;
    if (valor(args, "--explicacion")) r = await rev.evidenciaExplicacion(root, id, tramo, valor(args, "--explicacion")!, seg);
    else if (valor(args, "--llamada")) r = await rev.evidenciaPrediccion(root, id, tramo, valor(args, "--llamada")!, valor(args, "--espero") ?? uso("--espero <lo que crees que devuelve>"), seg);
    else if (valor(args, "--bordes")) r = await rev.evidenciaBordes(root, id, tramo, valor(args, "--bordes")!, valor(args, "--rendimiento") ?? uso('--rendimiento "<cómo impacta>"'));
    else if (valor(args, "--mutante")) r = await rev.evidenciaMutante(root, id, tramo, valor(args, "--mutante")!);
    else if (valor(args, "--captura")) r = await rev.evidenciaVisual(root, id, tramo, valor(args, "--captura")!, valor(args, "--descripcion") ?? uso('--descripcion "qué cambia en pantalla y por qué"'));
    else uso("--explicacion | --llamada/--espero/--seguridad | --bordes/--rendimiento | --mutante | --captura/--descripcion");
    out(args, r, () => [...r.mensaje, ...(r.comparar ?? [])]);
    return r.ok ? 0 : 1;
  },

  async pruebas(args, root) {
    const id = tareaId(args, root);
    const clave = valor(args, "--resolver");
    if (clave) {
      const h = pr.resolverHallazgo(root, id, clave, (valor(args, "--como") ?? "no-aplica") as "test", valor(args, "--nota") ?? uso('--nota "<por qué / qué test>"'));
      return out(args, h, () => `✔ resuelto: ${h.texto}`);
    }
    if (valor(args, "--escalar")) {
      const [archivo, funcion] = valor(args, "--escalar")!.split("#");
      const e = pr.medirEscalabilidad(root, archivo!, funcion!, valor(args, "--ejemplo") ?? uso('--ejemplo "[1,2,3]"'), Number(valor(args, "--predigo") ?? uso("--predigo <cuántas veces más lento con 10× datos>")));
      return out(args, e, () => [`Medido: ${e.tiempos.map((t) => `n=${t.n}: ${t.ms.toFixed(1)} ms`).join(" · ")}`, `Con 10× datos tarda ~${e.factor10}× (exponente ${e.exponente}). Predijiste ${e.tuPrediccion}× → ${e.acierto ? "✔ acertaste" : "✘ revisa tu modelo mental del algoritmo"}`]);
    }
    const hs = await pr.revisarHallazgos(root, { ...cargarTarea(root, id), tocados: tarea.archivosTocados(root, cargarTarea(root, id)) });
    return out(args, hs, () => (hs.length ? hs.map((h) => `${h.resuelto ? "✔" : "○"} [${h.clave.split(":").slice(1).join(":")}] ${h.archivo}:${h.linea} ${h.texto}`) : [`${id}: sin hallazgos de V.5 ✔`]));
  },

  async decidir(args, root) {
    if (valor(args, "--nueva")) {
      const ops = valores(args, "--opcion");
      const { proponerDecisiones } = await import("../proyecto/decisiones.js");
      const [d] = proponerDecisiones(root, [{ pregunta: valor(args, "--nueva")!, opciones: ops.map((o) => ({ opcion: o, consecuencia: "" })) }], {}, "cai decidir --nueva", args.find((a) => /^t\d+$/.test(a)));
      return out(args, d, () => (d ? `✔ ${d.id} pendiente` : "ya existe una parecida"));
    }
    if (valor(args, "--alternativas") !== undefined || args.includes("--alternativas")) {
      const d = await dec.alternativas(root, valor(args, "--alternativas") ?? uso('--alternativas "<el problema>"'));
      return out(args, d, () => dec.describirDecision(d));
    }
    const id = args.find((a) => /^d[0-9a-f]+$/.test(a));
    if (!id) {
      const ds = cargarDecisiones(root).filter((d) => d.estado === "pendiente");
      return out(args, ds, () => (ds.length ? ds.flatMap((d) => dec.describirDecision(d)) : ["no hay decisiones pendientes"]));
    }
    if (valor(args, "--criterios")) dec.fijarCriterios(root, id, dec.leerCriterios(valor(args, "--criterios")!));
    if (args.includes("--ia")) await dec.puntajesIa(root, id);
    if (valor(args, "--puntuar")) {
      const r = dec.puntuar(root, id, dec.leerPuntajes(valor(args, "--puntuar")!));
      log([`Total: ${r.resultado.totales.map((t) => `${t.opcion} ${t.total}`).join(" · ")} → gana ${r.resultado.ganador}`, r.resultado.fragil ? `⚠ decisión FRÁGIL: con ${r.resultado.sensibleA?.criterio} en ${r.resultado.sensibleA?.nuevoPeso} gana ${r.resultado.sensibleA?.nuevoGanador}` : `Robusta (haría falta mover un peso ${r.resultado.sensibilidad} puntos)`, ...r.discrepancias.map((x) => `Difieres de la IA en ${x.opcion}/${x.criterio} (tú ${x.tuyo}, IA ${x.ia}): anota por qué con --nota "${x.opcion}/${x.criterio}" "…"`)]);
    }
    if (valor(args, "--nota")) dec.anotar(root, id, valor(args, "--nota")!, args[args.indexOf("--nota") + 2] ?? uso('--nota "<opción>/<criterio>" "<por qué>"'));
    if (valor(args, "--ev")) {
      const esc = valor(args, "--ev")!.split(",").map((x) => ({ nombre: x.split(":")[0]!.trim(), probabilidad: Number(x.split(":")[1]) }));
      const vals = dec.leerPuntajes(valor(args, "--valores") ?? uso('--valores "A:bien=10,mal=40;B:…"'));
      const r = dec.valorEsperado(root, id, esc, vals, !args.includes("--maximizar"));
      log(`EV: ${r.ev.map((x) => `${x.opcion} ${x.valor}`).join(" · ")} → mejor ${r.mejorEV} · minimax regret ${r.minimaxRegret} · mejor peor caso ${r.mejorPeorCaso}`);
    }
    if (valor(args, "--elegir")) dec.cerrar(root, id, valor(args, "--elegir")!, valor(args, "--porque") ?? uso('--porque "<con tus palabras>"'), { ...(valor(args, "--cambiaria") ? { cambiaria: valor(args, "--cambiaria")! } : {}), ...(valor(args, "--revisar") ? { revisar: valor(args, "--revisar")! } : {}), adr: args.includes("--adr") });
    const d = dec.buscar(root, id);
    return out(args, d, () => dec.describirDecision(d));
  },

  async desconectar(args, root) {
    const id = tareaId(args, root);
    const t = des.desconectarAMano(root, id, args.filter((a) => !a.startsWith("--") && a !== id).join(" ") || "a mano");
    return out(args, t, () => `⛔ ${id} desconectada: la IA ya no escribe en ella. \`cai volver ${id} --replanteo "…"\``);
  },

  async volver(args, root) {
    const id = tareaId(args, root);
    const r = des.volver(root, id, valor(args, "--replanteo") ?? uso('cai volver <id> --replanteo "<qué falló en el diseño o el plan>"'), { manual: args.includes("--manual") });
    return out(args, r, () => [`↶ ${id}: tu trabajo quedó en la rama ${r.rama}; ${r.archivos.length} archivo(s) volvieron a ${r.a}.`, args.includes("--manual") ? "Sigues a mano (ejecutor humano)." : `La tarea vuelve a "diseñada": ajusta el diseño con tu replanteo y pide otro plan.`]);
  },

  async informe(args, root) {
    if (args.includes("--semana")) return out(args, inf.informeSemana(root), () => inf.informeSemana(root));
    const r = inf.sinRevisar(root, { soloYo: args.includes("--yo"), incluirAjeno: args.includes("--ajeno") });
    return out(args, r, () => [...r.resumen, "", ...(r.filas.length ? ["Por riesgo:", ...r.filas.slice(0, Number(valor(args, "--max") ?? 25)).map((f) => `  ${f.archivo} · ${f.funcion} · ${f.lineas} línea(s) ${f.origen}${f.riesgo ? ` · riesgo ${f.riesgo}` : ""}`)] : ["Todo lo que no escribiste tú tiene evidencia ✔"])]);
  },

  async mapa(args, root) {
    if (valor(args, "--tarjeta")) {
      const m = valor(args, "--tarjeta")!;
      if (args.includes("--verificar")) {
        const r = await mapa.verificarTarjeta(root, m);
        return out(args, r, () => (r.ok ? `✔ tarjeta de ${m} vigente` : faltan(r.motivos)));
      }
      return out(args, {}, () => `Tarjeta: ${mapa.crearTarjeta(root, m)} (escríbela tú y luego \`cai mapa --tarjeta ${m} --verificar\`)`);
    }
    const parada = entero(args, "--parada");
    if (parada && valor(args, "--hipotesis")) {
      const r = await mapa.hipotesisParada(root, parada, valor(args, "--hipotesis")!);
      return out(args, r, () => ["Código:", r.codigo, "", "La IA (hipótesis a contrastar):", r.ia, "", `Ahora escribe la diferencia: cai mapa --parada ${parada} --diferencia "…"`]);
    }
    if (parada && valor(args, "--diferencia")) {
      const r = mapa.diferenciaParada(root, parada, valor(args, "--diferencia")!);
      log(r.mensaje);
      return r.ok ? 0 : 1;
    }
    if (valor(args, "--traza")) {
      const [archivo, expresion] = [valor(args, "--traza")!, valor(args, "--llamada") ?? uso('cai mapa --traza <archivo> --llamada "f(…)" --predigo "a,b,c"')];
      const r = mapa.trazaReal(root, archivo, expresion, (valor(args, "--predigo") ?? uso('--predigo "funciones que crees que corren, separadas por coma"')).split(","));
      return out(args, r, () => [`Corrieron de verdad: ${r.corrieron.join(" → ") || "(ninguna del proyecto)"}`, `Acertaste: ${r.acertaste.join(", ") || "-"}`, r.noCorrieron.length ? `Creías que corrían y no: ${r.noCorrieron.join(", ")}` : "", r.sorpresa.length ? `No las esperabas: ${r.sorpresa.join(", ")}` : "", `Resultado: ${r.resultado}`]);
    }
    if (args.includes("--recorrido")) {
      const ps = mapa.recorrido(root, { ...(valor(args, "--hacia") ? { hacia: valor(args, "--hacia")! } : {}) });
      return out(args, ps, () => (ps.length ? ["Recorrido (lo más central y riesgoso primero). En cada parada, ANTES de leerla: ¿qué crees que hace?", ...ps.map((p) => `  [${p.n}] ${p.nombre} — ${p.archivo} · ${p.firma}  → cai mapa --parada ${p.n} --hipotesis "…"`)] : ["Nada riesgoso sin entender ✔"]));
    }
    const m = mapa.mapaMermaid(root, { ...(valor(args, "--modulo") ? { modulo: valor(args, "--modulo")! } : {}) });
    const caducas = mapa.tarjetasCaducas(root);
    return out(args, { mermaid: m, caducas }, () => ["```mermaid", m, "```", "(⇢ punto de entrada · ⚠ riesgo: ajeno sin entender, central, sin tests)", ...(caducas.length ? [`Tarjetas caducas: ${caducas.join(", ")}`] : [])]);
  },

  async repaso(args, root) {
    const n = entero(args, "--item");
    if (n) {
      const r = await prac.responderRepaso(root, n, valor(args, "--llamada") ?? uso('--llamada "f(…)"'), valor(args, "--espero") ?? uso('--espero "…"'), valor(args, "--seguridad") ? Number(valor(args, "--seguridad")) : undefined);
      log(r.mensaje);
      return r.ok ? 0 : 1;
    }
    const items = await prac.itemsRepaso(root);
    return out(args, items, () => (items.length ? ["Repaso (5 min, sin mirar el código):", ...items.map((i) => `  [${i.n}] ${i.funcion ? `${i.archivo} · ${i.funcion} — ` : ""}${i.hace}\n      ${i.pide}`)] : ["Nada que repasar hoy ✔"]));
  },

  async kata(args, root) {
    if (args[0] === "verificar") {
      const r = await prac.verificarKata(args[1] ?? uso("cai kata verificar <id>"));
      log(r.mensajes);
      return r.ok ? 0 : 1;
    }
    const c = args[0] ?? uso("cai kata <construccion> (ej.: promise-all, regex, reduce)");
    const k = await prac.nuevaKata(root, c, valor(args, "--lenguaje") ?? "typescript");
    return out(args, k, () => [`Kata ${k.id}: ${describir(c)}`, k.consigna, "", `Carpeta SIN IA: ${k.dir}`, `1. Escribe ${k.archivo} a mano · 2. tu caso en caso.json · 3. cai kata verificar ${k.id}`]);
  },

  async reconstruir(args, root) {
    if (valor(args, "--terminar")) {
      const r = prac.terminarReconstruccion(root, valor(args, "--terminar")!);
      log([...r.mensajes, "", "Diff (original → tu versión):", r.diff.slice(0, 4000)]);
      return r.ok ? 0 : 1;
    }
    const cands = await prac.candidatasReconstruccion(root);
    const n = entero(args, "--empezar");
    if (n) {
      const c = cands[n - 1] ?? uso(`no hay candidata ${n}`);
      const r = await prac.empezarReconstruccion(root, c);
      return out(args, r, () => [`Worktree SIN IA: ${r.dir}`, `Reconstruye ${c.funcion} (${c.archivo}) desde cero, solo con documentación oficial.`, `Oráculo oculto: ${r.oraculo.length} archivo(s) de tests.`, `Al terminar: cai reconstruir --terminar "<qué difiere tu versión y por qué>"`]);
    }
    return out(args, cands, () => (cands.length ? ["Candidatas de la semana (más código de la IA). Elige una:", ...cands.map((c, i) => `  [${i + 1}] ${c.funcion} — ${c.archivo} (${c.lineasIa} líneas de la IA, tarea ${c.tarea})`), "cai reconstruir --empezar N"] : ["No hay funcionalidades de la IA cerradas esta semana: nada que reconstruir ✔"]));
  },

  async yo(args) {
    if (valor(args, "--exportar")) {
      exportarExpediente(valor(args, "--exportar")!);
      return out(args, {}, () => `✔ expediente exportado a ${valor(args, "--exportar")}`);
    }
    if (valor(args, "--importar")) {
      importarExpediente(valor(args, "--importar")!);
      return out(args, {}, () => "✔ expediente importado (se unió con el tuyo)");
    }
    return out(args, resumenExpediente(), () => resumenExpediente());
  },

  async hoy(args, root) {
    if (valor(args, "--foco")) fijarFoco(root, valor(args, "--foco")!, args.filter((a) => /^t\d+$/.test(a)));
    if (args.includes("--cerrar")) {
      const s = cerrarSesionDelDia(root);
      return out(args, s, () => [`Foco: ${s.foco}`, `Hechas: ${s.cierre!.hechas.join(", ") || "-"} · pendientes: ${s.cierre!.pendientes.join(", ") || "-"} · aparecieron: ${s.cierre!.aparecieron.join(", ") || "-"}`]);
    }
    return out(args, inf.hoy(root), () => inf.hoy(root));
  },

  async git(args, root) {
    if (args.includes("--ejecutar")) {
      log(ag.ejecutarPlanGit(root, valor(args, "--confirmo")));
      return 0;
    }
    const p = await ag.traducirGit(root, args.filter((a) => !a.startsWith("--")).join(" "));
    return out(args, p, () => [...p.comandos.map((c, i) => `${i + 1}. ${c.cmd}\n   ${c.explica}${c.riesgos.length ? `\n   ⚠ ${c.riesgos.join("; ")}` : ""}`), ...p.advertencias.map((a) => `⚠ ${a}`), "", p.comandos.length ? "Nada se ejecutó. Si estás de acuerdo: cai git --ejecutar (lo destructivo pide --confirmo <rama>)" : ""]);
  },

  async paralelo(args, root) {
    const ids = args.filter((a) => /^t\d+$/.test(a));
    if (!ids.length) return out(args, ag.tablero(root), () => ag.tablero(root));
    for (const id of ids) {
      const w = ag.crearWorktree(root, id);
      log(`${id}: ${w.dir} (rama ${w.rama})`);
    }
    return 0;
  },

  async agente(args, root) {
    const id = tareaId(args, root);
    const rol = (args.find((a) => ["implementador", "tester", "revisor", "refactorizador"].includes(a)) ?? uso("cai agente <id> implementador|tester|revisor|refactorizador")) as ag.RolAgente;
    const r = await ag.correrAgente(root, id, rol, valor(args, "--extra") ?? "");
    return out(args, r, () => [r.texto, r.tocados.length ? `Archivos: ${r.tocados.join(", ")} (sin revisar: \`cai revisar --tarea ${id}\`)` : ""]);
  },

  async traspaso(args, root) {
    const f = await ag.traspaso(root, tareaId(args, root));
    return out(args, { archivo: f }, () => `Traspaso en ${f}. CORRÍGELO y abre una sesión nueva (/clear): se inyecta al empezar.`);
  },

  async renombrar(args, root) {
    const [viejo, nuevo] = args.filter((a) => !a.startsWith("--") && a !== valor(args, "--en"));
    if (!viejo || !nuevo) uso("cai renombrar <viejo> <nuevo> [--en \"src/**\"]");
    const r = await (await import("../flujos/renombrar.js")).renombrar(root, viejo, nuevo, { ...(valor(args, "--en") ? { en: valor(args, "--en")! } : {}) });
    return out(args, r, () => (r.archivos.length ? [`✔ ${viejo} → ${nuevo} (herramienta determinista, verificado): ${r.archivos.map((a) => `${a.archivo} (${a.cambios})`).join(", ")}`, "Esas líneas quedan como «herramienta»: no necesitan revisión línea por línea."] : [`${viejo} no aparece en el proyecto`]));
  },

  async reglas(args, root) {
    if (args.includes("--estadisticas")) {
      const { leerRebates } = await import("../flujos/juez.js");
      const rebates = leerRebates(root);
      const porMotivo = new Map<string, number>();
      for (const r of rebates) for (const m of r.motivos.length ? r.motivos : ["(sin motivo)"]) porMotivo.set(m.split(":")[0]!.slice(0, 60), (porMotivo.get(m.split(":")[0]!.slice(0, 60)) ?? 0) + 1);
      const noAplica = cargarDecisiones(root).filter((d) => d.estado === "vigente" && /^no aplica/i.test(d.eleccion ?? ""));
      const porDetector = new Map<string, number>();
      for (const d of noAplica) porDetector.set(d.pregunta.split(" (")[0]!.replace(/^¿/, "").slice(0, 60), (porDetector.get(d.pregunta.split(" (")[0]!.replace(/^¿/, "").slice(0, 60)) ?? 0) + 1);
      return out(args, { rebates: Object.fromEntries(porMotivo), noAplica: Object.fromEntries(porDetector) }, () => [
        `Rebates al decisor: ${rebates.length}`,
        ...[...porMotivo].sort((a, b) => b[1] - a[1]).map(([m, n]) => `  ${n} × ${m}`),
        `«No aplica porque…» en hallazgos: ${noAplica.length}`,
        ...[...porDetector].sort((a, b) => b[1] - a[1]).map(([m, n]) => `  ${n} × ${m}`),
        "Si una regla se salta mucho, ajustar su umbral es una decisión tuya (queda registrada).",
      ]);
    }
    if (args.includes("--compilar")) return out(args, compilarReglas(root), () => `✔ ${compilarReglas(root).join(", ") || "nada que cambiar"}`);
    const archivo = args.find((a) => !a.startsWith("--"));
    if (archivo) return out(args, reglaEfectiva(root, archivo), () => reglaEfectiva(root, archivo).map((r) => `[${r.origen}] ${r.regla}`));
    const g = globales();
    return out(args, {}, () => [`Globales: ${g.existe ? "✔" : "✘ faltan (~/.cai/reglas-globales.md)"}`, `Proyecto, secciones que faltan: ${seccionesFaltantes(root).join(", ") || "ninguna ✔"}`, `Stack vs. manifiestos: ${derivaDeStack(root).join(" · ") || "sin diferencias ✔"}`, "Regla efectiva de un archivo: cai reglas <archivo>"]);
  },

  async ia(args, root) {
    const c = loadConfig(root);
    if (args[0] === "evaluar") {
      const refs = args.slice(1).filter((a) => !a.startsWith("--"));
      const es = await evaluar(c, root, refs.length ? refs : c.ia.decisor.cadena.length ? c.ia.decisor.cadena : CADENA_POR_DEFECTO);
      return out(args, es, () => (es.length ? es.map((e) => `${e.aprobado ? "✔" : "✘"} ${e.ref}: acierto ${Math.round(e.acierto * 100)}% · Brier ${e.brier.toFixed(3)} (calibración: menor es mejor) · ${e.msMedio} ms · ${e.casos} casos`) : ["ningún decisor disponible para evaluar"]));
    }
    if (args[0] === "uso") {
      const u = leerUso(Number(valor(args, "--dias") ?? 7));
      const por = new Map<string, number>();
      for (const x of u) por.set(x.kind.split(":")[0]!, (por.get(x.kind.split(":")[0]!) ?? 0) + (x.costo ?? 0));
      return out(args, Object.fromEntries(por), () => [...por].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: US$${v.toFixed(3)}`));
    }
    const motores = motoresDe(c);
    const fila = (r: Rol) => {
      const ref = refDeRol(c, r);
      const [m] = ref.split(":");
      const def = motores[m!];
      return `${r.padEnd(13)} ${ref}${def ? (disponible(def) ? "" : " (no disponible)") : " (motor desconocido)"}${def && permitido(c, m!, def) ? ` (${permitido(c, m!, def)})` : ""}`;
    };
    return out(args, {}, () => ["Roles (motor:modelo):", ...(Object.keys(ROLES_POR_DEFECTO) as Rol[]).map(fila), "", `Decisor (System One, escala por incertidumbre ≥ ${c.ia.decisor.umbral}): ${(c.ia.decisor.cadena.length ? c.ia.decisor.cadena : CADENA_POR_DEFECTO).join(" → ")} → heurística`, `Privacidad: ${c.ia.privacidad} · opt-in: ${c.ia.optIn.join(", ") || "-"}`]);
  },

  async asentar(args, root) {
    const archivo = args.find((a) => !a.startsWith("--")) ?? uso("cai asentar <archivo> [--pegado 3,4,5] [--ia-probable 7,8]");
    const rel = path.relative(root, path.resolve(root, archivo)).split(path.sep).join("/");
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) return 0;
    const { asentar, marcarOrigen } = await import("../proyecto/procedencia.js");
    const nuevas = asentar(root, rel, fs.readFileSync(abs, "utf8"), { origen: "humano" });
    const lista = (f: string) => (valor(args, f) ?? "").split(",").map((x) => Number(x) - 1).filter((n) => n >= 0);
    const pegadas = marcarOrigen(root, rel, lista("--pegado"), "pegado");
    const probables = marcarOrigen(root, rel, lista("--ia-probable"), "ia-probable");
    return out(args, { nuevas: nuevas.length, pegadas, probables }, () => `${rel}: ${nuevas.length} línea(s) tuyas${pegadas ? ` · ${pegadas} pegada(s) (necesitan revisión)` : ""}${probables ? ` · ${probables} ia-probable` : ""}`);
  },

  async adoptar(args, root) {
    const r = inf.adoptar(root);
    return out(args, r, () => [`${r.archivos} archivo(s) clasificados con git (tuyo previo / heredado / IA previa). Todo empieza sin evidencia.`, ...r.resumen]);
  },

  async migrar(args, root) {
    const r = migrar(root, args.includes("--aplicar"));
    return out(args, r, () => [r.yaMigrado ? "Ya está en v1." : args.includes("--aplicar") ? "Migrado a v1:" : "SIMULACIÓN (nada se escribió; con --aplicar se hace):", ...r.acciones.map((a) => `  ✔ ${a}`), ...r.descartado.map((d) => `  ✖ se descarta ${d}`), ...r.avisos.map((a) => `  ⚠ ${a}`)]);
  },

  async ci(args, root) {
    const r = ci(root);
    if (valor(args, "--sarif")) fs.writeFileSync(valor(args, "--sarif")!, sarif(r.bloqueos));
    out(args, r, () => [r.resumen, ...r.bloqueos.slice(0, 50).map((b) => `✘ ${b.archivo}${b.linea ? `:${b.linea}` : ""} ${b.motivo}`)]);
    return r.bloqueos.length ? 1 : 0;
  },

  async githook(args, root) {
    const nombre = args[0];
    if (nombre === "pre-commit") {
      const b = await preCommit(root);
      if (b.length) {
        console.error(`cai: el commit lleva código que nadie revisó (manifiesto I.3):\n${b.slice(0, 30).map((x) => `  ✘ ${x.archivo}${x.linea ? `:${x.linea}` : ""} ${x.motivo}`).join("\n")}`);
        return 1;
      }
      return 0;
    }
    if (nombre === "commit-msg") {
      commitMsg(root, args[1] ?? uso("githook commit-msg <archivo>"));
      return 0;
    }
    if (nombre === "post-commit") {
      const m = await postCommit(root);
      if (m.length) console.log(`cai: ${m.join(" · ")}`);
      return 0;
    }
    if (nombre === "pre-push") {
      const b = prePush(root);
      if (b.length) console.error(`cai: ${b.map((x) => x.motivo).join("; ")}`);
      return b.length ? 1 : 0;
    }
    if (nombre === "post-checkout") {
      const m = postCheckout(root);
      if (m) console.error(`cai: ⚠ ${m}`);
      return 0;
    }
    uso("githook pre-commit|commit-msg|post-commit|pre-push|post-checkout");
  },

  async "merge-procedencia"(args) {
    mergeProcedencia(args[0] ?? uso("merge-procedencia %O %A %B"), args[1]!, args[2]!);
    return 0;
  },

  async mcp(_args, root) {
    return (await import("./mcp.js")).servirMcp(root);
  },

  async juez(args, root) {
    if (args[0] !== "rebatir") uso('cai juez rebatir --texto "…" --porque "…"');
    const r = rebatir(root, { que: "pedido", texto: valor(args, "--texto") ?? "", motivos: [], argumento: valor(args, "--porque") ?? "", fuente: "decisor" });
    return out(args, r, () => "✔ registrado: alimenta `cai ia evaluar`");
  },
};

/** Ejecuta un comando v1, o null si no es de la superficie v1 (lo atiende la CLI de siempre). */
export async function ejecutarV1(argv: string[], root: string): Promise<number | null> {
  const [cmd, ...resto] = argv;
  if (!cmd) return null;
  if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    if (argv.includes("--todo")) return null;
    log(AYUDA_V1);
    return 0;
  }
  // `revisar <archivo>` sigue siendo la revisión clásica; `revisar --tarea` es la v1.
  if (cmd === "revisar" && !resto.includes("--tarea") && !resto.includes("--archivo") && resto.some((a) => !a.startsWith("--"))) return null;
  if (cmd === "revisar" && !resto.length) return null;
  const run = COMANDOS[cmd];
  if (!run) return null;
  return run(resto, root);
}

export const comandosV1 = () => Object.keys(COMANDOS);
void path;
