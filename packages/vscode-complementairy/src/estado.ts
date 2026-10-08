import path from "node:path";
import * as vscode from "vscode";
import { enCurso, minutosSilencio, output, relDe, root, silenciado, silenciar, type Ocupacion } from "./comun";

/**
 * "¿Está pensando la IA?": barra de estado con lo que hace ahora (aunque lo haya pedido el chat
 * de Claude Code), cuánto lleva, un clic para cancelar o silenciar, y un "pensando…" en la línea.
 * Lee .cai/cache/ocupado/, que escribe la CLI.
 */

const pensandoDeco = vscode.window.createTextEditorDecorationType({
  after: { contentText: "  ⏳ ComplementAIry pensando…", color: new vscode.ThemeColor("editorCodeLens.foreground"), fontStyle: "italic" },
  isWholeLine: true,
});

export class Estado implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  private readonly timer: NodeJS.Timeout;
  private ocupado: Ocupacion[] = [];
  private readonly cambio = new vscode.EventEmitter<Ocupacion[]>();
  /** Cuando empieza o termina un trabajo de la IA (para el panel). */
  readonly onCambio = this.cambio.event;
  private firma = "";

  constructor() {
    this.item.command = "cai.estado";
    this.timer = setInterval(() => this.actualizar(), 1000);
    this.actualizar();
  }

  get actual(): Ocupacion[] {
    return this.ocupado;
  }

  actualizar(): void {
    const cwd = root();
    this.ocupado = cwd ? enCurso(cwd) : [];
    const firma = this.ocupado.map((o) => `${o.pid}:${o.archivo}:${o.tarea}`).join("|");
    if (firma !== this.firma) {
      this.firma = firma;
      this.cambio.fire(this.ocupado);
    }
    const o = this.ocupado[0];
    if (o) {
      const seg = Math.round((Date.now() - Date.parse(o.desde)) / 1000);
      const donde = o.archivo === "__proyecto__" ? "" : ` ${path.basename(o.archivo)}`;
      this.item.text = `$(sync~spin) ComplementAIry: ${o.tarea}${donde} (${seg} s)${this.ocupado.length > 1 ? ` +${this.ocupado.length - 1}` : ""}`;
      this.item.tooltip = "La IA está trabajando. Clic para ver o cancelar.";
    } else if (silenciado()) {
      this.item.text = `$(bell-slash) ComplementAIry (silenciado ${minutosSilencio()} min)`;
      this.item.tooltip = "El acompañante no comenta al guardar. Clic para reactivar.";
    } else {
      this.item.text = "$(eye) ComplementAIry";
      this.item.tooltip = "Clic: siguiente paso, silenciar, salida";
    }
    this.item.show();
    // "pensando…" en la línea donde trabaja la IA.
    for (const ed of vscode.window.visibleTextEditors) {
      const cwd2 = root(ed.document);
      const rel = cwd2 ? relDe(cwd2, ed.document.uri.fsPath) : "";
      const aqui = this.ocupado.filter((x) => x.archivo === rel && x.linea);
      ed.setDecorations(
        pensandoDeco,
        aqui.map((x) => new vscode.Range(Math.min(x.linea! - 1, ed.document.lineCount - 1), 0, Math.min(x.linea! - 1, ed.document.lineCount - 1), 0)),
      );
    }
  }

  registrar(ctx: vscode.ExtensionContext): void {
    ctx.subscriptions.push(
      this,
      vscode.commands.registerCommand("cai.estado", async () => {
        type Op = vscode.QuickPickItem & { run: () => unknown };
        const ops: Op[] = [{ label: "$(play) Siguiente paso", run: () => vscode.commands.executeCommand("cai.siguiente") }];
        for (const o of this.ocupado)
          ops.push({
            label: `$(stop-circle) Cancelar: ${o.tarea}`,
            description: o.archivo === "__proyecto__" ? "proyecto" : o.archivo,
            run: () => {
              try {
                process.kill(o.pid, "SIGTERM");
              } catch {
                /* ya terminó */
              }
              setTimeout(() => this.actualizar(), 300);
            },
          });
        ops.push(
          silenciado()
            ? { label: "$(bell) Volver a activar el acompañante", run: () => silenciar(0) }
            : { label: "$(bell-slash) Silenciar 30 min", description: "el acompañante no comenta al guardar", run: () => silenciar(30) },
          { label: "$(output) Ver salida", run: () => output.show() },
        );
        const op = await vscode.window.showQuickPick(ops, { placeHolder: "ComplementAIry" });
        await op?.run();
        this.actualizar();
      }),
      vscode.commands.registerCommand("cai.silenciar", () => {
        silenciar(silenciado() ? 0 : 30);
        this.actualizar();
      }),
    );
  }

  dispose(): void {
    clearInterval(this.timer);
    this.item.dispose();
    this.cambio.dispose();
  }
}
