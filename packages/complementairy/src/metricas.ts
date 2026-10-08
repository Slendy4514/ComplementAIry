import fs from "node:fs";
import path from "node:path";
import type { Config } from "./config.js";
import { listFiles } from "./files.js";
import type { Zoner } from "./config.js";
import type { Parsed } from "./comments.js";
import { nombrados, type SyntaxNode } from "./parser.js";

/**
 * Mediciones de diseño, deterministas (tree-sitter). Deciden CUÁNDO vale la pena pedirle a la IA
 * una sugerencia de diseño; la IA nunca decide sola si "algo está mal".
 */

export interface Funcion {
  nombre: string;
  linea: number;
  lineas: number;
  parametros: number;
  anidamiento: number;
  exportada: boolean;
}

export interface Metricas {
  lineas: number;
  funciones: Funcion[];
}

const FUNC = /^(function_declaration|function_definition|method_definition|method_declaration|function_item|generator_function_declaration|arrow_function|function_expression|function)$/;
const CONTROL = /^(if_statement|for_statement|for_in_statement|for_of_statement|while_statement|do_statement|switch_statement|try_statement|with_statement|match_statement|if_expression|for_expression|while_expression|match_expression|conditional_expression)$/;

function nombreDe(n: SyntaxNode): string | null {
  const directo = n.childForFieldName("name");
  if (directo) return directo.text;
  // const f = () => {} / f = function () {} / { f: () => {} }
  const p = n.parent;
  if (!p) return null;
  if (p.type === "variable_declarator" || p.type === "pair" || p.type === "assignment_expression" || p.type === "public_field_definition") {
    const k = p.childForFieldName("name") ?? p.childForFieldName("key") ?? p.childForFieldName("left");
    return k?.text ?? null;
  }
  return null;
}

function anidamiento(n: SyntaxNode, depth = 0): number {
  let max = depth;
  for (const c of nombrados(n)) {
    if (FUNC.test(c.type)) continue; // las funciones internas se miden aparte
    const d = CONTROL.test(c.type) && !(c.type === "if_statement" && c.parent?.type === "else_clause") ? depth + 1 : depth;
    max = Math.max(max, anidamiento(c, d));
  }
  return max;
}

function exportada(n: SyntaxNode): boolean {
  for (let p: SyntaxNode | null = n.parent; p; p = p.parent) {
    if (p.type === "export_statement") return true;
    if (p.type === "program" || p.type === "module") break;
  }
  return false;
}

export function medir(src: string, parsed: Parsed): Metricas {
  const out: Metricas = { lineas: src.split("\n").length, funciones: [] };
  if (!parsed.root) return out;
  const walk = (n: SyntaxNode) => {
    if (FUNC.test(n.type)) {
      const nombre = nombreDe(n);
      if (nombre) {
        const params = n.childForFieldName("parameters") ?? nombrados(n).find((c) => /parameters/.test(c.type)) ?? null;
        out.funciones.push({
          nombre,
          linea: n.startPosition.row + 1,
          lineas: n.endPosition.row - n.startPosition.row + 1,
          parametros: params ? nombrados(params).filter((c) => !/comment/.test(c.type)).length : 0,
          anidamiento: anidamiento(n),
          exportada: exportada(n) || (parsed.root!.type === "module" && !nombre.startsWith("_") && n.parent?.type === "module"),
        });
      }
    }
    for (const c of nombrados(n)) walk(c);
  };
  walk(parsed.root);
  return out;
}

export interface Violacion {
  /** Estable, para no repetir el mismo aviso. */
  clave: string;
  nivel: "archivo" | "funcion";
  linea: number;
  detalle: string;
}

export function violaciones(m: Metricas, p: Config["practicas"]): Violacion[] {
  const v: Violacion[] = [];
  if (p.maxFuncionesArchivo !== null && m.funciones.length > p.maxFuncionesArchivo)
    v.push({ clave: "archivo:funciones", nivel: "archivo", linea: 1, detalle: `el archivo tiene ${m.funciones.length} funciones (práctica: máximo ${p.maxFuncionesArchivo})` });
  if (p.maxLineasArchivo !== null && m.lineas > p.maxLineasArchivo)
    v.push({ clave: "archivo:lineas", nivel: "archivo", linea: 1, detalle: `el archivo tiene ${m.lineas} líneas (práctica: máximo ${p.maxLineasArchivo})` });
  for (const f of m.funciones) {
    const d: string[] = [];
    if (p.maxLineasFuncion !== null && f.lineas > p.maxLineasFuncion) d.push(`${f.lineas} líneas (máx. ${p.maxLineasFuncion})`);
    if (p.maxAnidamiento !== null && f.anidamiento > p.maxAnidamiento) d.push(`${f.anidamiento} niveles de anidamiento (máx. ${p.maxAnidamiento})`);
    if (p.maxParametros !== null && f.parametros > p.maxParametros) d.push(`${f.parametros} parámetros (máx. ${p.maxParametros})`);
    if (d.length) v.push({ clave: `funcion:${f.nombre}`, nivel: "funcion", linea: f.linea, detalle: `${f.nombre}: ${d.join(", ")}` });
  }
  return v;
}

// --- Tests -----------------------------------------------------------------------

/** Dónde va el test de un archivo: tests/<misma ruta sin src/>/<nombre>.test.<ext> (o test_<nombre>.py). */
export function rutaTest(rel: string, carpeta: string): string {
  const ext = path.extname(rel);
  const base = path.basename(rel, ext);
  const dir = path.dirname(rel);
  const nombre = ext === ".py" ? `test_${base}.py` : `${base}.test${ext}`;
  if (!carpeta) return path.join(dir, nombre).split(path.sep).join("/");
  const sinSrc = dir === "src" ? "" : dir.replace(/^src\//, "");
  return path.join(carpeta, sinSrc, nombre).split(path.sep).join("/");
}

/** ¿Algún archivo de test del proyecto menciona esta función? (búsqueda textual, determinista) */
export function funcionesSinTests(z: Zoner, nombres: string[]): string[] {
  if (!nombres.length) return [];
  const carpeta = z.config.tests.carpeta;
  const tests = listFiles(z).filter((f) => (carpeta && f.startsWith(carpeta + "/")) || /(\.test\.|\.spec\.|(^|\/)test_)/.test(f));
  let texto = "";
  for (const t of tests.slice(0, 500)) {
    try {
      texto += fs.readFileSync(path.join(z.root, t), "utf8") + "\n";
    } catch {
      /* ignorar */
    }
  }
  return nombres.filter((n) => !new RegExp(`\\b${n.replace(/[$]/g, "\\$")}\\b`).test(texto));
}
