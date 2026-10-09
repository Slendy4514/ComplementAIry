import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir, type Zoner } from "./config.js";
import { decisionesHonestas } from "./decisiones.js";
import { listFiles } from "./files.js";
import { parseMemoria, sinSugerencia, unaLinea } from "./memoria.js";
import { snippetPolicy } from "./snippets.js";
import { langFor } from "./lang.js";
import { verifyCommentOnly } from "./verify.js";

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
  return [...listFiles(z), ...extra];
}

/** Clave reservada del manifiesto donde se guarda el comando (no es una ruta posible). */
const CMD = "\u0000comando";

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
    case "chat":
      return (rel, antes, despues) => (datos(rel) && /\/chat\.json$/.test(rel)) || notasYTareas(rel, antes, despues);
    case "decisiones":
      // Consultar sí; decidir y retractar los decide el humano (desde el panel o la terminal).
      return /\bdecisiones\s+(decidir|retractar)\b/.test(plano) ? null : () => false;
    case "tareas":
      // Descartar una tarea es definitivo (no vuelve a proponerse): eso lo decide el humano.
      return /\btareas\s+descartar\b/.test(plano) ? null : notasYTareas;
    case "tests":
      return notasYTareas; // el archivo de tests nuevo/ampliado ya pasa por "solo comentarios"
    case "panorama":
      return (rel, antes, despues) => (datos(rel) && (/\/panorama\.md$/.test(rel) || memoriaHonesta(rel, antes, despues, true))) || notasYTareas(rel, antes, despues);
    case "conocer":
      // proyecto.md / reglas.md solo si estaban vacíos (si no, el comando escribe *.borrador.md).
      return (rel, antes) => datos(rel) && (/\/(conocimiento|proyecto\.borrador|reglas\.borrador)\.md$/.test(rel) || (/\/(proyecto|reglas)\.md$/.test(rel) && plantilla(antes)));
    case "plano":
    case "acompanar": // el acompañante propone la estructura del proyecto si no hay una
      return (rel, antes, despues) =>
        rel === "docs/ESTRUCTURA.md" || (datos(rel) && (/\/estructura\.json$/.test(rel) || memoriaHonesta(rel, antes, despues, false))) || notasYTareas(rel, antes, despues);
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
    throw new Error("la foto previa al comando está dañada; no se pudo verificar qué cambió. Revisá los cambios con git diff.");
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
