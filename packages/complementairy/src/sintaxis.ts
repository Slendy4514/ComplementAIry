import { hijos, type SyntaxNode } from "./parser.js";

/** Errores de sintaxis (nodos ERROR o faltantes) del árbol, sin IA. */
export function syntaxErrors(root: SyntaxNode | null): { line: number; msg: string }[] {
  const out: { line: number; msg: string }[] = [];
  if (!root?.hasError) return out;
  const walk = (n: SyntaxNode) => {
    if (n.type === "ERROR" || n.isMissing) out.push({ line: n.startPosition.row + 1, msg: n.isMissing ? `falta ${n.type}` : "error de sintaxis" });
    else if (n.hasError) for (const c of hijos(n)) walk(c);
  };
  walk(root);
  return out;
}
