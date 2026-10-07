import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ADAPTERS, detectAdapters } from "./adapters.js";
import { loadConfig, dataDir } from "./config.js";
import { loadPerfil } from "./profile.js";

/** Diagnóstico del entorno: qué está listo, qué falta y cómo arreglarlo. No cambia nada salvo con --instalar. */

export interface Check {
  ok: boolean | "aviso";
  que: string;
  arreglo?: string;
}

const has = (cmd: string) => spawnSync("sh", ["-c", `command -v ${cmd}`], { stdio: "ignore" }).status === 0;

function binLocal(root: string, bin: string): boolean {
  return fs.existsSync(path.join(root, "node_modules", ".bin", bin));
}

/** Texto útil (sin comentarios HTML ni títulos) de un .md escrito por el humano. */
function filled(file: string): boolean {
  if (!fs.existsSync(file)) return false;
  return (
    fs
      .readFileSync(file, "utf8")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/^#.*$/gm, "")
      .trim().length > 0
  );
}

export function doctor(root: string): Check[] {
  const c: Check[] = [];
  const major = Number(process.versions.node.split(".")[0]);
  c.push(major >= 22 ? { ok: true, que: `Node ${process.versions.node}` } : { ok: "aviso", que: `Node ${process.versions.node}: Stryker (mutation testing) necesita Node 22+`, arreglo: "usar la imagen javascript-node:22 en .devcontainer/Dockerfile y reconstruir" });
  c.push(has("git") ? { ok: true, que: "git" } : { ok: false, que: "git no está instalado", arreglo: "RUN apt-get install -y git (en el Dockerfile)" });
  c.push(has("cai") ? { ok: true, que: "comando cai en el PATH" } : { ok: "aviso", que: "cai no está en el PATH", arreglo: "cd packages/complementairy && npm link" });

  const creds = fs.existsSync(path.join(os.homedir(), ".claude", ".credentials.json")) || !!process.env.ANTHROPIC_API_KEY;
  c.push(creds ? { ok: true, que: "sesión de Claude (para guía y revisión)" } : { ok: false, que: "no hay sesión de Claude", arreglo: "iniciá sesión en Claude Code (o definí ANTHROPIC_API_KEY)" });

  const settings = path.join(root, ".claude", "settings.json");
  const hooked = fs.existsSync(settings) && fs.readFileSync(settings, "utf8").includes(" hook");
  c.push(hooked ? { ok: true, que: "hooks de Claude Code instalados" } : { ok: false, que: "faltan los hooks (la IA podría editar tu código)", arreglo: "cai init" });
  let hooksPath = "";
  try {
    hooksPath = execFileSync("git", ["config", "core.hooksPath"], { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    /* sin repo o sin valor */
  }
  c.push(hooksPath === ".githooks" ? { ok: true, que: "pre-commit de cai activo" } : { ok: "aviso", que: "pre-commit de cai no activo", arreglo: "git config core.hooksPath .githooks" });

  c.push(filled(path.join(dataDir(root), "proyecto.md")) ? { ok: true, que: ".cai/proyecto.md completo" } : { ok: "aviso", que: ".cai/proyecto.md vacío: la IA no sabe qué busca el proyecto", arreglo: "escribí con tus palabras qué busca el proyecto" });
  c.push(filled(path.join(dataDir(root), "reglas.md")) ? { ok: true, que: ".cai/reglas.md completo" } : { ok: "aviso", que: ".cai/reglas.md vacío: no hay reglas de estilo para revisar", arreglo: "escribí tus reglas de cómo se escribe código" });
  c.push(Object.keys(loadPerfil().temas).length ? { ok: true, que: "perfil con temas declarados" } : { ok: "aviso", que: "perfil vacío: la guía asume que sos aprendiz en todo", arreglo: "cai perfil set <lenguaje> aprendiz|intermedio|experto" });

  const cfg = loadConfig(root);
  c.push(cfg.ia.context7 ? { ok: true, que: "Context7 activo (documentación actualizada)" } : { ok: "aviso", que: "Context7 inactivo: la IA cita documentación de memoria", arreglo: 'en .cai/config.json: "ia": { "context7": true } (opcional: CONTEXT7_API_KEY)' });

  const adapters = detectAdapters(root);
  if (!adapters.length) c.push({ ok: "aviso", que: `no se detectó stack (${ADAPTERS.map((a) => a.id).join(", ")})`, arreglo: "creá package.json / pyproject.toml" });
  for (const a of adapters) {
    if (a.id === "typescript" && binLocal(root, "stryker")) {
      const cfgs = ["stryker.config.json", "stryker.config.mjs", "stryker.config.js", "stryker.conf.json", "stryker.conf.js"].filter((f) => fs.existsSync(path.join(root, f)));
      const txt = cfgs.length ? fs.readFileSync(path.join(root, cfgs[0]!), "utf8") : "";
      c.push(
        cfgs.length && txt.includes("@stryker-mutator/vitest-runner")
          ? { ok: true, que: "mutation testing configurado" }
          : { ok: "aviso", que: "mutation testing sin configurar (Stryker no encuentra el runner con pnpm)", arreglo: 'stryker.config.json: { "testRunner": "vitest", "plugins": ["@stryker-mutator/vitest-runner"], "reporters": ["json", "clear-text"], "coverageAnalysis": "perTest" }' },
      );
    }
    if (a.id === "typescript") {
      for (const bin of ["tsc", "eslint", "vitest", "tsx", "stryker"]) {
        c.push(binLocal(root, bin) ? { ok: true, que: `${a.id}: ${bin}` } : { ok: false, que: `${a.id}: falta ${bin}`, arreglo: a.install });
      }
    } else {
      for (const bin of ["mypy", "ruff", "pytest", "mutmut"]) c.push(has(bin) ? { ok: true, que: `${a.id}: ${bin}` } : { ok: false, que: `${a.id}: falta ${bin}`, arreglo: a.install });
      for (const p of a.sistema ?? []) if (!has(p.replace(/-.*/, ""))) c.push({ ok: false, que: `${a.id}: falta ${p} (sistema)`, arreglo: `RUN apt-get update && apt-get install -y ${a.sistema!.join(" ")}  (en .devcontainer/Dockerfile, luego Rebuild Container)` });
    }
    if (a.lsp) c.push({ ok: "aviso", que: `${a.id}: plugin LSP recomendado para Claude Code`, arreglo: `/plugin → ${a.lsp}` });
  }
  return c;
}

/** Instala las herramientas de los stacks detectados (lo pide el humano explícitamente). */
export function instalar(root: string): void {
  for (const a of detectAdapters(root)) {
    const cmd = a.install.split("#")[0]!.trim();
    console.log(`$ ${cmd}`);
    spawnSync("sh", ["-c", cmd], { cwd: root, stdio: "inherit" });
    if (a.sistema?.length) console.log(`Paquetes de sistema: agregá a .devcontainer/Dockerfile:\n  RUN apt-get update && apt-get install -y ${a.sistema.join(" ")}\ny hacé "Rebuild Container".`);
  }
}
