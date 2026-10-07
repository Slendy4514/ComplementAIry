import fs from "node:fs";
import path from "node:path";
import type { Zoner } from "./config.js";
import { langFor } from "./lang.js";
import { loadPerfil, nivelDe, puntaje } from "./profile.js";

/**
 * Lo repetitivo se resuelve con snippets PROPIOS del programador: plantillas de VSCode
 * que se expanden sin IA (determinista). La IA puede guiar a crearlos; redactarlos ella
 * depende del modo configurado, y el hook lo hace cumplir.
 */

export interface SnippetPolicy {
  allowed: boolean;
  why: string;
  aviso?: string;
}

/** Quita comentarios de línea y de bloque de un JSONC, respetando strings. */
export function stripJsonc(text: string): string {
  let out = "";
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inStr) {
      out += ch;
      if (ch === "\\") out += text[++i] ?? "";
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      out += ch;
    } else if (text.startsWith("//", i)) {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (text.startsWith("/*", i)) {
      const j = text.indexOf("*/", i + 2);
      i = j === -1 ? text.length : j + 1;
    } else out += ch;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

/**
 * Lenguajes de cada snippet. null si el archivo no se puede leer o algún snippet no declara
 * "scope" (un snippet sin scope aplica a TODOS los lenguajes, así que no se puede delegar).
 */
export function snippetScopes(content: string): string[] | null {
  let data: Record<string, { scope?: unknown }>;
  try {
    data = JSON.parse(stripJsonc(content)) as typeof data;
  } catch {
    return null;
  }
  const out = new Set<string>();
  for (const v of Object.values(data)) {
    if (typeof v?.scope !== "string" || !v.scope.trim()) return null;
    for (const s of v.scope.split(",")) if (s.trim()) out.add(s.trim());
  }
  return [...out];
}

export function snippetPolicy(z: Zoner, content: string): SnippetPolicy {
  const { modo, lenguajes } = z.config.snippets;
  const scopes = snippetScopes(content) ?? [];
  if (modo === "humano") return { allowed: false, why: "en este proyecto los snippets los escribe solo el humano (snippets.modo = humano)" };
  if (modo === "libre-con-aviso") return { allowed: true, why: "", aviso: "La IA redactó un snippet. Leelo antes de usarlo: lo vas a repetir muchas veces." };
  if (snippetScopes(content) === null || !scopes.length)
    return { allowed: false, why: 'el archivo debe ser JSON válido y cada snippet debe declarar "scope" (lenguaje) para saber si se puede delegar' };
  if (modo === "por-lenguaje") {
    const fuera = scopes.filter((s) => !lenguajes.includes(s));
    return fuera.length
      ? { allowed: false, why: `snippets.modo = por-lenguaje y estos lenguajes no están delegados: ${fuera.join(", ")}` }
      : { allowed: true, why: "" };
  }
  // "ganado": solo en lenguajes que el programador ya domina.
  const perfil = loadPerfil();
  const noDominados = scopes.filter((s) => nivelDe(puntaje(perfil, s)) !== "experto");
  return noDominados.length
    ? {
        allowed: false,
        why:
          `todavía no dominás ${noDominados.join(", ")} según tu perfil: el snippet lo armás vos con guía ` +
          `(la delegación se gana; ver \`cai perfil\`)`,
      }
    : { allowed: true, why: "" };
}

const HEADER = `// Snippets propios (ComplementAIry). Se expanden en VSCode escribiendo el "prefix" + Tab.
// Marcadores: \${1:nombre} = primer lugar a completar, \${2} = segundo, \$0 = donde queda el cursor al final.
// Docs: https://code.visualstudio.com/docs/editor/userdefinedsnippets
`;

/** Escapa código para usarlo como cuerpo de snippet ($ y } tienen significado especial). */
export function toSnippetBody(code: string): string[] {
  const lines = code.replace(/\s+$/, "").split("\n");
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length));
  return lines.map((l) => l.slice(Number.isFinite(indent) ? indent : 0).replace(/\$/g, "\\$"));
}

export interface NuevoSnippet {
  nombre: string;
  archivo?: string;
  lineas?: [number, number];
  lenguaje?: string;
}

/**
 * Crea la entrada de snippet a partir de código QUE YA ESCRIBISTE (las líneas que repetís).
 * No usa IA: copia tu código, lo escapa y te deja marcar los lugares a completar.
 */
export function crearSnippet(root: string, o: NuevoSnippet): { file: string; body: string[] } {
  let body = ["$0"];
  let scope = o.lenguaje ?? "";
  if (o.archivo) {
    const src = fs.readFileSync(path.resolve(root, o.archivo), "utf8").split("\n");
    const [a, b] = o.lineas ?? [1, src.length];
    body = toSnippetBody(src.slice(a - 1, b).join("\n"));
    scope ||= langFor(o.archivo)?.id ?? "";
  }
  const file = path.join(root, ".vscode", "cai.code-snippets");
  let text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : `${HEADER}{\n}\n`;
  if (!text.includes(HEADER.split("\n")[0]!)) text = HEADER + text;
  const key = JSON.stringify(o.nombre);
  if (text.includes(`${key}:`)) throw new Error(`ya existe un snippet llamado ${o.nombre}`);
  const entry =
    `  ${key}: {\n` +
    `    // TODO(vos): reemplazá los valores que cambian cada vez por \${1:nombre}, \${2:otro}...\n` +
    `    "prefix": ${JSON.stringify(o.nombre)},\n` +
    (scope ? `    "scope": ${JSON.stringify(scope)},\n` : "") +
    `    "description": "",\n` +
    `    "body": [\n${body.map((l) => `      ${JSON.stringify(l)}`).join(",\n")}\n    ]\n  }`;
  const close = text.lastIndexOf("}");
  const before = text.slice(0, close).replace(/\s*$/, "");
  const needsComma = !before.endsWith("{");
  text = `${before}${needsComma ? "," : ""}\n${entry}\n}\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return { file, body };
}
