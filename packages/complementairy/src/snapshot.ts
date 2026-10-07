import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir, type Zoner } from "./config.js";
import { listFiles } from "./files.js";
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

export function takeSnapshot(z: Zoner, id: string): void {
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
