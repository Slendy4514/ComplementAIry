/**
 * REGLAS EN CAPAS (manifiesto III.2 y III.3), con UNA precedencia explícita:
 *
 *   protegida > línea roja > regla por carpeta > regla del proyecto > regla global > valor por defecto
 *
 *   ~/.cai/reglas-globales.md     tus estándares para todos los proyectos (tests, librerías, estilo, bash)
 *   ~/.cai/reglas-globales.json   lo verificable de lo global: librerías preferidas/evitar, bash permitido, ramas
 *   .cai/reglas.md                el proyecto, con secciones obligatorias (Stack y versiones, Datos, API, Ramas, Pruebas)
 *   .cai/reglas/*.md              por carpeta (frontmatter `paths:`; `roja: true` suma esas rutas a las líneas rojas)
 *   .cai/reglas.json              reglas mecánicas (regex por línea), verificadas sin IA
 *
 * Las líneas rojas solo se SUMAN entre capas: una carpeta puede agregar, nunca quitar.
 * `cai reglas compilar` vuelca lo de palabras a .claude/rules/ y AGENTS.md (para Claude Code, OpenCode, Cursor).
 */
import fs from "node:fs";
import path from "node:path";
import picomatch from "picomatch";
import { leerJson } from "./almacen.js";
import { ALWAYS_PROTECTED, dataDir, loadConfig, rojasDeCarpetas } from "./config.js";
import { home } from "./profile.js";

export interface GlobalesJson {
  librerias: { preferidas: string[]; evitar: string[] };
  bash: { permitir: string[] };
  ramas: string;
}

export const SECCIONES_OBLIGATORIAS = ["Stack y versiones", "Datos", "API", "Ramas", "Pruebas"];

const leerTexto = (f: string) => {
  try {
    return fs.readFileSync(f, "utf8");
  } catch {
    return "";
  }
};
const sinComentarios = (s: string) => s.replace(/<!--[\s\S]*?-->/g, "").trim();

export const archivoGlobalMd = () => path.join(home(), "reglas-globales.md");
export const archivoGlobalJson = () => path.join(home(), "reglas-globales.json");

export function globales(): { texto: string; json: GlobalesJson; existe: boolean } {
  const texto = sinComentarios(leerTexto(archivoGlobalMd()));
  const j = leerJson<Partial<GlobalesJson>>(archivoGlobalJson(), () => ({}));
  return {
    texto,
    json: { librerias: { preferidas: j.librerias?.preferidas ?? [], evitar: j.librerias?.evitar ?? [] }, bash: { permitir: j.bash?.permitir ?? [] }, ramas: j.ramas ?? "" },
    existe: !!texto || fs.existsSync(archivoGlobalJson()),
  };
}

export const PLANTILLA_GLOBAL = `# Mis reglas globales (valen en todos mis proyectos)

## Filosofía de pruebas
<!-- p. ej.: tests de la intención (no del código), un caso borde por función, nada de mocks salvo red/disco -->

## Librerías y paquetes preferidos
<!-- p. ej.: zod para validar, vitest para tests; evito lodash. Lo verificable va en reglas-globales.json -->

## Estilo
<!-- p. ej.: errores con mensajes que expliquen qué llegó; funciones de menos de 40 líneas -->

## Comandos bash comunes
<!-- p. ej.: pnpm test, pnpm build -->
`;

/** Secciones `## …` de un markdown (sin comentarios), por título normalizado. */
export function secciones(md: string): Map<string, string> {
  const out = new Map<string, string>();
  const partes = sinComentarios(md).split(/^##\s+/m).slice(1);
  for (const p of partes) {
    const [titulo, ...resto] = p.split("\n");
    out.set(norm(titulo ?? ""), resto.join("\n").trim());
  }
  return out;
}
const norm = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/** Secciones obligatorias del proyecto que faltan o están vacías. */
export function seccionesFaltantes(root: string): string[] {
  const s = secciones(leerTexto(path.join(dataDir(root), "reglas.md")));
  return SECCIONES_OBLIGATORIAS.filter((t) => !s.get(norm(t))?.trim());
}

// --- Stack y versiones exactas (contrastadas con los manifiestos) -----------------------------------------

export interface Dependencia {
  nombre: string;
  version: string;
  fuente: string;
}

/** Dependencias directas y versiones según los manifiestos (package.json, pyproject, requirements). */
export function stackDetectado(root: string): Dependencia[] {
  const out: Dependencia[] = [];
  const pj = leerJson<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string>; engines?: Record<string, string> } | null>(path.join(root, "package.json"), () => null);
  if (pj) {
    for (const [n, v] of Object.entries({ ...pj.dependencies, ...pj.devDependencies })) out.push({ nombre: n, version: v, fuente: "package.json" });
    for (const [n, v] of Object.entries(pj.engines ?? {})) out.push({ nombre: n, version: v, fuente: "package.json engines" });
  }
  const req = leerTexto(path.join(root, "requirements.txt"));
  for (const m of req.matchAll(/^([A-Za-z0-9_.-]+)\s*([=<>~!]=?[^\s#;]+)/gm)) out.push({ nombre: m[1]!.toLowerCase(), version: m[2]!, fuente: "requirements.txt" });
  const py = leerTexto(path.join(root, "pyproject.toml"));
  for (const m of py.matchAll(/^\s*["']([A-Za-z0-9_.-]+)\s*([=<>~!]=?[^"']+)["']/gm)) out.push({ nombre: m[1]!.toLowerCase(), version: m[2]!.trim(), fuente: "pyproject.toml" });
  return out;
}

/**
 * Versiones declaradas en "## Stack y versiones" (líneas `nombre@versión` o `nombre versión`) que no
 * coinciden con los manifiestos. Deriva = el plan no se aprueba hasta corregir una de las dos.
 */
export function derivaDeStack(root: string): string[] {
  const sec = secciones(leerTexto(path.join(dataDir(root), "reglas.md"))).get(norm("Stack y versiones")) ?? "";
  const real = new Map(stackDetectado(root).map((d) => [d.nombre.toLowerCase(), d]));
  const out: string[] = [];
  for (const m of sec.matchAll(/^[-*\s]*`?([@\w./-]+)`?\s*(?:@|\s)\s*`?v?([\^~<>=]*\d[\w.-]*)`?/gm)) {
    const d = real.get(m[1]!.toLowerCase());
    const limpio = (v: string) => v.replace(/^[\^~<>=v]+/, "");
    if (d && limpio(d.version) !== limpio(m[2]!) && !limpio(d.version).startsWith(limpio(m[2]!))) out.push(`${m[1]}: reglas dicen ${m[2]}, ${d.fuente} dice ${d.version}`);
  }
  return out;
}

/** ¿Una dependencia nueva está fuera de tus librerías preferidas (o en "evitar")? Abre una decisión. */
export function dependenciaFuera(nombre: string): string | null {
  const g = globales().json.librerias;
  if (g.evitar.includes(nombre)) return `${nombre} está en tu lista de librerías a evitar`;
  if (g.preferidas.length && !g.preferidas.includes(nombre)) return `${nombre} no está en tus librerías preferidas (${g.preferidas.join(", ")})`;
  return null;
}

/** Nombre de rama válido según la regla del proyecto (o la global). null = ok. */
export function ramaInvalida(root: string, rama: string): string | null {
  const re = loadConfig(root).flujo.ramas || globales().json.ramas;
  if (!re || ["main", "master", "HEAD"].includes(rama)) return null;
  try {
    return new RegExp(re).test(rama) ? null : `la rama «${rama}» no cumple la convención ${re}`;
  } catch {
    return `la regex de ramas (${re}) es inválida`;
  }
}

// --- Reglas por carpeta y líneas rojas ----------------------------------------------------------------------

export interface ReglaCarpeta {
  archivo: string;
  paths: string[];
  roja: boolean;
  cuerpo: string;
}

export function reglasPorCarpeta(root: string): ReglaCarpeta[] {
  const d = path.join(dataDir(root), "reglas");
  if (!fs.existsSync(d)) return [];
  return fs
    .readdirSync(d)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => {
      const md = leerTexto(path.join(d, f));
      const fm = /^---\n([\s\S]*?)\n---\n?/.exec(md);
      const paths = fm ? [...fm[1]!.matchAll(/^\s*-\s*["']?([^"'\n]+)["']?\s*$/gm)].map((x) => x[1]!.trim()) : [];
      const inline = fm ? /^paths:\s*\[(.*)\]\s*$/m.exec(fm[1]!) : null;
      if (inline) paths.push(...inline[1]!.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean));
      return { archivo: f, paths, roja: !!fm && /^roja:\s*true\s*$/m.test(fm[1]!), cuerpo: sinComentarios(fm ? md.slice(fm[0].length) : md) };
    });
}

/** Líneas rojas efectivas: las de config más las de las reglas por carpeta con `roja: true` (solo suman). */
export function rojasEfectivas(root: string): string[] {
  return [...new Set([...loadConfig(root).zonas.rojas, ...rojasDeCarpetas(root)])];
}

export interface Efectiva {
  regla: string;
  origen: string;
}

/** Las reglas que valen para un archivo y de qué capa viene cada una (`cai reglas <archivo>`). */
export function reglaEfectiva(root: string, rel: string): Efectiva[] {
  const out: Efectiva[] = [];
  const m = (g: string[]) => g.length > 0 && picomatch(g, { dot: true })(rel);
  if (m(ALWAYS_PROTECTED)) out.push({ regla: "protegido: solo lo cambia el humano (ni comentarios de la IA)", origen: "protegida" });
  if (m(rojasEfectivas(root))) out.push({ regla: "línea roja: la IA nunca escribe código aquí (VI.1)", origen: "roja" });
  for (const r of reglasPorCarpeta(root)) if (!r.paths.length || m(r.paths)) out.push({ regla: r.cuerpo.split("\n").find(Boolean) ?? "(vacía)", origen: `carpeta: .cai/reglas/${r.archivo}` });
  const proy = sinComentarios(leerTexto(path.join(dataDir(root), "reglas.md")));
  if (proy) out.push({ regla: proy.split("\n").filter((l) => l.trim() && !l.startsWith("#")).slice(0, 3).join(" / "), origen: "proyecto: .cai/reglas.md" });
  const c = loadConfig(root);
  if (m(c.zonas.delegadas)) out.push({ regla: "zona delegada: la IA puede escribir aquí (evidencia proporcional)", origen: "proyecto: config.zonas.delegadas" });
  const g = globales();
  if (g.texto) out.push({ regla: g.texto.split("\n").filter((l) => l.trim() && !l.startsWith("#")).slice(0, 3).join(" / "), origen: "global: ~/.cai/reglas-globales.md" });
  out.push({ regla: `presupuesto ${c.flujo.presupuestoLineas} líneas por paso; prácticas: funciones ≤ ${c.practicas.maxLineasFuncion ?? "∞"} líneas`, origen: "por defecto" });
  return out;
}

/** Texto de las reglas globales para los prompts (se antepone al contexto del proyecto). */
export function bloqueGlobal(): string {
  const g = globales();
  if (!g.texto && !g.json.librerias.preferidas.length) return "";
  const libs = g.json.librerias.preferidas.length ? `\nLibrerías preferidas: ${g.json.librerias.preferidas.join(", ")}${g.json.librerias.evitar.length ? `; evitar: ${g.json.librerias.evitar.join(", ")}` : ""}` : "";
  return `Reglas globales del programador (todas sus obras):\n${g.texto}${libs}`.trim();
}

// --- Compilar a Claude Code / OpenCode / Cursor ------------------------------------------------------------

const MARCA_INI = "<!-- cai:reglas:inicio -->";
const MARCA_FIN = "<!-- cai:reglas:fin -->";

/** Escribe .claude/rules/cai-*.md (por carpeta) y un bloque en AGENTS.md. Devuelve los archivos tocados. */
export function compilarReglas(root: string): string[] {
  const tocados: string[] = [];
  const dirRules = path.join(root, ".claude", "rules");
  for (const r of reglasPorCarpeta(root)) {
    if (!r.cuerpo) continue;
    fs.mkdirSync(dirRules, { recursive: true });
    const f = path.join(dirRules, `cai-${r.archivo}`);
    const fm = r.paths.length ? `---\npaths:\n${r.paths.map((p) => `  - "${p}"`).join("\n")}\n---\n` : "";
    fs.writeFileSync(f, `${fm}<!-- Generado por \`cai reglas compilar\` desde .cai/reglas/${r.archivo}: edita allá. -->\n${r.roja ? "LÍNEA ROJA: aquí no escribes código; solo explicas y guías.\n\n" : ""}${r.cuerpo}\n`);
    tocados.push(path.relative(root, f));
  }
  const g = bloqueGlobal();
  const proy = sinComentarios(leerTexto(path.join(dataDir(root), "reglas.md")));
  const rojas = rojasEfectivas(root);
  const bloque = [MARCA_INI, "## Reglas del proyecto (ComplementAIry)", proy, g, rojas.length ? `Líneas rojas (no escribes código aquí): ${rojas.join(", ")}` : "", MARCA_FIN].filter(Boolean).join("\n\n");
  const agents = path.join(root, "AGENTS.md");
  const prev = leerTexto(agents);
  const nuevo = prev.includes(MARCA_INI) ? prev.replace(new RegExp(`${MARCA_INI}[\\s\\S]*?${MARCA_FIN}`), bloque) : `${prev ? `${prev.trimEnd()}\n\n` : ""}${bloque}\n`;
  if (nuevo !== prev) {
    fs.writeFileSync(agents, nuevo);
    tocados.push("AGENTS.md");
  }
  return tocados;
}
