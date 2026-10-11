/**
 * Segunda y tercera barrera (después de los hooks de Claude Code): git hooks y CI. Si alguien se salta un
 * hook (--no-verify) o usa otra IA, la siguiente lo detecta: CI recalcula todo desde lo que está en el repo.
 *
 *   pre-commit     lo de la IA (y lo pegado / de origen desconocido) que va en el commit tiene evidencia (nivel ≥ 2);
 *                  nada de la IA en líneas rojas; sus tareas están "probada"; dependencia nueva → decisión vigente
 *   commit-msg     trailers: Cai-Tarea, Cai-IA (líneas y revisadas), Cai-Humano
 *   post-commit    cierra las tareas del commit, registra el último commit verde, licencias por lo que escribiste
 *                  a mano y quedó en verde, tu expediente
 *   pre-push       convención de ramas
 *   post-checkout  avisa si la rama no cumple la convención
 *   merge driver   une los registros de procedencia por huella (nunca un conflicto a mano)
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { dataDir, makeZoner } from "../proyecto/config.js";
import { cargarDecisiones } from "../proyecto/decisiones.js";
import { langFor } from "../nucleo/lang.js";
import { parse } from "../nucleo/comments.js";
import { medir } from "../proyecto/metricas.js";
import { dividir, huellaLinea } from "../nucleo/diffLineas.js";
import { construccionesDe } from "../nucleo/construcciones.js";
import { asentar, cargarRegistro, codificar, contar, listarRegistros, NECESITAN_EVIDENCIA, unirRegistros, type Registro } from "../proyecto/procedencia.js";
import { ganarLicencias, registrarEnProyecto, registrarLogro } from "../proyecto/expediente.js";
import { ramaInvalida, stackDetectado } from "../proyecto/reglas.js";
import { conTarea, listarTareas } from "../proyecto/tareas.js";
import { transicionar } from "../nucleo/flujo.js";

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 << 20 });
}
const staged = (root: string) => git(root, ["diff", "--cached", "--name-only", "--diff-filter=ACMR"]).split("\n").filter(Boolean);
const enIndice = (root: string, rel: string) => {
  try {
    return git(root, ["show", `:${rel}`]);
  } catch {
    return "";
  }
};

export interface Bloqueo {
  archivo: string;
  linea?: number;
  motivo: string;
}

/** Líneas (1-based) del texto que según el registro necesitan evidencia y no la tienen. */
function sinEvidencia(reg: Registro | null, texto: string): { linea: number; origen: string; tarea?: string }[] {
  if (!reg) return [];
  const meta = new Map<string, { o: string; n: number; t?: string }[]>();
  for (const l of reg.lineas) meta.set(l.h, [...(meta.get(l.h) ?? []), l]);
  const out: { linea: number; origen: string; tarea?: string }[] = [];
  dividir(texto).forEach((l, i) => {
    const m = meta.get(huellaLinea(l))?.shift();
    if (!m) {
      if (l.trim()) out.push({ linea: i + 1, origen: "desconocido" });
      return;
    }
    if (NECESITAN_EVIDENCIA.has(m.o as never) && m.n < 2) out.push({ linea: i + 1, origen: m.o, ...(m.t ? { tarea: m.t } : {}) });
  });
  return out;
}

export async function preCommit(root: string): Promise<Bloqueo[]> {
  const z = makeZoner(root);
  const out: Bloqueo[] = [];
  const archivos = staged(root).filter((f) => !f.startsWith(".cai/") && langFor(f) && z.zoneOf(path.join(root, f)) !== "protegida");
  const tareasEnCommit = new Set<string>();
  for (const rel of archivos) {
    const abs = path.join(root, rel);
    // Lo que cambió a mano desde la última vez es tuyo.
    if (fs.existsSync(abs)) asentar(root, rel, fs.readFileSync(abs, "utf8"), { origen: "humano" });
    const reg = cargarRegistro(root, rel);
    const texto = enIndice(root, rel);
    for (const s of sinEvidencia(reg, texto)) {
      if (s.tarea) tareasEnCommit.add(s.tarea);
      out.push({ archivo: rel, linea: s.linea, motivo: `${s.origen} sin revisar${s.tarea ? ` (tarea ${s.tarea}: \`cai revisar --tarea ${s.tarea}\`)` : " (`cai revisar --archivo " + rel + "`)"}` });
    }
    if (z.isRoja(abs) && reg?.lineas.some((l) => l.o === "ia")) out.push({ archivo: rel, motivo: "hay código de la IA en una línea roja (VI.1): reescríbelo tú" });
    for (const l of reg?.lineas ?? []) if (l.t) tareasEnCommit.add(l.t);
  }
  for (const t of listarTareas(root).filter((x) => tareasEnCommit.has(x.id)))
    if (!["probada", "cerrada"].includes(t.estado) && t.ejecutor !== "humano") out.push({ archivo: `.cai/tareas/${t.id}`, motivo: `la tarea ${t.id} está ${t.estado}: termina la revisión y las pruebas (\`cai avanzar ${t.id}\`)` });
  // Dependencias nuevas → decisión vigente que las nombre.
  if (staged(root).includes("package.json")) {
    let antes: Set<string> = new Set();
    try {
      const j = JSON.parse(git(root, ["show", "HEAD:package.json"])) as Record<string, Record<string, string>>;
      antes = new Set(Object.keys({ ...j.dependencies, ...j.devDependencies }));
    } catch {
      /* primer commit */
    }
    const nuevas = stackDetectado(root).filter((d) => d.fuente === "package.json" && !antes.has(d.nombre)).map((d) => d.nombre);
    const vigentes = cargarDecisiones(root).filter((d) => d.estado === "vigente").map((d) => `${d.pregunta} ${d.eleccion}`.toLowerCase());
    for (const n of nuevas) if (!vigentes.some((v) => v.includes(n.toLowerCase()))) out.push({ archivo: "package.json", motivo: `dependencia nueva ${n} sin decisión registrada (\`cai decidir --nueva "¿Usamos ${n}?"\`)` });
  }
  if (!out.length) {
    try {
      git(root, ["add", "--", ...[".cai/procedencia", ".cai/evidencias", ".cai/tareas", ".cai/pedidos", ".cai/decisiones.json"].filter((p) => fs.existsSync(path.join(root, p)))]);
    } catch {
      /* nada que agregar */
    }
  }
  return out;
}

export function commitMsg(root: string, archivoMsg: string): void {
  const msg = fs.readFileSync(archivoMsg, "utf8");
  if (/^Cai-IA:/m.test(msg)) return;
  const archivos = staged(root).filter((f) => !f.startsWith(".cai/") && langFor(f));
  const regs = archivos.map((f) => cargarRegistro(root, f)).filter((r): r is Registro => !!r);
  const c = contar(regs);
  const ia = (c.porOrigen.ia?.lineas ?? 0) + (c.porOrigen["ia-probable"]?.lineas ?? 0);
  const iaRev = (c.porOrigen.ia?.revisadas ?? 0) + (c.porOrigen["ia-probable"]?.revisadas ?? 0);
  const tareas = [...new Set(regs.flatMap((r) => r.lineas.map((l) => l.t)).filter((x): x is string => !!x))].filter((id) => listarTareas(root).some((t) => t.id === id && t.estado === "probada"));
  const trailers = [...(tareas.length ? [`Cai-Tarea: ${tareas.join(", ")}`] : []), `Cai-IA: ${ia} líneas (${iaRev} revisadas)`, `Cai-Humano: ${c.porOrigen.humano?.lineas ?? 0} líneas`];
  fs.writeFileSync(archivoMsg, `${msg.trimEnd()}\n\n${trailers.join("\n")}\n`);
}

export async function postCommit(root: string): Promise<string[]> {
  const out: string[] = [];
  const msg = git(root, ["log", "-1", "--format=%B"]);
  const sha = git(root, ["rev-parse", "HEAD"]).trim();
  const ids = /^Cai-Tarea:\s*(.+)$/m.exec(msg)?.[1]?.split(/[,\s]+/).filter(Boolean) ?? [];
  for (const id of ids) {
    try {
      let cerro = false;
      const t = conTarea(root, id, (x) => {
        if (x.estado !== "probada") return x;
        cerro = true;
        return transicionar(x, "cerrada", `commit ${sha.slice(0, 8)}`);
      });
      if (cerro) {
        out.push(`${id} cerrada (commit ${sha.slice(0, 8)})`);
        if (t.replanteo && t.ejecutor === "humano") registrarLogro({ proyecto: root, que: t.titulo, porque: "la resolviste a mano después de desconectar la IA" });
      }
    } catch {
      /* tarea de otra rama */
    }
  }
  fs.mkdirSync(path.join(dataDir(root), "cache"), { recursive: true });
  fs.writeFileSync(path.join(dataDir(root), "cache", "ultimo-verde"), sha);
  // Licencias: funciones del commit escritas completas a mano (y que pasaron el pre-commit, es decir, en verde).
  const archivos = git(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]).split("\n").filter((f) => f && langFor(f) && !f.startsWith(".cai/"));
  let tuyas = 0;
  let deIa = 0;
  const ganadas: string[] = [];
  for (const rel of archivos) {
    const abs = path.join(root, rel);
    const reg = cargarRegistro(root, rel);
    const lang = langFor(rel)!;
    if (!reg || !fs.existsSync(abs)) continue;
    const src = fs.readFileSync(abs, "utf8");
    for (const l of reg.lineas) l.o === "humano" ? tuyas++ : l.o === "ia" && deIa++;
    const m = medir(src, await parse(src, lang));
    const ls = src.split(/\r?\n/);
    for (const f of m.funciones) {
      const meta = reg.lineas.slice(f.linea - 1, f.linea - 1 + f.lineas);
      if (meta.length && meta.every((l) => l.o === "humano")) ganadas.push(...ganarLicencias(await construccionesDe(ls.slice(f.linea - 1, f.linea - 1 + f.lineas).join("\n"), lang), "codigo", root, `${rel}#${f.nombre}`));
    }
  }
  if (ganadas.length) out.push(`licencias nuevas (lo escribiste a mano y quedó en verde): ${[...new Set(ganadas)].join(", ")}`);
  registrarEnProyecto(root, (p) => ({ ...p, lineasTuyas: p.lineasTuyas + tuyas, lineasIa: p.lineasIa + deIa, stack: [...new Set([...p.stack, ...archivos.map((f) => langFor(f)?.id ?? "").filter(Boolean)])] }));
  return out;
}

export function prePush(root: string): Bloqueo[] {
  let rama = "";
  try {
    rama = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  } catch {
    return [];
  }
  const malo = ramaInvalida(root, rama);
  return malo ? [{ archivo: rama, motivo: malo }] : [];
}

export function postCheckout(root: string): string | null {
  try {
    return ramaInvalida(root, git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim());
  } catch {
    return null;
  }
}

/** Merge driver de git: `cai merge-procedencia %O %A %B` (el resultado queda en %A). */
export function mergeProcedencia(base: string, actual: string, otra: string): void {
  const leer = (f: string): Registro | null => {
    try {
      return JSON.parse(fs.readFileSync(f, "utf8")) as Registro;
    } catch {
      return null;
    }
  };
  const a = leer(actual);
  const b = leer(otra);
  if (!a || !b) {
    if (!a && b) fs.copyFileSync(otra, actual);
    return;
  }
  fs.writeFileSync(actual, JSON.stringify(unirRegistros(leer(base), a, b), null, 2));
}

/** `cai ci`: recalcula desde lo que está en el repo (no confía en los hooks locales). */
export function ci(root: string): { bloqueos: Bloqueo[]; resumen: string } {
  const z = makeZoner(root);
  const bloqueos: Bloqueo[] = [];
  let archivos: string[] = [];
  try {
    archivos = git(root, ["ls-files"]).split("\n").filter((f) => f && langFor(f) && !f.startsWith(".cai/") && z.zoneOf(path.join(root, f)) !== "protegida");
  } catch {
    return { bloqueos: [{ archivo: ".", motivo: "no es un repo git" }], resumen: "" };
  }
  const conRegistro = new Set(listarRegistros(root).map((r) => r.archivo));
  const nuevos = ultimoCambio(root);
  for (const rel of archivos) {
    const texto = fs.readFileSync(path.join(root, rel), "utf8");
    if (!conRegistro.has(rel)) {
      // Sin procedencia: si se agregó en este cambio (PR), es de origen desconocido.
      if (nuevos.has(rel)) bloqueos.push({ archivo: rel, motivo: "archivo nuevo sin procedencia (¿se saltó el pre-commit?): `cai adoptar` y revisa" });
      continue;
    }
    for (const s of sinEvidencia(cargarRegistro(root, rel), texto)) bloqueos.push({ archivo: rel, linea: s.linea, motivo: `${s.origen} sin revisar` });
    if (z.isRoja(path.join(root, rel)) && cargarRegistro(root, rel)?.lineas.some((l) => l.o === "ia")) bloqueos.push({ archivo: rel, motivo: "código de la IA en línea roja" });
  }
  const c = contar(listarRegistros(root));
  return { bloqueos, resumen: `${c.total} líneas · IA sin revisar: ${c.sinRevisar} · cobertura de comprensión de lo ajeno: ${Math.round(c.cobertura * 100)}%` };
}

function ultimoCambio(root: string): Set<string> {
  try {
    const base = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "HEAD~1";
    return new Set(git(root, ["diff", "--name-only", "--diff-filter=A", `${base}...HEAD`]).split("\n").filter(Boolean));
  } catch {
    return new Set();
  }
}

/** SARIF con lo no revisado (para la pestaña de seguridad/calidad de GitHub). */
export function sarif(bloqueos: Bloqueo[]): string {
  return JSON.stringify({
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [
      {
        tool: { driver: { name: "ComplementAIry", informationUri: "https://github.com/Slendy4514/ComplementAIry", rules: [{ id: "cai/sin-revisar", shortDescription: { text: "Código de IA sin evidencia de revisión humana" } }] } },
        results: bloqueos.map((b) => ({ ruleId: "cai/sin-revisar", level: "error", message: { text: b.motivo }, locations: [{ physicalLocation: { artifactLocation: { uri: b.archivo }, ...(b.linea ? { region: { startLine: b.linea } } : {}) } }] })),
      },
    ],
  });
}

/** Contenido de los git hooks que instala `cai init` (llaman a `cai githook <nombre>`). */
export function scriptsGitHooks(cai: string): Record<string, string> {
  return {
    "pre-commit": `#!/bin/sh\n# cai: comentarios pendientes, procedencia (lo de la IA con tu evidencia) y verificación rápida.\n${cai} guia check --staged || exit 1\n${cai} githook pre-commit || exit 1\nexec ${cai} gate --staged --rapido\n`,
    "commit-msg": `#!/bin/sh\nexec ${cai} githook commit-msg "$1"\n`,
    "post-commit": `#!/bin/sh\n${cai} githook post-commit || true\n`,
    "pre-push": `#!/bin/sh\nexec ${cai} githook pre-push\n`,
    "post-checkout": `#!/bin/sh\n${cai} githook post-checkout || true\n`,
  };
}

export const archivoProcedencia = (rel: string) => `.cai/procedencia/${codificar(rel)}.json`;
