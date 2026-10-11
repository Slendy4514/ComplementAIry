import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir, type Zoner } from "../proyecto/config.js";
import { decisionesHonestas } from "../proyecto/decisiones.js";
import { objetivosHonestos } from "../proyecto/entender.js";
import { listFiles } from "../proyecto/files.js";
import { parseMemoria, sinSugerencia, unaLinea } from "../nucleo/memoria.js";
import { snippetPolicy } from "../proyecto/snippets.js";
import { langFor } from "../nucleo/lang.js";
import { verifyCommentOnly } from "../nucleo/soloComentarios.js";
import { SOLO_HUMANO_V1 } from "../cli/soloHumano.js";

/**
 * Red de seguridad para Bash: antes de cada comando de la IA se guarda una foto del proyecto
 * y después se compara. Cualquier cambio que no sea "solo comentarios @guia" en zona humana
 * se revierte. Lo revertido nunca se pierde: queda en .cai/cache/cuarentena/.
 */

const cacheDir = (root: string) => path.join(dataDir(root), "cache");
const sha1 = (buf: Buffer) => crypto.createHash("sha1").update(buf).digest("hex");

type Manifest = Record<string, string>;

/** Archivos vigilados: los del proyecto más la configuración interna de git (hooks, config). */
function watched(z: Zoner): string[] {
  const extra: string[] = [];
  const git = path.join(z.root, ".git");
  if (fs.existsSync(path.join(git, "config"))) extra.push(".git/config");
  const hooks = path.join(git, "hooks");
  if (fs.existsSync(hooks)) for (const f of fs.readdirSync(hooks)) extra.push(`.git/hooks/${f}`);
  // Las propuestas del modo programar viven en .cai/cache (ignorado por git) pero se vigilan: aprobar
  // una porción (el probador) es del humano, y un comando de la IA no puede hacerlo por él.
  const prop = path.join(cacheDir(z.root), "propuestas");
  if (fs.existsSync(prop)) for (const f of fs.readdirSync(prop)) if (f.endsWith(".json")) extra.push(path.relative(z.root, path.join(prop, f)).split(path.sep).join("/"));
  return [...listFiles(z), ...extra];
}

/** Clave reservada del manifiesto donde se guarda el comando (no es una ruta posible). */
const CMD = "\u0000comando";

/** Lo que SOLO puede hacer el humano (el hook lo rechaza antes de correr; si igual corre, se revierte). */
const SOLO_HUMANO: [RegExp, string][] = [
  [/\bdecisiones\s+(decidir|retractar)\b/, "decidir o retractar una decisión"],
  [/\bentender\s+(confirmar|reabrir|terminado)\b/, "confirmar, reabrir o dar por terminados los objetivos"],
  [/\bchat\b.*--aplicar\b/, "aplicar una propuesta del chat"],
  [/\bmemoria\s+(corregir|quitar|responder)\b/, "corregir la memoria o responder sus preguntas"],
  [/\b(ideas|tareas)\s+descartar\b/, "descartar una idea o una tarea"],
  [/\bprogramar\s+(contrato|probar|insertado|diferida|orden|pedir|auxiliares|deshacer|idea|predecir|caso|quitar|dejar)\b/, "dar la orden de un paso (o deshacerlo), decir tu idea, quitar o dejar algo, predecir, editar un caso, probar o registrar lo insertado"],
  [/\bprogramar\s+plan\b.*--pasos\b/, "editar el plan"],
  [/\brepertorio\s+borrar\b/, "borrar del repertorio personal"],
  [/\bnotas\s+anotar\b/, "escribir en las notas a nombre del programador"],
];

/** Si el comando es de los que solo hace el humano, por qué (para rechazarlo antes de correr). */
export function soloHumano(comando: string): string | null {
  if (!/\b(cai|complementairy|aicode|cli\.js)\b/.test(comando)) return null;
  const plano = comando.replace(/['"\\]/g, "");
  const viejo = SOLO_HUMANO.find(([re]) => re.test(plano))?.[1];
  if (viejo) return viejo;
  // v1: el patrón se aplica al subcomando (lo que sigue al binario), en cada invocación del comando.
  for (const m of plano.matchAll(/(?:^|[\s;&|(])(?:cai|complementairy|aicode|\S*cli\.js)\s+([^;&|\n]*)/g)) {
    const hit = SOLO_HUMANO_V1.find(([re]) => re.test(m[1]!.trim()));
    if (hit) return hit[1];
  }
  return null;
}

/** Una propuesta escrita por un comando de la IA: ninguna porción aprobada ni probada (o se borró). */
/**
 * Un comando de la IA sobre una propuesta (ofrecer, otra forma, pedir casos) no puede AGREGAR nada de lo
 * que hace el programador: pasos escritos con su orden, probados o con su idea, su predicción ni casos
 * suyos. Puede conservar lo que ya estaba.
 */
function propuestaHonesta(antes: Buffer | null, despues: Buffer | null): boolean {
  if (!despues) return true;
  type P = { tipo?: string; porciones?: { tipo?: string; codigo?: string; orden?: string; aprobada?: boolean; idea?: string; pruebas?: unknown[]; verificacion?: { dejado?: boolean } }[]; construir?: { ofertas?: { ideaTuya?: string }[]; previo?: { estado: string }[]; prediccion?: { espero?: string }; casos?: { llamada: string; esperado: string; tuyo?: boolean }[] } };
  try {
    const leer = (b: Buffer | null): P => (b ? (JSON.parse(b.toString("utf8")) as P) : {});
    const a = leer(antes);
    const d = leer(despues);
    // Lo que hace el programador: en construir juntos, cada paso escrito (solo con su orden); en cualquier
    // propuesta, lo probado y su idea. Su código previo ("ya-estaba") no cuenta.
    const hechos = (p: P) =>
      new Set(
        (p.porciones ?? [])
          .filter((x) => x.tipo !== "ya-estaba")
          .flatMap((x) => [p.tipo === "construir" ? `c|${x.codigo ?? ""}|${x.orden ?? ""}` : "", x.aprobada ? `a|${x.codigo}` : "", x.idea ? `d|${x.idea}` : "", x.pruebas?.length ? `p|${x.codigo}|${x.pruebas.length}` : ""].filter(Boolean)),
      );
    const ya = hechos(a);
    if ([...hechos(d)].some((h) => !ya.has(h))) return false;
    // Tu idea (aprender) y lo que decidiste sobre las sugerencias a tu código previo: solo tuyos.
    const ideas = new Set((a.construir?.ofertas ?? []).map((x) => x.ideaTuya).filter(Boolean));
    if ((d.construir?.ofertas ?? []).some((x) => x.ideaTuya && !ideas.has(x.ideaTuya))) return false;
    if ((d.construir?.previo ?? []).some((x, i) => x.estado !== "pendiente" && x.estado !== a.construir?.previo?.[i]?.estado)) return false;
    if (d.porciones?.some((x) => x.verificacion?.dejado && !a.porciones?.some((y) => y.codigo === x.codigo && y.verificacion?.dejado))) return false;
    if (d.construir?.prediccion?.espero !== undefined && d.construir.prediccion.espero !== a.construir?.prediccion?.espero) return false;
    const tuyos = new Set((a.construir?.casos ?? []).filter((x) => x.tuyo).map((x) => `${x.llamada}→${x.esperado}`));
    return (d.construir?.casos ?? []).filter((x) => x.tuyo).every((x) => tuyos.has(`${x.llamada}→${x.esperado}`));
  } catch {
    return false;
  }
}

/** Notas cambiadas por `cai entender --funcion`: nadie confirma ni da por terminado un objetivo por el programador. */
function objetivosDeNotasIntactos(antes: Buffer | null, despues: Buffer | null): boolean {
  type N = { id: string; objetivo?: { confirmado?: string; terminada?: string } };
  const leer = (b: Buffer | null): N[] | null => {
    if (!b) return [];
    try {
      return (JSON.parse(b.toString("utf8")) as { notas?: N[] }).notas ?? [];
    } catch {
      return null;
    }
  };
  const a = leer(antes);
  const d = leer(despues);
  if (!a || !d) return false;
  return d.every((n) => {
    const v = a.find((x) => x.id === n.id);
    return (n.objetivo?.confirmado ?? "") === (v?.objetivo?.confirmado ?? "") && (n.objetivo?.terminada ?? "") === (v?.objetivo?.terminada ?? "");
  });
}

/**
 * Archivos que un comando de ComplementAIry (ejecutado por la IA desde el chat) puede generar.
 * Solo si el comando es UNA llamada a cai, sin encadenar nada (&&, ;, |, >, $(...)).
 */
export function generadosPor(comando: string): ((rel: string, antes: Buffer | null, despues: Buffer | null) => boolean) | null {
  const m = /^\s*(?:cai|complementairy|aicode)\s+([\w-]+)(?:\s+[^;&|<>`$()\n]*)?$/.exec(comando);
  if (!m) return null;
  // Comillas y barras no esconden un subcomando ("notas 'anotar'", "anot\\ar"): se comparan sin ellas.
  const plano = comando.replace(/['"\\]/g, "");
  const datos = (rel: string) => /^\.(cai|aicode)\//.test(rel);
  const plantilla = (b: Buffer | null) => !b || b.toString("utf8").replace(/<!--[\s\S]*?-->/g, "").replace(/^#.*$/gm, "").trim() === "";
  // conocimiento.md: el comando puede agregar preguntas, pero no tocar lo que TÚ respondiste ni tus notas.
  // Con `moverR` (panorama) también puede pasar a "Lo que me contaste" lo que escribiste después de "R:".
  const memoriaHonesta = (rel: string, antes: Buffer | null, despues: Buffer | null, moverR: boolean) => {
    if (!/\/conocimiento\.md$/.test(rel)) return false;
    const a = parseMemoria(antes?.toString("utf8") ?? "");
    const d = parseMemoria(despues?.toString("utf8") ?? "");
    if (d.notas !== a.notas || a.respondidas.some((r, i) => d.respondidas[i] !== r)) return false;
    const movibles = new Set(a.abiertas.filter((x) => x.r).map((x) => `${sinSugerencia(x.p)} → ${unaLinea(x.r)}`));
    return d.respondidas.slice(a.respondidas.length).every((r) => moverR && movibles.has(r));
  };
  // Notas, tareas, índice y decisiones PROPUESTAS (decidir o retractar es solo humano: comando aparte).
  const notasYTareas = (rel: string, antes: Buffer | null, despues: Buffer | null) =>
    /^\.(cai|aicode)\/(notas\/[^/]+\.json|tareas\.json|indice\.json)$/.test(rel) || (/^\.(cai|aicode)\/decisiones\.json$/.test(rel) && decisionesHonestas(antes, despues));
  // Conversar (chat/entender): sus conversaciones, decisiones PROPUESTAS y el BORRADOR de objetivos (nunca lo confirmado).
  const conversar = (rel: string, antes: Buffer | null, despues: Buffer | null) =>
        (datos(rel) && (/\/chats\/[\w-]+\.json$/.test(rel) || /\/chat\.json$/.test(rel) || /\/objetivos\.md$/.test(rel) || (/\/objetivos\.json$/.test(rel) && objetivosHonestos(antes, despues)))) ||
        (/^\.(cai|aicode)\/decisiones\.json$/.test(rel) && decisionesHonestas(antes, despues));
  switch (m[1]) {
    case "guia":
    case "revisar":
    case "notas":
      // "anotar" escribe mensajes a tu nombre: solo desde la extensión, no desde el chat.
      return /\bnotas\s+anotar\b/.test(plano) ? null : notasYTareas;
    case "responder":
    case "predecir":
    case "check":
    case "verificar":
    case "siguiente":
      return notasYTareas;
    case "hoy":
    case "deuda":
    case "sesion":
      return () => false; // solo leen (el marcador de visita vive en .cai/cache)
    case "indice":
      return (rel) => /^\.(cai|aicode)\/indice\.json$/.test(rel);
    case "entender":
      // Objetivo de una función/archivo (--funcion/--archivo): su nota, sin confirmar ni terminar por él.
      if (/\bentender\s+(confirmar|reabrir|terminado)\b/.test(plano)) return null;
      if (/--(funcion|archivo)\b/.test(plano)) return (rel, antes, despues) => /^\.(cai|aicode)\/notas\/[^/]+\.json$/.test(rel) && objetivosDeNotasIntactos(antes, despues);
      return conversar;
    case "chat":
      // Aplicar una propuesta (tareas, correcciones): solo humano.
      return /--aplicar\b/.test(plano) ? null : conversar;
    case "decisiones":
      // Consultar sí; decidir y retractar los decide el humano (desde el panel o la terminal).
      return /\bdecisiones\s+(decidir|retractar)\b/.test(plano) ? null : (rel, antes, despues) => /^\.(cai|aicode)\/decisiones\.json$/.test(rel) && decisionesHonestas(antes, despues);
    case "programar":
      // Tus casos, el probador, el plan que editas y registrar lo que insertaste: solo humano (si lo hiciera
      // la IA, se probaría a sí misma). Proponer (plan, paso, pr, descartar): sus notas y tareas, y propuestas
      // SIN aprobar (ninguna porción probada).
      if (/\bprogramar\s+(contrato|probar|insertado|diferida|orden|pedir|auxiliares|deshacer|idea|predecir|caso|quitar|dejar)\b/.test(plano) || (/\bprogramar\s+plan\b/.test(plano) && /--pasos\b/.test(plano))) return null;
      return (rel, antes, despues) => notasYTareas(rel, antes, despues) || (/\/cache\/propuestas\/[^/]+\.json$/.test(rel) && propuestaHonesta(antes, despues));
    case "repertorio":
      return /\brepertorio\s+borrar\b/.test(plano) ? null : () => false;
    case "ideas":
      // Descartar una idea es definitivo (no vuelve a proponerse): eso lo decide el humano.
      return /\bideas\s+descartar\b/.test(plano) ? null : (rel) => /^\.(cai|aicode)\/(ideas|tareas)\.json$/.test(rel);
    case "tareas":
      // Descartar una tarea es definitivo (no vuelve a proponerse): eso lo decide el humano.
      return /\btareas\s+descartar\b/.test(plano) ? null : notasYTareas;
    case "tests":
      return notasYTareas; // el archivo de tests nuevo/ampliado ya pasa por "solo comentarios"
    case "panorama":
      return (rel, antes, despues) => (datos(rel) && (/\/(panorama\.md|ideas\.json)$/.test(rel) || memoriaHonesta(rel, antes, despues, true))) || notasYTareas(rel, antes, despues);
    case "conocer":
      // proyecto.md / reglas.md solo si estaban vacíos (si no, el comando escribe *.borrador.md).
      return (rel, antes) => datos(rel) && (/\/(conocimiento|proyecto\.borrador|reglas\.borrador)\.md$/.test(rel) || (/\/(proyecto|reglas)\.md$/.test(rel) && plantilla(antes)));
    case "plano":
    case "acompanar": // el acompañante propone la estructura del proyecto si no hay una
      return (rel, antes, despues) =>
        rel === "docs/ESTRUCTURA.md" || (datos(rel) && (/\/estructura\.json$/.test(rel) || memoriaHonesta(rel, antes, despues, false))) || notasYTareas(rel, antes, despues);
    // v1: lo que la IA puede correr (los flags solo-humano ya se rechazaron antes; ver SOLO_HUMANO_V1).
    case "avanzar":
    case "tarea":
    case "pruebas":
    case "traspaso":
      return (rel, antes, despues) => /^\.cai\/tareas\/t\d+\/(tarea\.json|traspaso\.md)$/.test(rel) || (/^\.cai\/decisiones\.json$/.test(rel) && decisionesHonestas(antes, despues));
    case "decidir":
      return (rel, antes, despues) => /^\.cai\/decisiones\.json$/.test(rel) && decisionesHonestas(antes, despues);
    case "adoptar":
      return (rel) => /^\.cai\/procedencia\/[^/]+\.json$/.test(rel);
    case "informe":
    case "mapa":
    case "repaso":
    case "reconstruir":
    case "yo":
    case "reglas":
    case "ia":
    case "ci":
    case "git":
    case "pedido":
      return () => false; // solo leen (lo que guardan va a .cai/cache)
    case "arquitectura":
    case "adr":
      return (rel) => /^docs\/adr\/[^/]+\.md$/.test(rel);
    default:
      return null;
  }
}

export function takeSnapshot(z: Zoner, id: string, comando = ""): void {
  const blobs = path.join(cacheDir(z.root), "blobs");
  fs.mkdirSync(blobs, { recursive: true });
  const manifest: Manifest = {};
  for (const f of watched(z)) {
    const abs = path.join(z.root, f);
    let st: fs.Stats;
    try {
      st = fs.statSync(abs);
    } catch {
      continue;
    }
    if (!st.isFile() || st.size > z.config.snapshot.maxBytes) continue;
    const buf = fs.readFileSync(abs);
    const h = sha1(buf);
    const blob = path.join(blobs, h);
    if (!fs.existsSync(blob)) fs.writeFileSync(blob, buf);
    manifest[f] = h;
  }
  const snaps = path.join(cacheDir(z.root), "snap");
  fs.mkdirSync(snaps, { recursive: true });
  if (comando) manifest[CMD] = comando;
  fs.writeFileSync(path.join(snaps, `${safeId(id)}.json`), JSON.stringify(manifest));
}

const safeId = (id: string) => id.replace(/[^\w-]/g, "_");

export interface Action {
  file: string;
  action: "revertido" | "restaurado" | "cuarentena" | "permitido";
  why: string;
}

export async function checkSnapshot(z: Zoner, id: string): Promise<Action[]> {
  const snapFile = path.join(cacheDir(z.root), "snap", `${safeId(id)}.json`);
  if (!fs.existsSync(snapFile)) return [];
  let before: Manifest;
  try {
    before = JSON.parse(fs.readFileSync(snapFile, "utf8")) as Manifest;
  } catch {
    fs.rmSync(snapFile, { force: true });
    throw new Error("la foto previa al comando está dañada; no se pudo verificar qué cambió. Revisa los cambios con git diff.");
  }
  fs.rmSync(snapFile);
  const blobs = path.join(cacheDir(z.root), "blobs");
  const quarantine = path.join(cacheDir(z.root), "cuarentena", new Date().toISOString().replace(/[:.]/g, "-"));
  const actions: Action[] = [];

  const now = new Map<string, Buffer>();
  for (const f of watched(z)) {
    const abs = path.join(z.root, f);
    try {
      const st = fs.statSync(abs);
      if (st.isFile() && st.size <= z.config.snapshot.maxBytes) now.set(f, fs.readFileSync(abs));
    } catch {
      /* desapareció entre el listado y la lectura */
    }
  }

  const keepAside = (f: string, buf: Buffer) => {
    const dest = path.join(quarantine, f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
  };

  const comando = before[CMD] ?? "";
  delete before[CMD];
  const permitido = generadosPor(comando);
  for (const f of new Set([...Object.keys(before), ...now.keys()])) {
    try {
      await checkOne(f);
    } catch (e) {
      actions.push({ file: f, action: "permitido", why: `NO VERIFICADO (${e instanceof Error ? e.message : String(e)}): revisalo a mano` });
    }
  }
  return actions;

  async function checkOne(f: string): Promise<void> {
    const abs = path.join(z.root, f);
    const oldHash = before[f];
    const cur = now.get(f);
    if (oldHash && cur && sha1(cur) === oldHash) return;
    const zone = z.zoneOf(abs);
    if (zone === "delegada") return;
    if (permitido && permitido(f, oldHash ? fs.readFileSync(path.join(blobs, oldHash)) : null, fs.existsSync(abs) ? fs.readFileSync(abs) : null)) return; // salida de un comando de cai
    if (zone === "snippets" && cur && snippetPolicy(z, cur.toString("utf8")).allowed) return;
    const oldBuf = oldHash ? fs.readFileSync(path.join(blobs, oldHash)) : null;

    if (zone === "humana" && cur) {
      const lang = langFor(f);
      if (lang) {
        const v = await verifyCommentOnly(oldBuf?.toString("utf8") ?? "", cur.toString("utf8"), lang);
        if (v.ok) return;
      }
    }

    // Cambio no permitido: se aparta la versión actual y se vuelve a la anterior.
    if (cur) keepAside(f, cur);
    if (oldBuf) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, oldBuf);
      actions.push({ file: f, action: cur ? "revertido" : "restaurado", why: `zona ${zone}` });
    } else {
      fs.rmSync(abs, { force: true });
      actions.push({ file: f, action: "cuarentena", why: `archivo nuevo en zona ${zone}` });
    }
  }
}

/** Fotos que quedaron sin verificar (el comando se interrumpió): se verifican y se borran. */
export async function checkLeftovers(z: Zoner): Promise<Action[]> {
  const dir = path.join(cacheDir(z.root), "snap");
  if (!fs.existsSync(dir)) return [];
  const out: Action[] = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    try {
      out.push(...(await checkSnapshot(z, f.slice(0, -5))));
    } catch {
      fs.rmSync(path.join(dir, f), { force: true });
    }
  }
  return out;
}
