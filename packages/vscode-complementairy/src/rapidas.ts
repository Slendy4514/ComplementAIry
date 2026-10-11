import { spawn, type ChildProcess } from "node:child_process";
import * as vscode from "vscode";
import { tieneCai } from "./iniciar";
import { comandoCli, correr, entornoCli, guiaActual, leerConfig, output, root, silenciado, vista } from "./comun";
import type { NotasView } from "./notasView";

/**
 * Sugerencias rápidas: tras una pausa escribiendo dentro de una función con nota, una pista de una
 * línea en gris al final de la línea (como el autocompletar, pero NO se inserta nada ni compite con
 * Tab). Desaparece al seguir escribiendo o al moverte. Los límites (caché, espera por función,
 * máximo por hora) los aplica la CLI.
 *
 * Rapidez: un proceso `cai servir` queda abierto (con Claude Code ya arrancado): cada sugerencia tarda
 * ~1 s en vez de ~20 s. Si no responde a tiempo o se cae, se usa `cai rapida` (la llamada de siempre).
 */

/** La IA ya estaba respondiendo cuando venció el plazo: pedirla de nuevo por otra vía sería pagarla dos veces. */
class EnCurso extends Error {
  constructor() {
    super("la sugerencia tardó más de lo esperado (ya estaba en curso; no se pide otra vez)");
  }
}

/** Proceso `cai servir` (uno por proyecto): pedidos JSON por línea, respuestas por `id`. */
class Servidor implements vscode.Disposable {
  private proc?: ChildProcess;
  private buf = "";
  private sig = 0;
  private readonly espera = new Map<number, { ok: (v: unknown) => void; mal: (e: Error) => void; timer: NodeJS.Timeout; empezado?: boolean }>();
  /** Salidas rápidas seguidas (p. ej. una CLI vieja sin `servir`): tras 3, no se relanza más en esta sesión. */
  private caidas = 0;
  private apagado = false;

  constructor(private readonly cwd: string) {}

  private arrancar(): ChildProcess {
    const { exe, base } = comandoCli();
    const p = spawn(exe, [...base, "servir"], { cwd: this.cwd, env: entornoCli(this.cwd) });
    const inicio = Date.now();
    p.stdout!.setEncoding("utf8"); // los acentos no se cortan entre dos trozos
    p.on("error", (e) => output.appendLine(`[servir] ${e.message}`));
    p.stdin!.on("error", () => undefined); // escribir a un proceso que acaba de morir no rompe la extensión
    p.stdout!.on("data", (d: string) => {
      this.buf += d;
      let i: number;
      while ((i = this.buf.indexOf("\n")) >= 0) {
        const linea = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + 1);
        try {
          const r = JSON.parse(linea) as { id: number; ok: boolean; error?: string; empezado?: boolean };
          const e = this.espera.get(r.id);
          if (!e) continue;
          // Aviso intermedio: la llamada a la IA ya empezó (si se pasa del tiempo, no se paga otra).
          if (r.empezado) {
            e.empezado = true;
            continue;
          }
          clearTimeout(e.timer);
          this.espera.delete(r.id);
          if (r.ok) e.ok(r);
          else e.mal(new Error(r.error ?? "error"));
        } catch {
          /* línea que no es JSON: se ignora */
        }
      }
    });
    p.stderr!.on("data", (d: Buffer) => output.append(`[servir] ${d.toString()}`));
    p.on("exit", () => {
      if (this.proc === p) this.proc = undefined;
      if (Date.now() - inicio < 5000 && ++this.caidas >= 3) {
        this.apagado = true;
        output.appendLine("[servir] se cerró al arrancar 3 veces: las sugerencias rápidas usan la llamada normal en esta sesión");
      }
      for (const [id, e] of this.espera) {
        clearTimeout(e.timer);
        e.mal(new Error("cai servir terminó"));
        this.espera.delete(id);
      }
    });
    return p;
  }

  /** Arranca el proceso ya (el arranque de Claude Code se paga ahora, no en la primera sugerencia). */
  precalentar(): void {
    if (!this.apagado) this.proc ??= this.arrancar();
  }

  pedir<T>(pedido: object, timeoutMs = 8000): Promise<T> {
    if (this.apagado) return Promise.reject(new Error("cai servir no disponible"));
    this.proc ??= this.arrancar();
    const id = ++this.sig;
    return new Promise<T>((ok, mal) => {
      const timer = setTimeout(() => {
        const e = this.espera.get(id);
        this.espera.delete(id);
        mal(e?.empezado ? new EnCurso() : new Error("cai servir tardó demasiado"));
      }, timeoutMs);
      this.espera.set(id, { ok: ok as (v: unknown) => void, mal, timer });
      // "vence": después de eso ya no esperamos la respuesta, y `cai servir` no gasta en ella.
      this.proc!.stdin!.write(`${JSON.stringify({ id, ...pedido, vence: Date.now() + timeoutMs })}\n`);
    });
  }

  dispose(): void {
    this.proc?.stdin?.end();
    this.proc?.kill();
  }
}
export class Rapidas implements vscode.Disposable {
  private readonly deco = vscode.window.createTextEditorDecorationType({
    after: { color: new vscode.ThemeColor("editorCodeLens.foreground"), fontStyle: "italic", margin: "0 0 0 2em" },
  });
  private timer?: NodeJS.Timeout;
  private turno = 0;
  /** Dónde está la guía que se ve (para dejarla mientras escribes en esa misma línea). */
  private vista?: { doc: vscode.TextDocument; linea: number; texto: string };
  private readonly servidores = new Map<string, Servidor>();

  /** El proceso abierto del proyecto (si está activado en la configuración). */
  private servidor(cwd: string): Servidor | undefined {
    if (leerConfig(cwd).rapidas?.procesoAbierto === false) {
      // Lo apagaste en la configuración: se cierra el que estaba corriendo.
      this.servidores.get(cwd)?.dispose();
      this.servidores.delete(cwd);
      return undefined;
    }
    let s = this.servidores.get(cwd);
    if (!s) this.servidores.set(cwd, (s = new Servidor(cwd)));
    return s;
  }

  constructor(_notas: NotasView) {}

  registrar(ctx: vscode.ExtensionContext): void {
    // Precalentar: si el proyecto usa notas y sugerencias rápidas, el proceso arranca ya.
    const cwd = root(vscode.window.activeTextEditor?.document);
    if (cwd && vista(cwd) === "notas" && leerConfig(cwd).rapidas?.activas === true) this.servidor(cwd)?.precalentar();
    ctx.subscriptions.push(
      this,
      vscode.window.onDidChangeTextEditorSelection((e) => this.programar(e.textEditor)),
      vscode.workspace.onDidChangeTextDocument((e) => {
        const ed = vscode.window.activeTextEditor;
        if (ed && e.document === ed.document && e.contentChanges.length) this.programar(ed);
      }),
      // Al guardar también (con Ctrl+S el cursor no se mueve y no habría otro aviso).
      vscode.workspace.onDidSaveTextDocument((doc) => {
        const ed = vscode.window.activeTextEditor;
        if (ed && ed.document === doc) this.programar(ed);
      }),
      // Hover sobre la línea con guía: el texto completo (en el editor puede verse recortado).
      vscode.languages.registerHoverProvider({ scheme: "file" }, {
        provideHover: (doc, pos) =>
          guiaActual.texto && guiaActual.uri === doc.uri.toString() && guiaActual.linea === pos.line ? new vscode.Hover(new vscode.MarkdownString(`💡 **Guía:** ${guiaActual.texto.replace(/[<>]/g, "")}`)) : undefined,
      }),
      // A pedido (Ctrl+Alt+Espacio): siempre dice algo, la pista o por qué no hay.
      vscode.commands.registerCommand("cai.sugerenciaAhora", async () => {
        const ed = vscode.window.activeTextEditor;
        const c = ed && root(ed.document);
        if (!ed || !c) return;
        this.limpiar(ed);
        vscode.window.setStatusBarMessage("$(sync~spin) ComplementAIry: pensando una sugerencia…", 3000);
        const r = await this.consultar(ed, c, true);
        if (r.texto) this.mostrar(ed, ed.selection.active.line, r.texto, false, r.completo);
        else vscode.window.setStatusBarMessage(`ComplementAIry: sin sugerencia aquí${r.motivo ? ` (${r.motivo})` : " (la línea va bien)"}`, 6000);
      }),
    );
  }

  private limpiar(ed: vscode.TextEditor): void {
    ed.setDecorations(this.deco, []);
    this.vista = undefined;
  }

  private mostrar(ed: vscode.TextEditor, linea: number, texto: string, vieja = false, completo?: string): void {
    if (!vieja) Object.assign(guiaActual, { uri: ed.document.uri.toString(), linea, texto: completo ?? texto });
    const fin = ed.document.lineAt(linea).range.end;
    // Mientras escribes, la guía anterior queda (más tenue) hasta que llega la nueva.
    ed.setDecorations(this.deco, [{ range: new vscode.Range(fin, fin), renderOptions: { after: { contentText: `💡 ${texto}`, ...(vieja ? { color: new vscode.ThemeColor("disabledForeground") } : {}) } } }]);
    this.vista = { doc: ed.document, linea, texto };
  }

  private programar(ed: vscode.TextEditor): void {
    // Misma línea: la guía se queda (tenue) y se actualiza en la pausa. Otra línea: se limpia.
    const linea = ed.selection.active.line;
    if (this.vista && this.vista.doc === ed.document && this.vista.linea === linea && linea < ed.document.lineCount) this.mostrar(ed, linea, this.vista.texto, true);
    else this.limpiar(ed);
    clearTimeout(this.timer);
    this.turno++;
    const doc = ed.document;
    const cwd = root(doc);
    if (!cwd || doc.uri.scheme !== "file" || vista(cwd) !== "notas" || silenciado() || !tieneCai(cwd)) return;
    const cfg = leerConfig(cwd).rapidas ?? {};
    if (cfg.activas !== true) return; // II.3: nada aparece mientras tecleas salvo que lo actives (a pedido: Ctrl+Alt+Espacio)
    const turno = this.turno;
    this.timer = setTimeout(() => void this.pedir(ed, cwd, turno), Math.max(600, cfg.esperaMs ?? 1200));
  }

  /**
   * Pide la sugerencia. Con el proceso abierto se manda el TEXTO DEL EDITOR (sirve aunque no esté
   * guardado); la llamada de respaldo lee el disco, así que solo se usa con el archivo guardado.
   */
  private async consultar(ed: vscode.TextEditor, cwd: string, aPedido: boolean): Promise<{ texto?: string; completo?: string; motivo?: string }> {
    const doc = ed.document;
    const linea = ed.selection.active.line + 1;
    const respaldo = async () =>
      doc.isDirty
        ? { motivo: "el archivo tiene cambios sin guardar y el proceso abierto no respondió" }
        : (JSON.parse(await correr(["rapida", doc.uri.fsPath, "--linea", String(linea), "--json"], cwd, { silencioso: true })) as { texto?: string; motivo?: string });
    const s = this.servidor(cwd);
    if (!s) return respaldo();
    return s.pedir<{ texto?: string; completo?: string; motivo?: string }>({ tipo: "rapida", archivo: doc.uri.fsPath, linea, texto: doc.getText(), ...(aPedido ? { aPedido: true } : {}) })
      .catch((e: unknown) => (e instanceof EnCurso ? { motivo: e.message } : respaldo()));
  }

  private async pedir(ed: vscode.TextEditor, cwd: string, turno: number): Promise<void> {
    const doc = ed.document;
    if (doc.isClosed) return;
    const linea = ed.selection.active.line;
    const version = doc.version;
    try {
      const r = await this.consultar(ed, cwd, false);
      // Si mientras tanto escribiste o te moviste, la sugerencia ya no corresponde.
      if (turno !== this.turno || doc.version !== version || ed.selection.active.line !== linea || !r.texto) return;
      this.mostrar(ed, linea, r.texto, false, r.completo);
    } catch {
      /* sin sugerencia: no molesta */
    }
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.deco.dispose();
    for (const s of this.servidores.values()) s.dispose();
  }
}
