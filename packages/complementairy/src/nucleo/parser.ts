import { createRequire } from "node:module";
import path from "node:path";
import { Language, Parser, type Node } from "web-tree-sitter";

const require = createRequire(import.meta.url);
const wasmDir = path.join(path.dirname(require.resolve("tree-sitter-wasms/package.json")), "out");
// Gramáticas oficiales en vez de las de tree-sitter-wasms: la de Bash se cae con `[ a != b ]`
// y la de YAML no carga con web-tree-sitter 0.25.
const oficial = (pkg: string, wasm: string) => path.join(path.dirname(require.resolve(`${pkg}/package.json`)), wasm);
const PROPIAS: Record<string, string> = {
  bash: oficial("tree-sitter-bash", "tree-sitter-bash.wasm"),
  yaml: oficial("@tree-sitter-grammars/tree-sitter-yaml", "tree-sitter-yaml.wasm"),
};

let ready: Promise<void> | null = null;
const languages = new Map<string, Language>();

export async function getParser(grammar: string): Promise<Parser> {
  ready ??= Parser.init();
  await ready;
  let lang = languages.get(grammar);
  if (!lang) {
    lang = await Language.load(PROPIAS[grammar] ?? path.join(wasmDir, `tree-sitter-${grammar}.wasm`));
    languages.set(grammar, lang);
  }
  const parser = new Parser();
  parser.setLanguage(lang);
  return parser;
}

export type SyntaxNode = Node;

/** Hijos sin huecos (en web-tree-sitter 0.25 pueden venir `null`). */
export const hijos = (n: Node): Node[] => n.children.filter((c): c is Node => c !== null);
export const nombrados = (n: Node): Node[] => n.namedChildren.filter((c): c is Node => c !== null);
