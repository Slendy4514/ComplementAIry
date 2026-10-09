import { spawn, type ChildProcess } from "node:child_process";
import * as vscode from "vscode";
import { cli, correr, leerConfig, output, root, silenciado, vista } from "./comun";
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

/** Proceso `cai servir` (uno por proyecto): pedidos JSON por línea, respuestas por `id`. */
class Servidor implements vscode.Disposable {
  private proc?: ChildProcess;
  private buf = "";
  private sig = 0;
  private readonly espera = new Map<number, { ok: (v: unknown) => void; mal: (e: Error) => void; timer: NodeJS.Timeout }>();
  /** Salidas rápidas seguidas (p. ej. una CLI vieja sin `servir`): tras 3, no se relanza más en esta sesión. */
  private caidas = 0;
  private apagado = false;

  constructor(private readonly cwd: string) {}

  private arrancar(): ChildProcess {
    const p = spawn("sh", ["-c", `${cli()} servir`], { cwd: this.cwd, env: { ...process.env, CLAUDE_PROJECT_DIR: this.cwd } });
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
          const r = JSON.parse(linea) as { id: number; ok: boolean; error?: string };
          const e = this.espera.get(r.id);
          if (!e) continue;
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
        this.espera.delete(id);
        mal(new Error("cai servir tardó demasiado"));
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

  constructor(private readonly notas: NotasView) {}

  registrar(ctx: vscode.ExtensionContext): void {
    // Precalentar: si el proyecto usa notas y sugerencias rápidas, el proceso arranca ya.
    const cwd = root(vscode.window.activeTextEditor?.document);
    if (cwd && vista(cwd) === "notas" && leerConfig(cwd).rapidas?.activas !== false) this.servidor(cwd)?.precalentar();
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
      const pedido = { tipo: "rapida", archivo: doc.uri.fsPath, linea: linea + 1 };
      const s = this.servidor(cwd);
      // Primero el proceso abierto (~1 s); si no responde, la llamada de siempre (~20 s).
      const r = s
        ? await s.pedir<{ texto?: string }>(pedido).catch(async () => JSON.parse(await correr(["rapida", doc.uri.fsPath, "--linea", String(linea + 1), "--json"], cwd, { silencioso: true })) as { texto?: string })
        : (JSON.parse(await correr(["rapida", doc.uri.fsPath, "--linea", String(linea + 1), "--json"], cwd, { silencioso: true })) as { texto?: string });
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
    for (const s of this.servidores.values()) s.dispose();
  }
}
