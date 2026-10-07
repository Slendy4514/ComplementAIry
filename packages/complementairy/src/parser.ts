import { createRequire } from "node:module";
import path from "node:path";
import Parser from "web-tree-sitter";

const require = createRequire(import.meta.url);
const wasmDir = path.join(path.dirname(require.resolve("tree-sitter-wasms/package.json")), "out");

let ready: Promise<void> | null = null;
const languages = new Map<string, Parser.Language>();

export async function getParser(grammar: string): Promise<Parser> {
  ready ??= Parser.init();
  await ready;
  let lang = languages.get(grammar);
  if (!lang) {
    lang = await Parser.Language.load(path.join(wasmDir, `tree-sitter-${grammar}.wasm`));
    languages.set(grammar, lang);
  }
  const parser = new Parser();
  parser.setLanguage(lang);
  return parser;
}

export type SyntaxNode = Parser.SyntaxNode;
