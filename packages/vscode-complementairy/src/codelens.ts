import * as vscode from "vscode";
import { root, vista } from "./comun";
import type { NotasView } from "./notasView";

/** Sobre cada función: `💬 2 notas · 💡 Ayuda · 🧪 Tests`. Las funciones las da VSCode (símbolos del documento). */

const FUNCIONES = new Set([vscode.SymbolKind.Function, vscode.SymbolKind.Method, vscode.SymbolKind.Constructor]);

function aplanar(s: vscode.DocumentSymbol[], out: vscode.DocumentSymbol[] = []): vscode.DocumentSymbol[] {
  for (const x of s) {
    if (FUNCIONES.has(x.kind)) out.push(x);
    aplanar(x.children, out);
  }
  return out;
}

export class Lentes implements vscode.CodeLensProvider {
  private readonly cambio = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.cambio.event;

  constructor(private readonly notas: NotasView) {
    notas.onCambio(() => this.cambio.fire());
  }

  async provideCodeLenses(doc: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    const cwd = root(doc);
    if (!cwd || vista(cwd) !== "notas" || !vscode.workspace.getConfiguration("cai").get<boolean>("codelens", true)) return [];
    const simbolos = (await vscode.commands.executeCommand<vscode.DocumentSymbol[] | undefined>("vscode.executeDocumentSymbolProvider", doc.uri)) ?? [];
    const todas = this.notas.notas(doc);
    const notas = todas.filter((n) => n.alcance !== "archivo");
    // Arriba del archivo: lo que es del archivo entero (no de una función).
    const arriba = new vscode.Range(0, 0, 0, 0);
    const u = doc.uri.toString();
    const out: vscode.CodeLens[] = [
      new vscode.CodeLens(arriba, { title: "📄 Archivo:", command: "" }),
      new vscode.CodeLens(arriba, { title: "🗺️ Plano", tooltip: "Qué funciones debería tener este archivo y por cuál empezar (notas + tareas)", command: "cai.plano", arguments: [doc.uri] }),
      new vscode.CodeLens(arriba, { title: "💡 Ayuda con el archivo", tooltip: "Preguntar o pedir pista/piezas/ejemplo sobre el archivo entero", command: "cai.ayudaArchivo", arguments: [u] }),
      new vscode.CodeLens(arriba, { title: "🔎 Revisar", tooltip: "Revisión completa del archivo", command: "cai.revisar" }),
    ];
    if (todas.length)
      out.push(new vscode.CodeLens(arriba, { title: `💬 ${todas.length} nota${todas.length > 1 ? "s" : ""}${todas.some((n) => n.bloqueante) ? " ⚠" : ""}`, tooltip: "Ver las notas de este archivo", command: "cai.notasArchivo", arguments: [u] }));
    for (const f of aplanar(simbolos)) {
      const r = new vscode.Range(f.range.start.line, 0, f.range.start.line, 0);
      const dentro = notas.filter((n) => n.ancla.linea - 1 >= f.range.start.line && n.ancla.linea - 1 <= f.range.end.line);
      if (dentro.length)
        out.push(new vscode.CodeLens(r, { title: `💬 ${dentro.length} nota${dentro.length > 1 ? "s" : ""}${dentro.some((n) => n.bloqueante) ? " ⚠" : ""}`, command: "cai.nota.abrir", arguments: [doc.uri.toString(), dentro[0]!.id] }));
      out.push(new vscode.CodeLens(r, { title: "💡 Ayuda", tooltip: "Pista, piezas, pseudocódigo, ejemplo o explicación para esta función", command: "cai.pedirAqui", arguments: [doc.uri.toString(), f.selectionRange.start.line + 1] }));
      out.push(new vscode.CodeLens(r, { title: "🧪 Tests", tooltip: "Proponer casos de prueba para esta función", command: "cai.pedirAqui", arguments: [doc.uri.toString(), f.selectionRange.start.line + 1, "tests"] }));
    }
    return out;
  }

  registrar(ctx: vscode.ExtensionContext): void {
    ctx.subscriptions.push(
      vscode.languages.registerCodeLensProvider({ scheme: "file" }, this),
      vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration("cai") && this.cambio.fire()),
      this.cambio,
    );
  }
}
