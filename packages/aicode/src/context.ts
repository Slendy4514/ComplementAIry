import fs from "node:fs";
import path from "node:path";
import picomatch from "picomatch";
import { home } from "./profile.js";

/**
 * Lo que el humano le dice al sistema con palabras, y la memoria de sus errores frecuentes.
 * Todo vive en archivos legibles: .aicode/proyecto.md, .aicode/reglas.md, .aicode/reglas/*.md
 * (estos últimos con `paths:` en el frontmatter para aplicar solo a ciertas carpetas)
 * y ~/.aicode/patrones.json (errores frecuentes).
 */

function read(file: string): string {
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

function stripFrontmatter(md: string): { paths: string[]; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(md);
  if (!m) return { paths: [], body: md };
  const paths = [...m[1]!.matchAll(/^\s*-\s*["']?([^"'\n]+)["']?\s*$/gm)].map((x) => x[1]!.trim());
  const inline = /^paths:\s*\[(.*)\]\s*$/m.exec(m[1]!);
  if (inline) paths.push(...inline[1]!.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean));
  return { paths, body: md.slice(m[0].length).trim() };
}

/** Quita comentarios HTML (las plantillas traen instrucciones para el humano). */
const noHtmlComments = (s: string) => s.replace(/<!--[\s\S]*?-->/g, "").trim();

export interface ProjectContext {
  proyecto: string;
  reglas: string;
  patrones: string;
}

export function projectContext(root: string, rel: string): ProjectContext {
  const dir = path.join(root, ".aicode");
  const proyecto = noHtmlComments(read(path.join(dir, "proyecto.md")));
  const reglas: string[] = [];
  const general = noHtmlComments(read(path.join(dir, "reglas.md")));
  if (general) reglas.push(general);
  const scoped = path.join(dir, "reglas");
  if (fs.existsSync(scoped)) {
    for (const f of fs.readdirSync(scoped).filter((x) => x.endsWith(".md")).sort()) {
      const { paths, body } = stripFrontmatter(read(path.join(scoped, f)));
      if (!paths.length || picomatch(paths, { dot: true })(rel)) {
        const b = noHtmlComments(body);
        if (b) reglas.push(`(${f})\n${b}`);
      }
    }
  }
  return { proyecto, reglas: reglas.join("\n\n"), patrones: patronesTexto() };
}

export function contextBlock(c: ProjectContext): string {
  const parts: string[] = [];
  if (c.proyecto) parts.push(`Qué busca el proyecto (escrito por el programador):\n${c.proyecto}`);
  if (c.reglas) parts.push(`Reglas de estilo y conducta del proyecto (escritas por el programador):\n${c.reglas}`);
  if (c.patrones) parts.push(`Errores frecuentes de este programador (memoria del sistema; insistí en esto cuando aplique):\n${c.patrones}`);
  return parts.join("\n\n");
}

// --- Memoria de errores frecuentes -------------------------------------------------

interface Patron {
  veces: number;
  ultimo: string;
  ejemplo: string;
}

const patronesFile = () => path.join(home(), "patrones.json");

export function loadPatrones(): Record<string, Patron> {
  try {
    return JSON.parse(fs.readFileSync(patronesFile(), "utf8")) as Record<string, Patron>;
  } catch {
    return {};
  }
}

export function registrarPatron(clave: string, ejemplo: string): void {
  const p = loadPatrones();
  const cur = p[clave] ?? { veces: 0, ultimo: "", ejemplo: "" };
  cur.veces++;
  cur.ultimo = new Date().toISOString();
  cur.ejemplo = ejemplo.slice(0, 160);
  p[clave] = cur;
  fs.mkdirSync(home(), { recursive: true });
  fs.writeFileSync(patronesFile(), JSON.stringify(p, null, 2) + "\n");
}

function patronesTexto(): string {
  return Object.entries(loadPatrones())
    .filter(([, v]) => v.veces >= 2)
    .sort((a, b) => b[1].veces - a[1].veces)
    .slice(0, 8)
    .map(([k, v]) => `- ${k} (${v.veces} veces; ej.: ${v.ejemplo})`)
    .join("\n");
}
