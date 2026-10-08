import * as vscode from "vscode";
import { archivoNotas, correr, guardar, mostrarError, notasDe, OcupadoError, relDe, root, vista, type Nota } from "./comun";

/**
 * Las notas como hilos nativos de VSCode (como en la revisión de un PR), en la línea exacta.
 * El archivo nunca se toca: se terminan los choques con el autoguardado.
 * Cada nota tiene botones (pista, pseudocódigo, tests...) y una caja para escribirle a la IA.
 */

const ICONO: Record<string, string> = {
  pista: "💡",
  pieza: "🧩",
  plano: "🗺️",
  pregunta: "❓",
  revision: "🔎",
  ejemplo: "🔁",
  snippet: "🧩",
  prediccion: "🎯",
  tests: "🧪",
  nota: "📝",
};

/** Los botones de cada nota: el mismo pedido que se escribe a mano (!pseudo, !tests...). */
export const BOTONES: { pedido: string; etiqueta: string }[] = [
  { pedido: "pista", etiqueta: "💡 Pista" },
  { pedido: "piezas", etiqueta: "🧩 Piezas" },
  { pedido: "pseudo", etiqueta: "📝 Pseudocódigo" },
  { pedido: "ejemplo", etiqueta: "🔁 Ejemplo" },
  { pedido: "tests", etiqueta: "🧪 Tests" },
  { pedido: "plano", etiqueta: "🗺️ Plano" },
  { pedido: "explica", etiqueta: "❓ Explícame" },
];

class Comentario implements vscode.Comment {
  mode = vscode.CommentMode.Preview;
  constructor(
    public body: vscode.MarkdownString,
    public author: vscode.CommentAuthorInformation,
    public label?: string,
    public contextValue?: string,
  ) {}
}

const IA: vscode.CommentAuthorInformation = { name: "ComplementAIry" };
const TU: vscode.CommentAuthorInformation = { name: "Tú" };

/** Texto de un mensaje: sin enlaces de comando (viene de la IA o de un archivo que puede venir de otros). */
function md(texto: string): vscode.MarkdownString {
  const m = new vscode.MarkdownString(texto, true);
  m.supportThemeIcons = true;
  return m;
}

/** Solo el pie que arma la extensión puede tener botones (enlaces a comandos). */
function mdBotones(texto: string, comandos: string[]): vscode.MarkdownString {
  const m = md(texto);
  m.isTrusted = { enabledCommands: comandos };
  return m;
}

const cmd = (id: string, args: unknown[]) => `command:${id}?${encodeURIComponent(JSON.stringify(args))}`;

export class NotasView implements vscode.Disposable, vscode.HoverProvider {
  readonly controller = vscode.comments.createCommentController("complementairy", "ComplementAIry");
  readonly diagnosticos = vscode.languages.createDiagnosticCollection("complementairy");
  private readonly hilos = new Map<string, Map<string, vscode.CommentThread>>();
  private readonly idDe = new WeakMap<vscode.CommentThread, { uri: string; id: string }>();
  private readonly ocupados = new Set<vscode.CommentThread>();
  /** Notas a mostrar desplegadas en el próximo dibujo (la que acabas de pedir/responder). */
  private readonly desplegar = new Set<string>();
  private readonly cambio = new vscode.EventEmitter<vscode.Uri>();
  /** Avisa cuando cambian las notas de un documento (para CodeLens y el panel). */
  readonly onCambio = this.cambio.event;
  private readonly temporizadores = new Map<string, NodeJS.Timeout>();
  private readonly avisados = new Set<string>();

  constructor(private readonly insertar: (doc: vscode.TextDocument, nota: Nota, i: number) => Promise<void>) {
    this.controller.commentingRangeProvider = {
      provideCommentingRanges: (doc) => {
        const cwd = root(doc);
        return cwd && doc.uri.scheme === "file" && vista(cwd) === "notas" ? [new vscode.Range(0, 0, Math.max(0, doc.lineCount - 1), 0)] : [];
      },
    };
    this.controller.options = { prompt: "Pregúntale a ComplementAIry…", placeHolder: "Escribe tu pregunta (o !pista, !pseudo, !tests…) y presiona Ctrl+Enter" };
  }

  /** Notas abiertas del documento, re-ancladas al texto actual. */
  notas(doc: vscode.TextDocument): Nota[] {
    return this.leer(doc) ?? [];
  }

  private leer(doc: vscode.TextDocument): Nota[] | undefined {
    const cwd = root(doc);
    return cwd && doc.uri.scheme === "file" && vista(cwd) === "notas" ? notasDe(cwd, doc) : [];
  }

  /** Re-dibuja (con un pequeño retraso para agrupar cambios seguidos). */
  programar(doc: vscode.TextDocument, ms = 300): void {
    const k = doc.uri.toString();
    clearTimeout(this.temporizadores.get(k));
    this.temporizadores.set(
      k,
      setTimeout(() => {
        this.temporizadores.delete(k);
        this.dibujar(doc);
      }, ms),
    );
  }

  dibujar(doc: vscode.TextDocument): void {
    if (doc.isClosed || doc.uri.scheme !== "file") return;
    const k = doc.uri.toString();
    const notas = this.leer(doc);
    if (!notas) return; // no se pudo leer: se deja lo que hay hasta el próximo cambio
    let mapa = this.hilos.get(k);
    if (!mapa) this.hilos.set(k, (mapa = new Map()));
    const vivas = new Set(notas.map((n) => n.id));
    for (const [id, t] of mapa)
      if (!vivas.has(id) && !this.ocupados.has(t)) {
        t.dispose();
        mapa.delete(id);
      }
    for (const n of notas) {
      const linea = Math.min(Math.max(0, n.ancla.linea - 1), Math.max(0, doc.lineCount - 1));
      const rango = new vscode.Range(linea, 0, linea, 0);
      let t = mapa.get(n.id);
      if (t && this.ocupados.has(t)) continue; // no tocar mientras la IA responde en ese hilo
      if (!t) {
        t = this.controller.createCommentThread(doc.uri, rango, []);
        t.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
        mapa.set(n.id, t);
        this.idDe.set(t, { uri: k, id: n.id });
      } else if (!t.range || t.range.start.line !== linea) t.range = rango;
      t.label = `${ICONO[n.tipo] ?? "📝"} ${n.titulo}${n.bloqueante ? "  ⚠ bloqueante" : ""}${n.desanclada ? "  (su línea cambió)" : ""}`;
      t.contextValue = n.snippets.length ? "cai-nota cai-snippet" : "cai-nota";
      t.canReply = true;
      t.comments = this.comentarios(k, n);
      if (this.desplegar.delete(n.id)) t.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    }
    // Hallazgos bloqueantes también en el panel "Problemas".
    this.diagnosticos.set(
      doc.uri,
      notas
        .filter((n) => n.bloqueante)
        .map((n) => {
          const l = Math.min(Math.max(0, n.ancla.linea - 1), Math.max(0, doc.lineCount - 1));
          const d = new vscode.Diagnostic(doc.lineAt(l).range, `${n.titulo}${n.accion ? ` — ${n.accion}` : ""}`, vscode.DiagnosticSeverity.Warning);
          d.source = "ComplementAIry";
          return d;
        }),
    );
    this.cambio.fire(doc.uri);
  }

  private comentarios(uri: string, n: Nota): vscode.Comment[] {
    const out: vscode.Comment[] = n.hilo.map((m) => new Comentario(md(m.texto), m.quien === "ia" ? IA : TU));
    // Al pie del último mensaje: "Qué hacer" y los botones.
    const pie: string[] = [];
    if (n.accion) pie.push(`**▶ Qué hacer:** ${n.accion}`);
    n.snippets.forEach((s, i) => pie.push(`[$(insert) Insertar \`${s.llamada.split(/\s/)[0]}\` aquí](${cmd("cai.nota.insertar", [uri, n.id, i])})`));
    if (!n.prediccion) pie.push(BOTONES.map((b) => `[${b.etiqueta}](${cmd("cai.nota.pedir", [uri, n.id, b.pedido])})`).join(" · "));
    pie.push(`[$(check) Resuelta](${cmd("cai.nota.resolver", [uri, n.id])})`);
    out.push(new Comentario(mdBotones(pie.join("\n\n"), ["cai.nota.pedir", "cai.nota.resolver", "cai.nota.insertar"]), IA, n.prediccion ? "Responde abajo lo que crees que devuelve" : "Pide más ayuda o escríbele abajo"));
    return out;
  }

  /** Busca la nota de un hilo (desde los menús del hilo) o por uri+id (desde los enlaces). */
  private ubicar(args: unknown[]): { doc: vscode.TextDocument; id?: string; thread?: vscode.CommentThread } | undefined {
    const [a, b] = args;
    if (a && typeof a === "object" && "uri" in a && "comments" in a) {
      const thread = a as vscode.CommentThread;
      const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === thread.uri.toString());
      const ref = this.idDe.get(thread);
      return doc ? { doc, thread, ...(ref ? { id: ref.id } : {}) } : undefined;
    }
    if (typeof a === "string" && typeof b === "string") {
      const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === a);
      return doc ? { doc, id: b, ...(this.hilos.get(a)?.get(b) ? { thread: this.hilos.get(a)!.get(b)! } : {}) } : undefined;
    }
    return undefined;
  }

  /**
   * Un pedido a la IA sobre una nota (o una nota nueva en una línea). Mientras piensa, el hilo
   * muestra "pensando…" y no acepta otro pedido.
   */
  async pedir(doc: vscode.TextDocument, o: { id?: string; linea?: number; pedido?: string; texto?: string; seleccion?: string; thread?: vscode.CommentThread; plantilla?: vscode.CommentThread }): Promise<void> {
    const cwd = root(doc);
    if (!cwd) return;
    let thread = o.thread ?? o.plantilla;
    const temporal = !o.thread;
    if (!thread) {
      const l = Math.max(0, (o.linea ?? 1) - 1);
      thread = this.controller.createCommentThread(doc.uri, new vscode.Range(l, 0, l, 0), []);
      thread.label = o.seleccion ? "Pregunta sobre la selección" : "Pregunta";
    }
    if (this.ocupados.has(thread)) return void vscode.window.showWarningMessage("ComplementAIry: ya estoy respondiendo en esta nota; espera a que termine.");
    this.ocupados.add(thread);
    const previos = thread.comments;
    const tuyo = o.texto ? [new Comentario(md(o.texto), TU)] : o.pedido ? [new Comentario(md(`Pedí: **${BOTONES.find((b) => b.pedido === o.pedido)?.etiqueta ?? o.pedido}**`), TU)] : [];
    thread.comments = [...previos.slice(0, Math.max(0, previos.length - (temporal ? 0 : 1))), ...tuyo, new Comentario(md("$(sync~spin) pensando…"), IA)];
    thread.canReply = false;
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    try {
      await guardar(doc); // la CLI lee el archivo del disco; en modo notas no lo modifica
      const out = await correr(
        [
          "responder",
          doc.uri.fsPath,
          ...(o.id ? ["--nota", o.id] : ["--linea", String(o.linea ?? 1)]),
          ...(o.pedido ? ["--pedido", o.pedido] : []),
          ...(o.texto ? ["--texto", o.texto] : []),
          ...(o.seleccion ? ["--seleccion", o.seleccion] : []),
          "--json",
        ],
        cwd,
      );
      const r = JSON.parse(out) as { nota?: Nota };
      if (r.nota) this.desplegar.add(r.nota.id);
    } catch (e) {
      thread.comments = previos;
      if (e instanceof OcupadoError) {
        // No se pierde lo que escribiste: se puede reintentar con el mismo texto.
        const { thread: _t, plantilla: _p, ...resto } = o;
        void vscode.window.showWarningMessage(`ComplementAIry: ${e.message}`, "Reintentar").then((v) => v && this.pedir(doc, temporal ? resto : o));
      } else mostrarError(e);
    } finally {
      this.ocupados.delete(thread);
      if (temporal) thread.dispose();
      else if (!doc.isClosed) thread.canReply = true;
      this.dibujar(doc);
    }
  }

  registrar(ctx: vscode.ExtensionContext): void {
    const reg = (id: string, fn: (...a: unknown[]) => unknown) => ctx.subscriptions.push(vscode.commands.registerCommand(id, fn));

    // Escribir en la caja del hilo (en una nota existente o en una línea nueva con el "+").
    reg("cai.nota.responder", async (...args) => {
      const reply = args[0] as vscode.CommentReply;
      const texto = reply.text.trim();
      if (!texto) return;
      const t = reply.thread;
      const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === t.uri.toString()) ?? (await vscode.workspace.openTextDocument(t.uri));
      const ref = this.idDe.get(t);
      if (ref) return this.pedir(doc, { id: ref.id, texto, thread: t });
      // Hilo nuevo creado por ti con el "+": se usa mientras piensa y lo reemplaza la nota que crea la CLI.
      const linea = (t.range?.start.line ?? 0) + 1;
      return this.pedir(doc, { linea, texto, plantilla: t });
    });
    reg("cai.nota.pedir", async (...args) => {
      const u = this.ubicar(args);
      const pedido = typeof args[2] === "string" ? args[2] : undefined;
      if (u?.id) await this.pedir(u.doc, { id: u.id, ...(pedido ? { pedido } : {}), ...(u.thread ? { thread: u.thread } : {}) });
    });
    for (const b of BOTONES)
      reg(`cai.nota.${b.pedido}`, async (...args) => {
        const u = this.ubicar(args);
        if (u?.id) await this.pedir(u.doc, { id: u.id, pedido: b.pedido, ...(u.thread ? { thread: u.thread } : {}) });
      });
    reg("cai.nota.resolver", async (...args) => {
      const u = this.ubicar(args);
      const cwd = u && root(u.doc);
      if (!u?.id || !cwd) return;
      try {
        await correr(["notas", "resolver", u.doc.uri.fsPath, u.id], cwd);
        this.dibujar(u.doc);
      } catch (e) {
        mostrarError(e);
      }
    });
    reg("cai.nota.insertar", async (...args) => {
      const u = this.ubicar(args);
      if (!u?.id) return;
      const n = this.notas(u.doc).find((x) => x.id === u.id);
      if (n) await this.insertar(u.doc, n, typeof args[2] === "number" ? args[2] : 0);
    });
    reg("cai.nota.abrir", async (...args) => {
      const [uri, id] = args as [string, string];
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
      const ed = await vscode.window.showTextDocument(doc, { preview: false });
      const n = this.notas(doc).find((x) => x.id === id);
      if (!n) return;
      const pos = new vscode.Position(Math.max(0, n.ancla.linea - 1), 0);
      ed.selection = new vscode.Selection(pos, pos);
      ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      // El hilo puede no existir todavía (archivo recién abierto): se crea ya desplegado.
      this.desplegar.add(id);
      this.dibujar(doc);
      const t = this.hilos.get(doc.uri.toString())?.get(id);
      if (t) t.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    });

    // Notas que cambian en disco (la CLI, el acompañante o el chat de Claude Code) → re-dibujar.
    const w = vscode.workspace.createFileSystemWatcher("**/{.cai,.aicode}/notas/*.json");
    const alCambiar = (u: vscode.Uri) => {
      for (const doc of vscode.workspace.textDocuments) {
        const cwd = root(doc);
        if (cwd && archivoNotas(cwd, relDe(cwd, doc.uri.fsPath)) === u.fsPath) this.programar(doc, 150);
      }
    };
    w.onDidChange(alCambiar);
    w.onDidCreate(alCambiar);
    w.onDidDelete(alCambiar);

    ctx.subscriptions.push(
      w,
      this,
      vscode.languages.registerHoverProvider({ scheme: "file" }, this),
      vscode.workspace.onDidOpenTextDocument((d) => d.uri.scheme === "file" && this.programar(d, 50)),
      vscode.workspace.onDidChangeTextDocument((e) => e.document.uri.scheme === "file" && e.contentChanges.length && this.programar(e.document, 400)),
      vscode.workspace.onDidCloseTextDocument((d) => this.cerrar(d)),
      vscode.window.onDidChangeActiveTextEditor((ed) => ed && this.avisar(ed.document)),
      vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration("cai.vista") && vscode.workspace.textDocuments.forEach((d) => this.dibujar(d))),
    );
    for (const d of vscode.workspace.textDocuments) this.dibujar(d);
    if (vscode.window.activeTextEditor) this.avisar(vscode.window.activeTextEditor.document);
  }

  /** Al abrir un archivo con notas: un aviso breve en la barra (una vez por sesión y archivo). */
  private avisar(doc: vscode.TextDocument): void {
    const k = doc.uri.toString();
    if (this.avisados.has(k)) return;
    const notas = this.notas(doc);
    if (!notas.length) return;
    this.avisados.add(k);
    const primera = [...notas].sort((a, b) => Number(b.bloqueante) - Number(a.bloqueante) || a.ancla.linea - b.ancla.linea)[0]!;
    vscode.window.setStatusBarMessage(`$(comment) ${notas.length} nota(s) aquí · siguiente: ${primera.accion || primera.titulo} (línea ${primera.ancla.linea})`, 10_000);
  }

  provideHover(doc: vscode.TextDocument, pos: vscode.Position): vscode.Hover | undefined {
    const notas = this.notas(doc).filter((n) => n.ancla.linea - 1 === pos.line);
    if (!notas.length) return undefined;
    const m = mdBotones(
      notas
        .map((n) => `${ICONO[n.tipo] ?? "📝"} **${n.titulo}**${n.accion ? `  \n▶ ${n.accion}` : ""}  \n[Abrir la nota](${cmd("cai.nota.abrir", [doc.uri.toString(), n.id])})`)
        .join("\n\n---\n\n"),
      ["cai.nota.abrir"],
    );
    return new vscode.Hover(m);
  }

  private cerrar(doc: vscode.TextDocument): void {
    const k = doc.uri.toString();
    for (const t of this.hilos.get(k)?.values() ?? []) t.dispose();
    this.hilos.delete(k);
    this.diagnosticos.delete(doc.uri);
  }

  dispose(): void {
    this.controller.dispose();
    this.diagnosticos.dispose();
    this.cambio.dispose();
  }
}
