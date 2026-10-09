import path from "node:path";
import * as vscode from "vscode";
import { correr, enCurso, leerConfig, minutosSilencio, modoEfectivo, MODOS, output, relDe, root, silenciado, silenciar, vista, type Ocupacion } from "./comun";

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

/**
 * El modo que rige donde está el cursor (programar / aprender) y el siguiente paso, en la barra de
 * estado. Clic en el modo: cambiarlo para esta función, este archivo, la carpeta o el proyecto
 * (cambiar de modo solo cambia cómo se da la ayuda nueva: lo ya hecho no se toca).
 */
export class BarraModo implements vscode.Disposable {
  private readonly modo = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 49);
  private readonly paso = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 48);
  private timer?: NodeJS.Timeout;
  private funcion?: string;

  constructor(private readonly notasDe: (doc: vscode.TextDocument) => { ancla: { funcion?: string }; modo?: string }[]) {
    this.modo.command = "cai.cambiarModo";
    this.paso.command = "cai.siguiente";
  }

  registrar(ctx: vscode.ExtensionContext): void {
    ctx.subscriptions.push(
      this,
      vscode.window.onDidChangeTextEditorSelection(() => this.programar()),
      vscode.window.onDidChangeActiveTextEditor(() => this.programar()),
      vscode.commands.registerCommand("cai.estado.actualizarModo", () => void this.actualizar()),
      vscode.commands.registerCommand("cai.cambiarModo", () => this.cambiar()),
    );
    void this.actualizar();
  }

  /** El siguiente paso (lo calcula el panel). */
  siguiente(p?: { accion: string; titulo: string }): void {
    if (!p) return void this.paso.hide();
    this.paso.text = `$(play) ${p.accion.length > 50 ? `${p.accion.slice(0, 50)}…` : p.accion}`;
    this.paso.tooltip = `Siguiente paso: ${p.titulo}\nClic: ver todos los pendientes`;
    this.paso.show();
  }

  private programar(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.actualizar(), 400);
  }

  private async actualizar(): Promise<void> {
    const ed = vscode.window.activeTextEditor;
    const cwd = ed && root(ed.document);
    if (!ed || !cwd || ed.document.uri.scheme !== "file" || vista(cwd) !== "notas") return void this.modo.hide();
    const { funcionEn } = await import("./notaView");
    const f = await funcionEn(ed.document, ed.selection.active);
    this.funcion = f?.clave;
    const ef = modoEfectivo(leerConfig(cwd), relDe(cwd, ed.document.uri.fsPath), f?.clave);
    this.modo.text = `$(${MODOS[ef.modo].icono}) ${ef.modo}`;
    this.modo.tooltip = `Modo ${ef.modo} (por ${{ funcion: "esta función", archivo: "este archivo", carpeta: "la carpeta", proyecto: "el proyecto" }[ef.origen]}). Clic para cambiarlo.\nprogramar: ayuda directa, snippets, sugerencias rápidas · aprender: ayuda gradual, predecir, explicar con tus palabras`;
    this.modo.show();
  }

  private async cambiar(): Promise<void> {
    const ed = vscode.window.activeTextEditor;
    const cwd = ed && root(ed.document);
    if (!ed || !cwd) return;
    const rel = relDe(cwd, ed.document.uri.fsPath);
    // La carpeta como prefijo literal (sin glob: rutas como "app/[id]/" funcionan igual en la CLI).
    const carpeta = rel.includes("/") ? `${rel.slice(0, rel.lastIndexOf("/"))}/` : undefined;
    type Op = vscode.QuickPickItem & { args: string[] };
    const alcance = await vscode.window.showQuickPick<Op>(
      [
        ...(this.funcion ? [{ label: `$(symbol-method) Esta función (${this.funcion.replace(/#\d+$/, "")})`, args: ["--funcion", `${rel}:${this.funcion}`] }] : []),
        { label: `$(file) Este archivo (${rel})`, args: ["--archivo", rel] },
        ...(carpeta ? [{ label: `$(folder) Esta carpeta (${carpeta})`, args: ["--carpeta", carpeta] }] : []),
        { label: "$(project) Todo el proyecto", args: [] },
      ],
      { placeHolder: "¿Dónde cambiar el modo? (lo ya hecho no se toca)" },
    );
    if (!alcance) return;
    const modo = await vscode.window.showQuickPick(
      [
        { label: "$(rocket) programar", description: "ayuda directa, snippets, sugerencias rápidas", v: "programar" },
        { label: "$(mortar-board) aprender", description: "ayuda gradual, predecir, explicar con tus palabras", v: "aprender" },
        ...(alcance.args.length ? [{ label: "$(arrow-up) heredar", description: "quitar el modo propio y usar el de arriba", v: "heredar" }] : []),
      ],
      { placeHolder: "Modo" },
    );
    if (!modo) return;
    try {
      await correr(["modo", modo.v, ...alcance.args], cwd);
      await this.actualizar();
      void vscode.commands.executeCommand("cai.panel.refrescar");
    } catch (e) {
      vscode.window.showErrorMessage(`ComplementAIry: ${(e as Error).message}`);
    }
  }

  dispose(): void {
    this.modo.dispose();
    this.paso.dispose();
  }
}
