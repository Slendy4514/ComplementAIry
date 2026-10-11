import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ADAPTERS, detectAdapters } from "../garantias/adapters.js";
import { loadConfig, dataDir, makeZoner } from "../proyecto/config.js";
import { listFiles } from "../proyecto/files.js";
import { archivoGlobalMd, derivaDeStack, globales, seccionesFaltantes } from "../proyecto/reglas.js";
import { motoresDe, permitido } from "../ia/roles.js";
import { disponible } from "../ia/motores.js";
import { CADENA_POR_DEFECTO } from "../ia/decisor.js";
import { loadPerfil } from "../proyecto/profile.js";

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
  c.push(Object.keys(loadPerfil().temas).length ? { ok: true, que: "perfil con temas declarados" } : { ok: "aviso", que: "perfil vacío: la guía asume que eres aprendiz en todo", arreglo: "cai perfil set <lenguaje> aprendiz|intermedio|experto" });

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
  c.push(...doctorV1(root));
  return c;
}

/** MCP recomendados según el stack (III.4): la instalación la hace el humano; el hook pide confirmar escrituras. */
const CATALOGO_MCP: { si: RegExp; mcp: string; para: string; como: string }[] = [
  { si: /"svelte"|"@sveltejs\//, mcp: "Svelte", para: "análisis estático y correcciones con la versión real de Svelte", como: "claude mcp add svelte -- npx -y @sveltejs/mcp" },
  { si: /"@sentry\//, mcp: "Sentry", para: "errores reales de producción como contexto", como: "claude mcp add --transport http sentry https://mcp.sentry.dev/mcp" },
  { si: /"stripe"/, mcp: "Stripe", para: "documentación exacta de tu versión de la API", como: "claude mcp add --transport http stripe https://mcp.stripe.com" },
  { si: /figma/i, mcp: "Figma", para: "especificaciones de interfaz desde el diseño", como: "claude mcp add --transport http figma https://mcp.figma.com/mcp" },
  { si: /./, mcp: "Context7", para: "documentación actualizada de cualquier librería (evita APIs inventadas)", como: "claude mcp add --transport http context7 https://mcp.context7.com/mcp" },
];

/** Chequeos de v1 (el manifiesto). */
export function doctorV1(root: string): Check[] {
  const c: Check[] = [];
  const cfg = loadConfig(root);
  if (cfg.version !== 1) c.push({ ok: "aviso", que: "el proyecto todavía está en v0.11", arreglo: "cai migrar (simula) → cai migrar --aplicar" });
  // III.2: reglas globales.
  const g = globales();
  c.push(g.texto.replace(/^#.*$/gm, "").trim() ? { ok: true, que: "reglas globales (~/.cai/reglas-globales.md)" } : { ok: false, que: "faltan tus reglas globales (III.2: tests, librerías, estilo, bash)", arreglo: `escríbelas en ${archivoGlobalMd()}` });
  // III.3: secciones obligatorias y versiones.
  const faltan = seccionesFaltantes(root);
  c.push(!faltan.length ? { ok: true, que: ".cai/reglas.md con todas las secciones (stack, datos, API, ramas, pruebas)" } : { ok: false, que: `.cai/reglas.md: faltan ${faltan.join(", ")} (III.3)`, arreglo: "complétalas con tus palabras" });
  const deriva = derivaDeStack(root);
  if (deriva.length) c.push({ ok: false, que: `versiones distintas entre reglas y manifiestos: ${deriva.join("; ")}`, arreglo: "corrige una de las dos (el plan no se aprueba con deriva)" });
  if (!cfg.flujo.ramas && !g.json.ramas) c.push({ ok: "aviso", que: "sin convención de nombres de rama verificable", arreglo: '.cai/config.json → "flujo": { "ramas": "^(feature|fix|refactor)/[a-z0-9-]+$" }' });
  // Git: hooks v1 y merge driver.
  for (const h of ["commit-msg", "post-commit", "pre-push"]) if (!fs.existsSync(path.join(root, ".githooks", h))) c.push({ ok: false, que: `falta .githooks/${h} (procedencia, trailers, ramas)`, arreglo: "cai init" });
  let driver = "";
  try {
    driver = execFileSync("git", ["config", "merge.cai-procedencia.driver"], { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    /* sin valor */
  }
  c.push(driver ? { ok: true, que: "merge driver de la procedencia" } : { ok: "aviso", que: "sin merge driver de la procedencia (conflictos en .cai/procedencia)", arreglo: "cai init" });
  // III.1: índice fresco.
  const idx = path.join(dataDir(root), "indice.json");
  const viejo = !fs.existsSync(idx) || Date.now() - fs.statSync(idx).mtimeMs > 7 * 86400_000;
  c.push(!viejo ? { ok: true, que: "índice del código al día" } : { ok: "aviso", que: "índice del código ausente o viejo (III.1)", arreglo: "cai indice" });
  // III.4: MCP según el stack.
  const pj = fs.existsSync(path.join(root, "package.json")) ? fs.readFileSync(path.join(root, "package.json"), "utf8") : "";
  const mcpJson = [path.join(root, ".mcp.json"), path.join(os.homedir(), ".claude.json")].map((f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "")).join("\n");
  for (const m of CATALOGO_MCP) if (m.si.test(pj || " ") && !new RegExp(m.mcp, "i").test(mcpJson)) c.push({ ok: "aviso", que: `MCP ${m.mcp}: ${m.para}`, arreglo: m.como });
  // II.3: sugerencias automáticas que interrumpen el flujo.
  const vs = path.join(root, ".vscode", "settings.json");
  const vsTxt = fs.existsSync(vs) ? fs.readFileSync(vs, "utf8") : "";
  if (!/"editor\.inlineSuggest\.enabled"\s*:\s*false/.test(vsTxt)) c.push({ ok: "aviso", que: "VSCode: autocompletado en línea activo (Copilot y otros): interrumpe tu razonamiento y lo que inserta queda como ia-probable (II.3)", arreglo: '.vscode/settings.json → "editor.inlineSuggest.enabled": false' });
  // Decisor (System One) y privacidad.
  const motores = motoresDe(cfg);
  const cadena = (cfg.ia.decisor.cadena.length ? cfg.ia.decisor.cadena : CADENA_POR_DEFECTO).filter((r) => {
    const d = motores[r.split(":")[0]!];
    return d && disponible(d) && !permitido(cfg, r.split(":")[0]!, d);
  });
  c.push({ ok: cadena.length ? true : "aviso", que: `decisor de lo subjetivo: ${cadena.join(" → ") || "solo heurísticas"}`, ...(cadena.length ? {} : { arreglo: "TYPESAFE_API_KEY (Jev), un modelo en Ollama /v1/systemone, o tu sesión de Claude Code" }) });
  // VI.1: carpetas de seguridad que no son línea roja.
  const sensibles = listFiles(makeZoner(root)).filter((f) => /(^|\/)(auth|security|seguridad|crypto|cifrado|login|session|payments?|pagos?)(\/|\.)/i.test(f)).map((f) => f.split("/").slice(0, -1).join("/") || f);
  const z = makeZoner(root);
  const sinRoja = [...new Set(sensibles)].filter((d) => !z.isRoja(path.join(root, d, "x.ts")));
  if (sinRoja.length) c.push({ ok: "aviso", que: `parecen de seguridad y no son línea roja: ${sinRoja.slice(0, 5).join(", ")} (VI.1)`, arreglo: '.cai/config.json → "zonas": { "rojas": ["src/auth/**"] }' });
  return c;
}

/** Instala las herramientas de los stacks detectados (lo pide el humano explícitamente). */
export function instalar(root: string): void {
  for (const a of detectAdapters(root)) {
    const cmd = a.install.split("#")[0]!.trim();
    console.log(`$ ${cmd}`);
    spawnSync("sh", ["-c", cmd], { cwd: root, stdio: "inherit" });
    if (a.sistema?.length) console.log(`Paquetes de sistema: agrega a .devcontainer/Dockerfile:\n  RUN apt-get update && apt-get install -y ${a.sistema.join(" ")}\ny haz "Rebuild Container".`);
  }
}
