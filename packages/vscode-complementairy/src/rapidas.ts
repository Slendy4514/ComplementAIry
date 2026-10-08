import * as vscode from "vscode";
import { correr, leerConfig, root, silenciado, vista } from "./comun";
import type { NotasView } from "./notasView";

/**
 * Sugerencias rápidas: tras una pausa escribiendo dentro de una función con nota, una pista de una
 * línea en gris al final de la línea (como el autocompletar, pero NO se inserta nada ni compite con
 * Tab). Desaparece al seguir escribiendo o al moverte. Los límites (caché, una cada 20 s por función,
 * máximo por hora) los aplica la CLI (`cai rapida`).
 */
export class Rapidas implements vscode.Disposable {
  private readonly deco = vscode.window.createTextEditorDecorationType({
    after: { color: new vscode.ThemeColor("editorCodeLens.foreground"), fontStyle: "italic", margin: "0 0 0 2em" },
  });
  private timer?: NodeJS.Timeout;
  private turno = 0;

  constructor(private readonly notas: NotasView) {}

  registrar(ctx: vscode.ExtensionContext): void {
    ctx.subscriptions.push(
      this,
      vscode.window.onDidChangeTextEditorSelection((e) => this.programar(e.textEditor)),
      vscode.workspace.onDidChangeTextDocument((e) => {
        const ed = vscode.window.activeTextEditor;
        if (ed && e.document === ed.document) this.programar(ed);
      }),
    );
  }

  private limpiar(ed: vscode.TextEditor): void {
    ed.setDecorations(this.deco, []);
  }

  private programar(ed: vscode.TextEditor): void {
    this.limpiar(ed);
    clearTimeout(this.timer);
    this.turno++;
    const doc = ed.document;
    const cwd = root(doc);
    if (!cwd || doc.uri.scheme !== "file" || vista(cwd) !== "notas" || silenciado()) return;
    const cfg = leerConfig(cwd).rapidas ?? {};
    if (cfg.activas === false) return;
    // Solo si el archivo tiene alguna nota de función (si no, ni se consulta la CLI).
    if (!this.notas.notas(doc).some((n) => n.ancla.funcion)) return;
    const turno = this.turno;
    this.timer = setTimeout(() => void this.pedir(ed, cwd, turno), Math.max(800, cfg.esperaMs ?? 2000));
  }

  private async pedir(ed: vscode.TextEditor, cwd: string, turno: number): Promise<void> {
    const doc = ed.document;
    // La CLI lee el disco: con cambios sin guardar (sin autoguardado) no hay sugerencia.
    if (doc.isDirty || doc.isClosed) return;
    const linea = ed.selection.active.line;
    const version = doc.version;
    try {
      const r = JSON.parse(await correr(["rapida", doc.uri.fsPath, "--linea", String(linea + 1), "--json"], cwd, { silencioso: true })) as { texto?: string };
      // Si mientras tanto escribiste o te moviste, la sugerencia ya no corresponde.
      if (turno !== this.turno || doc.version !== version || ed.selection.active.line !== linea || !r.texto) return;
      const fin = doc.lineAt(linea).range.end;
      ed.setDecorations(this.deco, [{ range: new vscode.Range(fin, fin), renderOptions: { after: { contentText: `💡 ${r.texto}` } } }]);
    } catch {
      /* sin sugerencia: no molesta */
    }
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.deco.dispose();
  }
}
