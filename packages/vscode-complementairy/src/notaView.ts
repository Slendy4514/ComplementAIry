import fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import { argumentosDe, armarLlamada, guardar, claveDeSimbolo, correr, esModo, esperadoLiteral, parametrosDe, valorDeCampo, guiaActual, leerConfig, leerDecisiones, leerPropuesta, modoDe, modoEfectivo, MODOS, mostrarError, notasDe, relDe, root, vista, type Nota } from "./comun";
import { resaltarDestino } from "./acciones";
import { BOTONES, ESTADO, ICONO, type NotasView } from "./notasView";

/**
 * Panel "Nota": sigue al cursor y muestra la nota de la función donde estás (o la del archivo),
 * con su estado, el "Qué hacer", los botones y una caja para conversar. Nada se abre dentro del
 * código ni te quita el foco. Al elegir una tarea o una pregunta en el panel lateral, muestra su
 * detalle completo (y en las preguntas, puedes conversar con la IA antes de responder).
 */

interface Tarea {
  id: string;
  titulo: string;
  archivo?: string;
  crear?: boolean;
  detalle?: string;
  origen?: string;
  hecha: boolean;
}

interface Pregunta {
  n: number;
  pregunta: string;
  sugerencia: string;
  dialogo?: { quien: "tu" | "ia"; texto: string }[];
}

type Modo =
  | { tipo: "vacio" }
  | { tipo: "funcion"; uri: string; funcion?: string; linea: number; notaId?: string }
  | { tipo: "tarea"; tarea: Tarea }
  | { tipo: "pregunta"; pregunta: Pregunta };

const FUNCIONES = new Set([vscode.SymbolKind.Function, vscode.SymbolKind.Method, vscode.SymbolKind.Constructor]);

/** Las funciones (símbolos) del documento, aplanadas. */
export async function funcionesDe(doc: vscode.TextDocument): Promise<vscode.DocumentSymbol[]> {
  const simbolos = (await vscode.commands.executeCommand<vscode.DocumentSymbol[] | undefined>("vscode.executeDocumentSymbolProvider", doc.uri)) ?? [];
  const out: vscode.DocumentSymbol[] = [];
  const walk = (ss: vscode.DocumentSymbol[]) => {
    for (const s of ss) {
      if (FUNCIONES.has(s.kind)) out.push(s);
      walk(s.children);
    }
  };
  walk(simbolos);
  return out;
}

/** La función más interna que contiene la posición, con su clave de nota ("nombre" o "nombre#k"). */
export async function funcionEn(doc: vscode.TextDocument, pos: vscode.Position): Promise<(vscode.DocumentSymbol & { clave: string }) | undefined> {
  const fs = await funcionesDe(doc);
  const dentro = fs.filter((s) => s.range.contains(pos)).sort((a, b) => a.range.end.line - a.range.start.line - (b.range.end.line - b.range.start.line))[0];
  return dentro ? Object.assign(dentro, { clave: claveDeSimbolo(fs, dentro) }) : undefined;
}

const PERMITIDAS = new Set(["p", "br", "ul", "ol", "li", "strong", "b", "em", "i", "code", "pre", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "a", "table", "thead", "tbody", "tr", "th", "td", "del", "span"]);

/** Deja solo etiquetas de texto, sin atributos (los enlaces conservan un href http/https). */
export function sanear(html: string): string {
  return html
    .replace(/<(script|style|iframe|object|embed|svg|math|template|textarea|select|button|form|input|img|video|audio|link|meta)\b[\s\S]*?(<\/\1\s*>|\/?>)/gi, "")
    .replace(/<\/?([a-zA-Z0-9]+)([^>]*)>/g, (todo, tag: string, attrs: string) => {
      const t = tag.toLowerCase();
      if (!PERMITIDAS.has(t)) return "";
      if (todo.startsWith("</")) return `</${t}>`;
      if (t === "a") {
        const href = /href\s*=\s*"(https?:\/\/[^"]*)"/i.exec(attrs)?.[1];
        return href ? `<a href="${href.replace(/"/g, "%22")}">` : "<a>";
      }
      return `<${t}>`;
    });
}

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export class NotaPanel implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private modo: Modo = { tipo: "vacio" };
  /** Elegido desde el panel lateral: se mantiene hasta que muevas el cursor a otra función. */
  private fijo = false;
  private timer?: NodeJS.Timeout;
  private pensando = new Set<string>();
  /** Lo que la IA va escribiendo (en vivo) para la nota que se ve. */
  private vivo = "";

  constructor(private readonly notas: NotasView) {}

  resolveWebviewView(v: vscode.WebviewView): void {
    this.view = v;
    v.webview.options = { enableScripts: true };
    v.webview.html = this.esqueleto(v.webview);
    v.webview.onDidReceiveMessage((m: { cmd: string; arg?: unknown }) => void this.recibir(m).catch(mostrarError));
    v.onDidChangeVisibility(() => v.visible && void this.render());
    void this.seguir(true);
  }

  registrar(ctx: vscode.ExtensionContext): void {
    ctx.subscriptions.push(
      vscode.window.registerWebviewViewProvider("cai.nota", this, { webviewOptions: { retainContextWhenHidden: true } }),
      vscode.window.onDidChangeTextEditorSelection((e) => e.textEditor.document.uri.scheme === "file" && this.programar()),
      vscode.window.onDidChangeActiveTextEditor(() => this.programar()),
      this.notas.onCambio(() => void this.render()),
      // Propuestas del modo programar (también las que pide Claude Code): se ven al instante.
      ...(() => {
        const w = vscode.workspace.createFileSystemWatcher("**/{.cai,.aicode}/cache/propuestas/*.json");
        return [w, w.onDidChange(() => void this.render()), w.onDidCreate(() => void this.render()), w.onDidDelete(() => void this.render())];
      })(),
      ...this.vigilarEnVivo(),
      this.notas.onPensando((p) => {
        const k = `${p.uri}#${p.id ?? "nueva"}`;
        if (p.activo) this.pensando.add(k);
        else {
          this.pensando.delete(k);
          this.vivo = "";
        }
        void this.render();
      }),
      vscode.commands.registerCommand("cai.notaPanel.mostrar", async (uri: string, id: string, o?: { silencioso?: boolean }) => {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
        const cwd = root(doc);
        const n = ((cwd && notasDe(cwd, doc, true)) || []).find((x) => x.id === id);
        // Una respuesta que llega sola no abre ni enfoca nada: si el panel no está a la vista, solo avisa.
        if (o?.silencioso && !this.view?.visible) {
          vscode.window.setStatusBarMessage(`ComplementAIry: respondí en la nota de ${n?.ancla.funcion?.replace(/#\d+$/, "") ?? "este archivo"} (panel Nota)`, 8000);
          return;
        }
        this.fijo = true;
        this.modo = { tipo: "funcion", uri, ...(n?.ancla.funcion && n.alcance !== "archivo" ? { funcion: n.ancla.funcion } : {}), linea: n?.ancla.linea ?? 1, ...(n ? { notaId: n.id } : {}) };
        if (o?.silencioso) await this.render();
        else await this.enfocar();
      }),
      vscode.commands.registerCommand("cai.notaPanel.tarea", async (t: Tarea) => {
        this.fijo = true;
        this.modo = { tipo: "tarea", tarea: t };
        await this.enfocar();
      }),
      vscode.commands.registerCommand("cai.notaPanel.pregunta", async (q: Pregunta) => {
        this.fijo = true;
        this.modo = { tipo: "pregunta", pregunta: q };
        await this.enfocar();
      }),
    );
  }

  /** Muestra el panel SIN quitarle el foco al editor (si ya existe); la primera vez hay que abrirlo. */
  /** La respuesta se ve MIENTRAS se escribe: la CLI deja el texto parcial en .cai/cache/en-vivo/. */
  private vigilarEnVivo(): vscode.Disposable[] {
    const w = vscode.workspace.createFileSystemWatcher("**/{.cai,.aicode}/cache/en-vivo/*.txt");
    let ultimo = 0;
    const leer = (u: vscode.Uri, borrado = false) => {
      const { doc, nota } = this.notaActual();
      const cwd = doc && root(doc);
      if (!doc || !cwd || !nota) return;
      if (path.basename(u.fsPath) !== `${encodeURIComponent(relDe(cwd, doc.uri.fsPath))}#${nota.id}.txt`) return;
      this.vivo = borrado ? "" : (() => {
        try {
          return fs.readFileSync(u.fsPath, "utf8");
        } catch {
          return "";
        }
      })();
      if (Date.now() - ultimo > 200 || borrado) {
        ultimo = Date.now();
        void this.render();
      }
    };
    w.onDidCreate((u) => leer(u));
    w.onDidChange((u) => leer(u));
    w.onDidDelete((u) => leer(u, true));
    return [w];
  }

  private async enfocar(): Promise<void> {
    if (this.view) this.view.show(true);
    else await vscode.commands.executeCommand("cai.nota.focus");
    await this.render();
  }

  private programar(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.seguir(false), 300);
  }

  /** Sigue al cursor: la función donde está (o el archivo). Un detalle elegido se suelta al moverte de función. */
  private async seguir(inicial: boolean): Promise<void> {
    const ed = vscode.window.activeTextEditor;
    if (!ed || ed.document.uri.scheme !== "file") return;
    const cwd = root(ed.document);
    if (!cwd || vista(cwd) !== "notas") return;
    const f = await funcionEn(ed.document, ed.selection.active);
    const nuevo: Modo = { tipo: "funcion", uri: ed.document.uri.toString(), ...(f ? { funcion: f.clave } : {}), linea: (f ? f.selectionRange.start.line : ed.selection.active.line) + 1 };
    const mismo = this.modo.tipo === "funcion" && nuevo.tipo === "funcion" && this.modo.uri === nuevo.uri && this.modo.funcion === nuevo.funcion;
    if (this.fijo && !inicial) {
      if (mismo) return; // sigues en lo que elegiste
      this.fijo = false; // te moviste a otra función: el panel vuelve a seguir al cursor
    }
    if (mismo && !inicial) return;
    this.modo = nuevo;
    await this.render();
  }

  private notaActual(): { doc?: vscode.TextDocument; nota?: Nota } {
    if (this.modo.tipo !== "funcion") return {};
    const m = this.modo;
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === m.uri);
    if (!doc) return {};
    const cwd = root(doc);
    const todas = (cwd && notasDe(cwd, doc, true)) || [];
    const abiertas = todas.filter((n) => n.estado === "abierta");
    const deEsta = (n: Nota) => (m.funcion ? n.ancla.funcion === m.funcion && n.alcance !== "archivo" : n.alcance === "archivo");
    // La abierta; si no hay, la última cerrada (para ver que quedó "🟢 lista").
    const nota =
      (m.notaId ? todas.find((n) => n.id === m.notaId) : undefined) ??
      abiertas.find(deEsta) ??
      todas.filter((n) => deEsta(n) && !n.prediccion).sort((a, b) => b.actualizada.localeCompare(a.actualizada))[0];
    return { doc, ...(nota ? { nota } : {}) };
  }

  // --- Acciones del panel ------------------------------------------------------------------

  private async recibir(m: { cmd: string; arg?: unknown }): Promise<void> {
    const arg = m.arg;
    if (m.cmd === "link" && typeof arg === "string") {
      if (/^https?:/.test(arg)) await vscode.env.openExternal(vscode.Uri.parse(arg));
      return;
    }
    if (this.modo.tipo === "funcion") {
      const { doc, nota } = this.notaActual();
      if (!doc) return;
      const modo = this.modo;
      const base = nota ? { id: nota.id } : modo.funcion ? { linea: modo.linea } : { archivoEntero: true };
      switch (m.cmd) {
        case "pedir":
          if (arg === "plano") return void vscode.commands.executeCommand("cai.plano", doc.uri);
          return this.notas.pedir(doc, { ...base, pedido: String(arg) });
        case "texto":
          if (typeof arg === "string" && arg.trim()) return this.notas.pedir(doc, { ...base, texto: arg.trim() });
          return;
        case "verificar":
          // Botón: con "otra mirada" (plan pensado sin ver tu código), contra el sesgo de lo ya hecho.
          if (modo.funcion) return this.notas.verificar(doc, modo.funcion, nota?.id, { independiente: true });
          return void vscode.commands.executeCommand("cai.revisar");
        case "verificarExplicando":
          // Modo aprender: tu explicación con tus palabras se compara con lo que el código hace.
          if (modo.funcion && typeof arg === "string" && arg.trim()) return this.notas.verificar(doc, modo.funcion, nota?.id, { independiente: true, explicacion: arg.trim() });
          return;
        case "resaltar":
          return resaltarDestino(doc, nota, arg === "" || arg === undefined ? null : Number(arg));
        case "predecir":
          await vscode.window.showTextDocument(doc, { preview: false });
          return void vscode.commands.executeCommand("cai.predecir");
        case "decidir": {
          const cwd = root(doc);
          if (!cwd || typeof arg !== "string") return;
          const sep = arg.indexOf("::");
          const id = arg.slice(0, sep);
          const opcion = arg.slice(sep + 2);
          await correr(["decisiones", "decidir", id, opcion], cwd);
          vscode.window.setStatusBarMessage(`ComplementAIry: decidido "${opcion}" (la IA lo respeta; puedes retractarlo)`, 6000);
          void vscode.commands.executeCommand("cai.panel.refrescar");
          return void this.render();
        }
        case "decidirOtra": {
          const cwd = root(doc);
          if (!cwd || typeof arg !== "string") return;
          const texto = await vscode.window.showInputBox({ prompt: "¿Qué decides? (con tus palabras)" });
          if (!texto?.trim()) return;
          await correr(["decisiones", "decidir", arg, texto.trim()], cwd);
          void vscode.commands.executeCommand("cai.panel.refrescar");
          return void this.render();
        }
        case "modoEje": {
          // "escribe:ia" / "ayuda:aprender" cambian un eje y conservan el otro; "heredar" quita el modo propio.
          const cwd = root(doc);
          if (!cwd || typeof arg !== "string") return;
          const ef = modoEfectivo(leerConfig(cwd), relDe(cwd, doc.uri.fsPath), modo.funcion);
          const [eje, valor] = arg.split(":");
          const nuevo = arg === "heredar" ? "heredar" : eje === "escribe" ? modoDe(valor === "ia" ? "ia" : "manual", ef.c.ayuda) : modoDe(ef.c.escribe, valor === "aprender" ? "aprender" : "sugerir");
          return this.recibir({ cmd: "modo", arg: nuevo });
        }
        case "modo": {
          const cwd = root(doc);
          if (!cwd || typeof arg !== "string") return;
          const rel = relDe(cwd, doc.uri.fsPath);
          const objetivo = modo.funcion ? ["--funcion", `${rel}:${modo.funcion}`] : ["--archivo", rel];
          await correr(["modo", arg, ...objetivo], cwd);
          vscode.window.setStatusBarMessage(`ComplementAIry: ${modo.funcion ? modo.funcion.replace(/#\d+$/, "") : "este archivo"} → ${arg === "heredar" ? "modo heredado" : `modo ${arg}`} (lo ya hecho no cambia)`, 6000);
          this.notas.dibujar(doc);
          void vscode.commands.executeCommand("cai.estado.actualizarModo");
          return void this.render();
        }
        case "insertar":
          if (nota) return void vscode.commands.executeCommand("cai.nota.insertar", doc.uri.toString(), nota.id, Number(arg));
          return;
        case "objetivo":
        case "entender":
        case "plan":
        case "editarPlan":
        case "paso":
        case "contrato":
        case "pr":
        case "adaptar":
        case "probar":
        case "insertarPropuesta":
        case "descartarPropuesta":
        case "diffPropuesta":
        case "construir":
        case "otra":
        case "idea":
        case "orden":
        case "rehacer":
        case "deshacer":
        case "ajuste":
        case "quitar":
        case "dejar":
        case "dejarSugerencia":
        case "ordenSugerencia":
        case "quitarPrevio":
        case "pedir":
        case "pedirUna":
        case "pedirPendiente":
        case "pedirIdeal":
        case "separar":
        case "crearAuxiliares":
        case "auditar":
        case "verIdeal":
        case "guardarPlan":
        case "probarPorcion":
        case "casos":
        case "caso":
        case "predecirFuncion":
        case "verBorrador":
          return this.programarAccion(m.cmd, arg, doc, nota);
        case "resolver":
          if (nota) await vscode.commands.executeCommand("cai.nota.resolver", doc.uri.toString(), nota.id);
          return;
        case "verNota": {
          // Ir a la otra función: el panel sigue al cursor y muestra SU nota.
          const cwd = root(doc);
          if (!cwd || typeof arg !== "string" || !arg.includes("::")) return;
          const [archivo, funcion] = [arg.slice(0, arg.indexOf("::")), arg.slice(arg.indexOf("::") + 2)];
          const otro = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(cwd, archivo)));
          const ed = await vscode.window.showTextDocument(otro, { preview: false });
          const simbolos = await funcionesDe(otro);
          const s = simbolos.find((x) => claveDeSimbolo(simbolos, x) === funcion);
          if (s) {
            ed.selection = new vscode.Selection(s.selectionRange.start, s.selectionRange.start);
            ed.revealRange(s.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
          }
          return;
        }
        case "ir": {
          const ed = await vscode.window.showTextDocument(doc, { preview: false });
          const pos = new vscode.Position(Math.max(0, (nota?.ancla.linea ?? modo.linea) - 1), 0);
          ed.selection = new vscode.Selection(pos, pos);
          ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
          return;
        }
      }
      return;
    }
    const cwd = root(vscode.window.activeTextEditor?.document);
    if (!cwd) return;
    if (this.modo.tipo === "tarea") {
      const t = this.modo.tarea;
      if (m.cmd === "ir") return void vscode.commands.executeCommand("cai.irA", cwd, t.archivo, undefined, undefined, !!t.crear);
      if (m.cmd === "hecha" || m.cmd === "descartar") {
        await correr(["tareas", m.cmd, t.id], cwd);
        this.modo = { tipo: "vacio" };
        this.fijo = false;
        await this.render();
        void vscode.commands.executeCommand("cai.panel.refrescar");
      }
      return;
    }
    if (this.modo.tipo === "pregunta") {
      const q = this.modo.pregunta;
      // El número puede haber cambiado (otra se respondió antes): se busca por el texto.
      const actuales = (JSON.parse(await correr(["memoria", "--json"], cwd, { silencioso: true })) as { abiertas: Pregunta[] }).abiertas;
      const actual = actuales.find((x) => x.pregunta === q.pregunta);
      if (!actual) return void vscode.window.showWarningMessage("ComplementAIry: esa pregunta ya no está abierta.");
      if (m.cmd === "responder" && typeof arg === "string" && arg.trim()) {
        await correr(["memoria", "responder", String(actual.n), arg.trim()], cwd);
        vscode.window.setStatusBarMessage("ComplementAIry: anotado en la memoria del proyecto ✓", 5000);
        this.modo = { tipo: "vacio" };
        this.fijo = false;
        await this.render();
        void vscode.commands.executeCommand("cai.panel.refrescar");
      } else if (m.cmd === "conversar" && typeof arg === "string" && arg.trim()) {
        this.pensando.add("pregunta");
        await this.render();
        try {
          const r = JSON.parse(await correr(["memoria", "conversar", String(actual.n), "--texto", arg.trim(), "--json"], cwd)) as { hilo: Pregunta["dialogo"] };
          this.modo = { tipo: "pregunta", pregunta: { ...actual, dialogo: r.hilo ?? [] } };
        } finally {
          this.pensando.delete("pregunta");
          await this.render();
        }
      }
    }
  }

  // --- Dibujo --------------------------------------------------------------------------------

  private esqueleto(w: vscode.Webview): string {
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${w.cspSource} 'unsafe-inline'; img-src ${w.cspSource} data:; script-src 'nonce-${nonce}';">
<style>
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);padding:0 10px 10px;line-height:1.45}
h2{font-size:1.1em;margin:10px 0 2px}
.sub{color:var(--vscode-descriptionForeground);font-size:.9em;margin-bottom:8px}
.estado{display:inline-block;padding:1px 8px;border-radius:10px;font-size:.85em;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);margin-left:6px}
.accion{border-left:3px solid var(--vscode-focusBorder);padding:6px 8px;margin:8px 0;background:var(--vscode-textBlockQuote-background)}
.botones{display:flex;flex-wrap:wrap;gap:4px;margin:8px 0}
button{font:inherit;border:1px solid var(--vscode-button-border,transparent);background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border-radius:3px;padding:3px 8px;cursor:pointer}
button.prim{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
button:hover{filter:brightness(1.15)}button:disabled{opacity:.5;cursor:default}
.msg{border-top:1px solid var(--vscode-widget-border,rgba(128,128,128,.25));padding:6px 0}
.quien{font-size:.8em;color:var(--vscode-descriptionForeground)}
.msg p{margin:4px 0}.msg ul{margin:4px 0;padding-left:18px}
.pensando{margin:8px 0;color:var(--vscode-descriptionForeground)}
.vacio{color:var(--vscode-descriptionForeground);margin-top:12px}
details summary{cursor:pointer;color:var(--vscode-descriptionForeground);margin:6px 0}
.ultimo{border-left:3px solid var(--vscode-focusBorder);padding:2px 8px;margin:8px 0}
.historial{margin-top:10px;border-top:1px solid var(--vscode-widget-border,rgba(128,128,128,.25));padding-top:4px}
details.turno>summary{display:flex;justify-content:space-between;gap:8px;color:var(--vscode-foreground);margin:3px 0}
details.turno>summary span.quien{white-space:nowrap}
#caja{position:sticky;bottom:0;background:var(--vscode-sideBar-background);padding-top:6px}
select{font:inherit;color:var(--vscode-dropdown-foreground);background:var(--vscode-dropdown-background);border:1px solid var(--vscode-dropdown-border,transparent)}
textarea{width:100%;box-sizing:border-box;min-height:52px;resize:vertical;font:inherit;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,transparent);padding:4px}
.fila{display:flex;gap:4px;justify-content:flex-end;margin-top:4px}
code{font-family:var(--vscode-editor-font-family)}
.pasos{margin:6px 0;font-size:.9em}.pasos .ok{color:var(--vscode-testing-iconPassed,#3fb950)}.pasos .activa{font-weight:bold}.pasos .pend{color:var(--vscode-descriptionForeground)}
.aviso{border-left:3px solid var(--vscode-editorWarning-foreground,#d29922);padding:4px 8px;margin:6px 0}
.oferta{border-left:3px solid var(--vscode-textLink-foreground);padding:4px 8px;margin:6px 0}.oferta ul{margin:4px 0;padding-left:18px}.chips{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0}.chip{padding:1px 8px;border-radius:10px;font-size:.9em}.chip.actual{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
.params{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0}.param{display:inline-flex;gap:4px;align-items:center;font-family:var(--vscode-editor-font-family)}
.pagina{margin-top:6px}.titulo-paso{margin-bottom:4px}.nav{display:flex;justify-content:space-between;margin-top:8px}.navb.prim{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}.pie{margin-top:8px}
.porcion{margin:6px 0}.porcion.actual{border:1px solid var(--vscode-focusBorder);border-radius:4px;padding:6px 8px}
.plan li.hecho{color:var(--vscode-descriptionForeground);text-decoration:line-through}
.probar,.explicar{margin:6px 0}
input{font:inherit;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,transparent);padding:2px 4px;max-width:100%}
table.casos{border-collapse:collapse;width:100%;margin:6px 0}table.casos td,table.casos th{border-bottom:1px solid var(--vscode-widget-border,rgba(128,128,128,.25));padding:3px 4px;text-align:left;vertical-align:top}
</style></head><body>
<div id="contenido"><p class="vacio">Pon el cursor en una función para ver su nota.</p></div>
<div id="caja" hidden><textarea id="texto" placeholder=""></textarea><div class="fila" id="acciones"></div></div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const caja = document.getElementById("caja"), texto = document.getElementById("texto"), acciones = document.getElementById("acciones");
let principal = null;
// Lo que escribes en los campos del panel (data-guardar) sobrevive a cada redibujo, por función.
let clave = "";
const guardados = (vscode.getState() && vscode.getState().guardados) || {};
const recordar = () => { try { vscode.setState({ guardados }); } catch (_) {} };
window.addEventListener("message", (e) => {
  const d = e.data;
  document.getElementById("contenido").innerHTML = d.html;
  clave = d.clave || "";
  document.querySelectorAll("[data-guardar]").forEach((el) => { const v = guardados[clave + "|" + el.id]; if (v !== undefined && v !== "") el.value = v; });
  // Construir juntos: una página a la vez. Se abre la que pide atención (data-inicial) cuando cambia;
  // si no, la que estabas mirando.
  const cj = document.querySelector(".cj");
  if (cj) {
    const ini = cj.dataset.inicial, kIni = clave + "|inicial", kPag = clave + "|pagina";
    let id = guardados[kPag];
    if (guardados[kIni] !== ini || !cj.querySelector('.pagina[data-pagina="' + id + '"]')) { id = ini; guardados[kIni] = ini; }
    mostrarPagina(cj, id, false);
  }
  caja.hidden = !d.caja;
  if (d.caja) {
    texto.placeholder = d.caja.placeholder;
    texto.disabled = !!d.caja.ocupado;
    acciones.innerHTML = d.caja.botones.map((b, i) => '<button data-envio="' + b.cmd + '"' + (i === 0 ? ' class="prim"' : '') + (d.caja.ocupado ? ' disabled' : '') + '>' + b.texto + '</button>').join("");
    principal = d.caja.botones[0] && d.caja.botones[0].cmd;
    if (d.caja.limpiar) texto.value = "";
  }
});
function mostrarPagina(cj, id, desplazar) {
  if (!cj.querySelector('.pagina[data-pagina="' + id + '"]')) return;
  cj.querySelectorAll(".pagina").forEach((p) => { p.hidden = p.dataset.pagina !== id; });
  cj.querySelectorAll(".chip").forEach((c) => c.classList.toggle("actual", c.dataset.pagina === id));
  guardados[clave + "|pagina"] = id; recordar();
  if (desplazar) cj.scrollIntoView({ block: "start", behavior: "smooth" });
}
document.addEventListener("click", (e) => {
  const pg = e.target.closest("button[data-pagina]");
  if (pg && pg.closest(".cj")) { mostrarPagina(pg.closest(".cj"), pg.dataset.pagina, true); return; }
  const b = e.target.closest("[data-cmd]");
  if (b && !b.disabled && !b.closest(".msg, .md")) {
    if (b.dataset.campos) {
      // Botón con campos: viajan con el clic y, una vez enviados, se limpian.
      const campos = {};
      for (const id of b.dataset.campos.split(",")) { const el = document.getElementById(id); campos[id] = el ? el.value : ""; delete guardados[clave + "|" + id]; }
      recordar();
      vscode.postMessage({ cmd: b.dataset.cmd, arg: JSON.stringify({ arg: b.dataset.arg, campos }) });
    } else vscode.postMessage({ cmd: b.dataset.cmd, arg: b.dataset.arg });
    return;
  }
  const env = e.target.closest("[data-envio]");
  if (env && !env.disabled && texto.value.trim()) { vscode.postMessage({ cmd: env.dataset.envio, arg: texto.value }); texto.value = ""; return; }
  const a = e.target.closest("a[href]");
  if (a) { e.preventDefault(); vscode.postMessage({ cmd: "link", arg: a.getAttribute("href") }); }
});
document.addEventListener("mouseover", (e) => {
  const b = e.target.closest("[data-cmd=insertar]");
  if (b) vscode.postMessage({ cmd: "resaltar", arg: b.dataset.arg });
});
document.addEventListener("mouseout", (e) => {
  if (e.target.closest("[data-cmd=insertar]")) vscode.postMessage({ cmd: "resaltar", arg: "" });
});
document.addEventListener("change", (e) => {
  const s = e.target.closest("select[data-cmd]");
  if (s) vscode.postMessage({ cmd: s.dataset.cmd, arg: s.value });
});
document.addEventListener("input", (e) => {
  const el = e.target.closest("[data-guardar]");
  if (el) { guardados[clave + "|" + el.id] = el.value; recordar(); }
});
document.addEventListener("keydown", (e) => {
  const el = e.target.closest("[data-enter]");
  if (el && e.key === "Enter") { e.preventDefault(); const b = document.getElementById(el.dataset.enter); if (b) b.click(); }
});
texto.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && principal && texto.value.trim()) { e.preventDefault(); vscode.postMessage({ cmd: principal, arg: texto.value }); texto.value = ""; }
});
</script></body></html>`;
  }

  // --- Modo programar y objetivo (todo pasa por la CLI; el código entra a tu archivo SOLO aquí, con tu clic) ---

  private bloqueProgramar(cwd: string, rel: string, funcion: string, nota: Nota | undefined, ocupado: boolean): string {
    const previa = leerPropuesta(cwd, rel, funcion);
    // Construir juntos: en programar, por pedidos (la función entera); en programar · aprender, por pasos.
    // Las propuestas de antes (paso dirigido, PR) se siguen mostrando.
    if (!previa || previa.tipo === "construir") {
      const porPasos = modoEfectivo(leerConfig(cwd), rel, funcion).c.decidirAntes || (previa?.construir?.forma !== "pedido" && !!previa?.porciones?.some((x) => !x.tipo));
      return porPasos ? this.bloqueConstruir(cwd, rel, funcion, nota, ocupado) : this.bloquePedido(cwd, rel, funcion, nota, ocupado);
    }
    const nombre = funcion.replace(/#\d+$/, "");
    const off = { off: ocupado };
    let h = `<div class="accion"><b>🧭 Modo programar</b> <span class="quien">la IA escribe por pasos que diriges tú (o como un PR por porciones); entra a tu archivo solo con tu clic</span>`;
    // Plan (3-5 pasos por idea).
    if (nota?.plan) {
      h += `<ol>${nota.plan.pasos.map((p) => `<li>${p.hecho ? "✓ " : ""}${esc(p.texto)}${p.repertorio ? ` <span class="quien">(ya lo hiciste: ${esc(p.repertorio)})</span>` : ""}</li>`).join("")}</ol>`;
      if (nota.plan.separar) h += `<div class="quien">Separa <code>${esc(nota.plan.separar.nombre)}</code> (${esc(nota.plan.separar.proposito)}): quedó como tarea y se trabaja en su propia nota.</div>`;
    }
    const reps = [...new Set((nota?.plan?.pasos ?? []).flatMap((p) => (p.repertorio ? [p.repertorio] : [])))];
    h += `<div class="botones">${nota?.plan ? this.boton("editarPlan", "✎ Editar plan", undefined, off) : this.boton("plan", "🧭 Plan de pasos", undefined, { prim: true, off: ocupado })}${this.boton("contrato", nota?.contrato?.length ? `📋 Mis casos (${nota.contrato.length})` : "📋 Definir mis casos", undefined, off)}${nota?.contrato?.length ? this.boton("pr", "📦 Propuesta como PR", undefined, off) : ""}${reps.map((id) => this.boton("adaptar", `📚 Usar mi versión (${esc(id)})`, id, off)).join("")}</div>`;
    if (nota?.contrato?.length) h += `<div class="quien">Tus casos: ${nota.contrato.map((c) => `<code>${esc(c.llamada)}</code> → <code>${esc(c.esperado)}</code>`).join(" · ")}</div>`;
    if (nota?.programada) h += `<div class="quien">Insertada desde una propuesta (${esc(nota.programada.tipo)}): ${nota.programada.pruebas} prueba(s), ${nota.programada.aciertosPrimera}/${nota.programada.porciones} a la primera${nota.programada.sinProbar ? ` · ⚠ ${nota.programada.sinProbar} sin probar (deuda de comprensión)` : ""}</div>`;
    h += "</div>";
    // La propuesta en preparación.
    const p = leerPropuesta(cwd, rel, funcion);
    if (!p) return h;
    if (p.tipo === "dirigido") {
      h += `<div class="accion"><b>Propuesta para el paso ${p.paso ?? ""}</b> <span class="quien">"${esc(p.instruccion ?? "")}"</span>${p.falta ? `<div>⚠ <b>Tu paso no dice:</b> ${esc(p.falta)} <span class="quien">(no lo completé; corrige tu paso si hace falta)</span></div>` : ""}<div>${esc(p.explicacion ?? "")}</div><pre><code>${esc(p.codigo)}</code></pre><div class="quien">Irá ${p.linea ? `después de la línea ${p.linea}` : "donde elijas"}.</div><div class="botones">${this.boton("insertarPropuesta", "⤵ Insertar", p.fecha, { prim: true, off: ocupado })}${this.boton("descartarPropuesta", "Así no: corrijo mi paso", undefined, off)}</div></div>`;
      return h;
    }
    const ps = p.porciones ?? [];
    const okCasos = p.contrato?.filter((c) => c.pasa).length ?? 0;
    const lineas = p.codigo.split("\n");
    const actual = ps.findIndex((x) => !x.aprobada);
    h += `<div class="accion"><b>📦 Propuesta${p.tipo === "adaptada" ? ` (tu versión de ${esc(p.original?.proyecto ?? "")}, adaptada)` : ""}</b> · contra tus casos: ${okCasos}/${p.contrato?.length ?? 0} ✓${p.contrato?.some((c) => !c.pasa) ? `<div>✗ ${p.contrato.filter((c) => !c.pasa).map((c) => `<code>${esc(c.llamada)}</code> esperabas ${esc(c.esperado)}, da ${esc(c.obtenido)}`).join("; ")}</div>` : ""}`;
    if (p.tipo === "adaptada") h += `${p.cambios?.length ? `<ul>${p.cambios.map((c) => `<li>${esc(c.que)} <span class="quien">— ${esc(c.porque)}</span></li>`).join("")}</ul>` : ""}${this.boton("diffPropuesta", "Ver diff con tu versión", undefined, off)}`;
    ps.forEach((x, k) => {
      const codigo = lineas.slice(x.desde - 1, x.hasta).join("\n");
      const pruebas = x.pruebas.map((y) => `<div class="quien">${!y.toca ? "↷ no recorre esta porción" : y.acierto ? "✓" : "✗"} <code>${esc(y.entrada)}</code> esperabas <code>${esc(y.espero)}</code>, da <code>${esc(y.obtenido.slice(0, 80))}</code>${y.explicacion ? ` — ${esc(y.explicacion)}` : ""}</div>`).join("");
      if (x.aprobada) h += `<details><summary>✓ Porción ${k + 1} (líneas ${x.desde}-${x.hasta})</summary><pre><code>${esc(codigo)}</code></pre>${pruebas}</details>`;
      else if (k === actual) h += `<div><b>Porción ${k + 1} de ${ps.length}</b> <span class="quien">${esc(x.porque)}</span><pre><code>${esc(codigo)}</code></pre>${pruebas}<div class="quien">Pruébala con TU entrada (tiene que pasar por estas líneas) y lo que esperas, antes de ver el resultado.</div>${this.boton("probar", "🔬 Probar esta porción", k, { prim: true, off: ocupado })}</div>`;
    });
    if (actual > 0 && actual < ps.length - 1) h += `<div class="quien">🔒 ${ps.length - actual - 1} porción(es) más después de esta.</div>`;
    const obligatoria = leerConfig(cwd).programar?.prediccionObligatoria !== false;
    if (actual === -1 || !obligatoria) h += `<div class="botones">${this.boton("insertarPropuesta", actual === -1 ? "⤵ Insertar en mi archivo" : "⤵ Insertar sin probar todo (queda como deuda)", p.fecha, { prim: actual === -1, off: ocupado })}${this.boton("descartarPropuesta", "Descartar", undefined, off)}</div>`;
    else h += this.boton("descartarPropuesta", "Descartar propuesta", undefined, off);
    return `${h}</div>`;
  }

  /** El aviso del último paso de "construir juntos" que no se pudo hacer (se muestra en el panel, no en un globo). */
  private avisoConstruir?: { clave: string; texto: string };

  /**
   * Construir juntos: la idea primero, tu orden después, el código al final. Todo en el panel (sin cajas
   * en la barra de arriba): stepper, lo que la IA ofrece en palabras para el paso que toca, tu orden con tus
   * palabras, el código de ese paso para probarlo, y al final casos y tu predicción antes de insertar.
   */
  private bloqueConstruir(cwd: string, rel: string, funcion: string, nota: Nota | undefined, ocupado: boolean): string {
    const off = { off: ocupado };
    const c = modoEfectivo(leerConfig(cwd), rel, funcion).c;
    const p = leerPropuesta(cwd, rel, funcion);
    const pasosPlan = nota?.plan?.pasos ?? [];
    const ps = p?.porciones ?? [];
    const escrito = (k: number) => ps.find((x) => !x.tipo && x.paso === k);
    const faltan = pasosPlan.map((_, i) => i + 1).filter((k) => !escrito(k));
    const primero = faltan[0] ?? 0;
    const ofertas = p?.construir?.ofertas ?? [];
    const ultima = [...ps].reverse().find((x) => !x.tipo || x.tipo === "ajuste");
    const casos = p?.construir?.casos;
    const pred = p?.construir?.prediccion;
    const previoPendiente = (p?.construir?.previo ?? []).some((x) => x.estado === "pendiente");
    const nombre = funcion.replace(/#\d+$/, "");
    const params = parametrosDe(p?.construir?.base?.cabecera?.join(" ") ?? (p?.codigo ?? "").split("\n")[0] ?? "");
    const conAviso = (x?: (typeof ps)[number]) => !!x?.verificacion && ((x.verificacion.agregado.length > 0 && !x.verificacion.dejado) || x.verificacion.falta.length > 0);
    // La página que se abre: lo que necesita tu atención (lo recién escrito, el paso que toca, o los casos).
    const escritos = p?.construir?.escritos ?? [];
    const inicial = !p || !nota?.plan || previoPendiente ? "plan" : escritos.length ? (escritos[0] ? `paso-${escritos[0]}` : "casos") : primero ? `paso-${primero}` : "casos";
    // Orden de las páginas (para ◀ / ▶).
    const paginas = ["plan", ...pasosPlan.map((_, i) => `paso-${i + 1}`), ...(p && nota?.plan ? ["casos"] : [])];
    const nav = (id: string) => {
      const i = paginas.indexOf(id);
      const ant = paginas[i - 1];
      const sig = paginas[i + 1];
      const etiqueta = (x: string) => (x === "plan" ? "Plan" : x === "casos" ? "Casos" : `Paso ${x.slice(5)}`);
      return `<div class="nav">${ant ? `<button class="navb" data-pagina="${ant}">◀ ${etiqueta(ant)}</button>` : "<span></span>"}${sig ? `<button class="navb" data-pagina="${sig}">${etiqueta(sig)} ▶</button>` : ""}</div>`;
    };
    // Chips: dónde estás (✓ escrito, ⚠ con aviso del verificador, ○ falta).
    const chip = (id: string, texto: string, titulo: string) => `<button class="chip" data-pagina="${id}" title="${esc(titulo)}">${texto}</button>`;
    const chips = [
      chip("plan", `${nota?.plan ? "✓" : "○"} Plan`, nota?.plan ? `${pasosPlan.length} pasos` : "todavía sin plan"),
      ...pasosPlan.map((x, i) => chip(`paso-${i + 1}`, `${conAviso(escrito(i + 1)) ? "⚠" : escrito(i + 1) ? "✓" : "○"} ${i + 1}`, x.texto)),
      ...(p && nota?.plan ? [chip("casos", `${pred?.espero !== undefined ? "✓" : "○"} Casos`, "casos, predicción e insertar")] : []),
    ].join("");
    let h = `<div class="accion construir cj" data-inicial="${inicial}"><div><b>🧭 Construir juntos</b> <span class="quien">la IA propone en palabras; tú das la orden y escribe solo eso${c.ayuda === "aprender" ? " · aprender: tu idea antes y probar cada paso" : ""}</span></div><div class="chips">${chips}</div>`;
    const aviso = this.avisoConstruir?.clave === `${rel}#${funcion}` ? this.avisoConstruir.texto : "";
    if (aviso) h += `<div class="aviso">⚠ ${esc(aviso)}</div>`;
    if (p?.explicacion) h += `<div class="quien">ℹ ${esc(p.explicacion)}</div>`;
    if (p?.construir?.trampas?.length) h += `<div class="aviso">⚠ Ojo: ${p.construir.trampas.map(esc).join("; ")}. Pide un ajuste con tu orden (Casos).</div>`;

    // --- Página: plan (y lo que ya tenías) ---
    h += `<div class="pagina" data-pagina="plan">`;
    if (nota?.plan) {
      h += `<ol class="plan">${pasosPlan.map((x, i) => `<li class="${escrito(i + 1) ? "hecho" : ""}">${esc(x.texto)}</li>`).join("")}</ol>`;
      if (nota.plan.separar) h += `<div class="quien">Separa <code>${esc(nota.plan.separar.nombre)}</code> (${esc(nota.plan.separar.proposito)}): quedó como tarea y se trabaja en su propia nota.</div>`;
      h += `<details><summary>✎ Editar plan</summary><textarea id="cj-plan" data-guardar rows="4">${esc(pasosPlan.map((x) => x.texto).join("\n"))}</textarea><div class="fila">${this.boton("guardarPlan", "Guardar plan (3 a 5 pasos)", undefined, { off: ocupado, campos: "cj-plan" })}</div></details>`;
    }
    const previo = ps.find((x) => x.tipo === "ya-estaba");
    if (previo) h += `<details><summary>Lo que ya tenías (punto de partida)</summary><pre><code>${esc(previo.codigo ?? "")}</code></pre></details>`;
    (p?.construir?.previo ?? []).forEach((x, i) => {
      if (x.estado !== "pendiente") return;
      h += `<div class="oferta">🔎 <b>Sobre lo que ya tenías:</b> ${esc(x.texto)} <span class="quien">— ${esc(x.porque)}</span><div class="fila">${this.boton("dejarSugerencia", "Dejarlo así", i, off)}</div><details><summary>Cambiarlo con mi orden</summary><textarea id="cj-prev-${i}" data-guardar rows="2" placeholder="haz que… (con tus palabras)"></textarea><div class="fila">${this.boton("ordenSugerencia", "Cambiarlo así", i, { off: ocupado, campos: `cj-prev-${i}` })}</div></details></div>`;
    });
    if (previo) h += `<div class="fila">${this.boton("quitarPrevio", "🗑 Reemplazarlo con los pasos", undefined, off)}</div>`;
    if (!p) {
      const reps = [...new Set(pasosPlan.flatMap((x) => (x.repertorio ? [x.repertorio] : [])))];
      h += `<div class="botones">${c.decidirAntes && nota?.plan ? `<button class="navb prim" data-pagina="paso-1">Empezar por el paso 1 ▶</button>` : this.boton("construir", nota?.plan ? "💬 ¿Cómo harías los pasos? (empezar)" : "🧭 Empezar: plan y propuestas", undefined, { prim: true, off: ocupado })}${reps.map((id) => this.boton("adaptar", `📚 Usar mi versión (${esc(id)})`, id, off)).join("")}</div>`;
      if (nota?.programada) h += `<div class="quien">Insertada desde una propuesta: ${nota.programada.ordenes !== undefined ? `${nota.programada.ordenes} paso(s) con tus órdenes` : `${nota.programada.porciones} porción(es)`}${nota.programada.prediccion ? `, predicción ${nota.programada.prediccion.acierto ? "✓" : "✗"}` : ""}</div>`;
    } else h += nav("plan");
    h += "</div>";

    // --- Una página por paso del plan: escrito (revisar y probar) o por escribir (propuesta + tu orden) ---
    const pruebasDe = (x: (typeof ps)[number]) =>
      x.pruebas.map((y) => `<div class="quien">${!y.toca ? "↷ esa entrada no pasa por estas líneas" : y.acierto ? "✓ acertaste" : "✗ no era eso"}: <code>${esc(y.entrada)}</code> → esperabas <code>${esc(y.espero)}</code>, da <code>${esc(y.obtenido.slice(0, 80))}</code>${y.explicacion ? ` — ${esc(y.explicacion)}` : ""}</div>`).join("");
    const verif = (x: (typeof ps)[number], k: number) => {
      const v = x.verificacion;
      if (!v) return "";
      return `${v.agregado.length && !v.dejado ? `<div class="aviso">🔎 Agregó algo que tu orden no pedía: ${v.agregado.map(esc).join("; ")}<div class="fila">${this.boton("quitar", "Quitarlo", k, off)}${this.boton("dejar", "Dejarlo", k, off)}</div></div>` : ""}${v.agregado.length && v.dejado ? `<div class="quien">🔎 Agregó ${v.agregado.map(esc).join("; ")} (lo dejaste)</div>` : ""}${v.falta.length ? `<div class="aviso">🔎 De tu orden no hizo: ${v.falta.map(esc).join("; ")} <span class="quien">(rehazlo con tu orden si lo quieres)</span></div>` : ""}`;
    };
    const escritoHtml = (x: (typeof ps)[number]) => {
      const k = ps.indexOf(x);
      let b = `${x.orden ? `<div class="quien">Tu orden: “${esc(x.orden)}”</div>` : ""}<pre><code>${esc(x.codigo ?? "")}</code></pre>${x.explicacion ? `<div class="quien">${esc(x.explicacion)}</div>` : ""}${x.falta ? `<div class="aviso">⚠ ${esc(x.falta)}</div>` : ""}${verif(x, k)}${pruebasDe(x)}`;
      const campos = this.camposLlamada(`cj-pr${k}`, params, x.entrada);
      b += `<div class="probar"><b>▶ Probar</b>${c.probarCadaPorcion && !x.aprobada ? ' <span class="quien">(en aprender, antes del paso siguiente)</span>' : ""}<div class="quien">Con estos valores${x.entrada ? " (sugeridos: pasan por este paso)" : ""}; texto sin comillas = texto.</div><div class="params">${campos.html}</div><div>¿Qué crees que da? <input id="cj-espero-${k}" data-guardar data-enter="cj-probar-${k}" placeholder="un valor, o error: parte del mensaje" size="22"> ${this.boton("probarPorcion", "Comprobar", k, { off: ocupado, campos: [...campos.ids, `cj-espero-${k}`].join(","), id: `cj-probar-${k}` })}</div></div>`;
      if (x === ultima) b += `<details><summary>✎ No es lo que quise · ↶ deshacer</summary><textarea id="cj-rehacer" data-guardar rows="2" placeholder="Tu orden de nuevo, con tus palabras: «haz que…»"></textarea><div class="fila">${this.boton("rehacer", "Rehacer con mi orden", undefined, { off: ocupado, campos: "cj-rehacer" })}${this.boton("deshacer", "↶ Deshacer", undefined, off)}</div></details>`;
      return b;
    };
    const bloqueadoPorPrueba = c.probarCadaPorcion && !!ultima && !ultima.aprobada;
    pasosPlan.forEach((paso, i) => {
      const k = i + 1;
      const id = `paso-${k}`;
      h += `<div class="pagina" data-pagina="${id}"><div class="titulo-paso"><b>Paso ${k} de ${pasosPlan.length}</b> · ${esc(paso.texto)}</div>`;
      const x = escrito(k);
      if (x) h += escritoHtml(x);
      else if (!p) h += `<div class="quien">Todavía no hay propuestas: empieza en el Plan.</div>`;
      else if (bloqueadoPorPrueba && k === primero) h += `<div class="aviso">Prueba el paso anterior (▶ Probar) antes de seguir.</div>`;
      else if (c.decidirAntes && k !== primero) h += `<div class="quien">🔒 En aprender se va de a un paso: primero el paso ${primero}.</div>`;
      else {
        const o = ofertas.find((y) => y.paso === k);
        if (c.decidirAntes && !o) h += this.campoIdea(k, undefined, ocupado);
        else if (!o) h += `<div class="botones">${this.boton("construir", faltan.length > 1 ? `💬 ¿Cómo harías los pasos ${faltan.join(", ")}?` : `💬 ¿Cómo harías el paso ${k}?`, undefined, { prim: true, off: ocupado })}</div>`;
        else {
          if (o.ideaTuya) h += `<div class="quien">Tu idea: “${esc(o.ideaTuya)}”${o.sobreTuIdea ? ` — ${esc(o.sobreTuIdea)}` : ""}</div>`;
          h += this.ofertaHtml(o);
          // Tu orden justo debajo de la propuesta; escribir llega de corrido desde el primero que falta hasta este.
          const hasta = c.decidirAntes ? [k] : faltan.filter((n) => n <= k);
          const rango = hasta.length > 1 ? `los pasos ${hasta[0]}–${k}` : `el paso ${k}`;
          h += `<div class="explicar"><b>Tu orden</b> <span class="quien">(con tus palabras: qué hacer en este paso)</span><textarea id="cj-orden-${k}" data-guardar rows="3" placeholder="haz que…"></textarea><div class="fila">${this.boton("otra", "↺ Otra forma", k, off)}${this.boton("orden", `✍ Escribir ${rango}`, undefined, { prim: true, off: ocupado, campos: hasta.map((n) => `cj-orden-${n}`).join(",") })}</div>${hasta.length > 1 ? `<div class="quien">Se escriben con las órdenes que dejaste en ${hasta.slice(0, -1).map((n) => `el paso ${n}`).join(", ")} y esta.</div>` : ""}</div>`;
        }
      }
      h += `${nav(id)}</div>`;
    });

    // --- Página: casos, predicción e insertar ---
    if (p && nota?.plan) {
      h += `<div class="pagina" data-pagina="casos">`;
      const ajustes = ps.filter((x) => x.tipo === "ajuste");
      for (const x of ajustes) h += `<details${escritos.includes(0) ? " open" : ""}><summary>Ajuste: “${esc(x.orden ?? "")}”</summary>${escritoHtml(x)}</details>`;
      if (faltan.length) h += `<div class="quien">Faltan los pasos ${faltan.join(", ")} (de corrido, cada uno con tu orden). ${faltan.map((n) => `<button class="navb" data-pagina="paso-${n}">Paso ${n}</button>`).join(" ")}</div>`;
      else h += this.casosHtml(p, nombre, params, ocupado, true);
      h += `${nav("casos")}</div>`;
    }
    if (p) h += `<div class="fila pie">${this.boton("descartarPropuesta", "Descartar propuesta", undefined, off)}</div>`;
    return `${h}</div>`;
  }

  /**
   * Programar por pedidos: pides con tus palabras qué debe hacer la función entera (o un cambio); el ida y
   * vuelta lo hace la IA chica y la verifica otra chica; si es mucho, propone separarla. Al final, en un
   * solo paso, la IA mediana audita (casos, qué hacer, cómo mejorar y la versión ideal), después de tu predicción.
   */
  private bloquePedido(cwd: string, rel: string, funcion: string, nota: Nota | undefined, ocupado: boolean): string {
    const off = { off: ocupado };
    const p = leerPropuesta(cwd, rel, funcion);
    const ps = p?.porciones ?? [];
    const k = p?.construir;
    const nombre = funcion.replace(/#\d+$/, "");
    const params = parametrosDe(k?.base?.cabecera?.join(" ") ?? (p?.codigo ?? "").split("\n")[0] ?? "");
    const hayBorrador = ps.some((x) => x.tipo !== "ya-estaba");
    const aud = k?.auditoria;
    const audAlDia = !!aud && aud.codigo === p?.codigo;
    const pred = k?.prediccion;
    const inicial = audAlDia || (k?.escritos ?? []).length === 0 && hayBorrador && !!k?.casos ? "auditoria" : "pedir";
    const chips = `<button class="chip" data-pagina="pedir">✍ Pedir</button><button class="chip" data-pagina="auditoria" title="casos, auditoría final e insertar">${audAlDia ? "✓" : "○"} 🔎 Auditoría</button>`;
    let h = `<div class="accion construir cj" data-inicial="${inicial}"><div><b>🧭 Construir con tus pedidos</b> <span class="quien">pides con tus palabras; la IA chica escribe solo eso y otra lo verifica; al final, la mediana audita</span></div><div class="chips">${chips}</div>`;
    const aviso = this.avisoConstruir?.clave === `${rel}#${funcion}` ? this.avisoConstruir.texto : "";
    if (aviso) h += `<div class="aviso">⚠ ${esc(aviso)}</div>`;
    if (p?.explicacion) h += `<div class="quien">ℹ ${esc(p.explicacion)}</div>`;
    if (k?.trampas?.length) h += `<div class="aviso">⚠ Ojo: ${k.trampas.map(esc).join("; ")}. Pide que lo resuelva por su intención.</div>`;

    // --- Página: pedir ---
    h += `<div class="pagina" data-pagina="pedir">`;
    (k?.previo ?? []).forEach((x, i) => {
      if (x.estado !== "pendiente") return;
      h += `<div class="oferta">🔎 <b>Sobre lo que ya tenías:</b> ${esc(x.texto)} <span class="quien">— ${esc(x.porque)}</span><div class="fila">${this.boton("dejarSugerencia", "Dejarlo así", i, off)}</div></div>`;
    });
    if (k?.separar) {
      const sep = k.separar;
      h += `<div class="oferta">✂ <b>Es mucho para una función:</b> ${esc(sep.motivo)}<ul>${sep.auxiliares.map((a) => `<li><code>${esc(a.firma)}</code> — ${esc(a.proposito)}</li>`).join("")}</ul><div class="fila">${this.boton("crearAuxiliares", "✂ Crear estas funciones vacías (cada una con su nota)", undefined, { prim: true, off: ocupado })}${this.boton("pedirUna", "Hacerla igual en una sola", undefined, off)}</div></div>`;
    }
    if (k?.pedidoPendiente) h += `<div class="oferta">Creaste las auxiliares. <div class="fila">${this.boton("pedirPendiente", `✍ Escribir ${esc(nombre)} usándolas`, undefined, { prim: true, off: ocupado })}</div><div class="quien">Tu pedido: “${esc(k.pedidoPendiente)}”. Las auxiliares se construyen cada una en su propia nota.</div></div>`;
    const of = k?.ofertas?.find((x) => x.paso === 0);
    if (of) h += `<details${hayBorrador ? "" : " open"}><summary>💬 Cómo la haría la IA</summary>${this.ofertaHtml(of)}</details>`;
    if (hayBorrador && p) {
      const pedidos = [...new Set(ps.map((x) => x.orden).filter((x): x is string => !!x))];
      h += `<div class="quien">Lo que pediste: ${pedidos.map((x) => `“${esc(x)}”`).join(" · ")}</div><pre><code>${esc(p.codigo)}</code></pre>`;
      for (const x of ps.filter((y) => y.verificacion && ((y.verificacion.agregado.length && !y.verificacion.dejado) || y.verificacion.falta.length))) {
        const i = ps.indexOf(x);
        const v = x.verificacion!;
        if (v.agregado.length && !v.dejado) h += `<div class="aviso">🔎 Agregó algo que no pediste: ${v.agregado.map(esc).join("; ")}<div class="fila">${this.boton("quitar", "Quitarlo", i, off)}${this.boton("dejar", "Dejarlo", i, off)}</div></div>`;
        if (v.falta.length) h += `<div class="aviso">🔎 De tu pedido no hizo: ${v.falta.map(esc).join("; ")} <span class="quien">(pídelo de nuevo si lo quieres)</span></div>`;
      }
      for (const x of ps.filter((y) => y.falta)) h += `<div class="aviso">⚠ ${esc(x.falta!)}</div>`;
      if (k?.larga) h += `<div class="aviso">✂ Salió de ${k.larga.lineas} líneas (tu práctica dice ${k.larga.max}). ${this.boton("separar", "¿Cómo la separarías?", undefined, off)}</div>`;
      // Probar el último pedido: un campo por parámetro (ya lleno con una entrada que pasa por lo nuevo).
      const ult = [...ps].reverse().find((x) => x.orden);
      if (ult) {
        const i = ps.indexOf(ult);
        const campos = this.camposLlamada(`cj-pr${i}`, params, ult.entrada);
        h += `<div class="probar"><b>▶ Probar</b> <span class="quien">texto sin comillas = texto</span><div class="params">${campos.html}</div><div>¿Qué crees que da? <input id="cj-espero-${i}" data-guardar data-enter="cj-probar-${i}" placeholder="un valor, o error: …" size="20"> ${this.boton("probarPorcion", "Comprobar", i, { off: ocupado, campos: [...campos.ids, `cj-espero-${i}`].join(","), id: `cj-probar-${i}` })}</div>${ult.pruebas.slice(-3).map((y) => `<div class="quien">${y.acierto ? "✓ acertaste" : "✗ no era eso"}: <code>${esc(y.entrada)}</code> → esperabas <code>${esc(y.espero)}</code>, da <code>${esc(y.obtenido.slice(0, 80))}</code>${y.explicacion ? ` — ${esc(y.explicacion)}` : ""}</div>`).join("")}</div>`;
      }
    }
    h += `<div class="explicar"><b>${hayBorrador ? "Pide un cambio" : "¿Qué debe hacer la función?"}</b> <span class="quien">(con tus palabras${hayBorrador ? "" : ": qué recibe, qué revisa, qué devuelve"})</span><textarea id="cj-pedido" data-guardar rows="3" placeholder="${hayBorrador ? "que también…" : "que reciba… y devuelva…"}"></textarea><div class="fila">${!of && !hayBorrador ? this.boton("construir", "💬 ¿Cómo la harías?", undefined, off) : ""}${hayBorrador && (k?.historial?.length ?? 0) > 0 ? this.boton("deshacer", "↶ Deshacer el último pedido", undefined, off) : ""}${this.boton("pedir", hayBorrador ? "✍ Aplicar el cambio" : "✍ Escribirla", undefined, { prim: true, off: ocupado, campos: "cj-pedido" })}</div></div>`;
    if (hayBorrador) h += `<div class="nav"><span></span><button class="navb" data-pagina="auditoria">Auditoría final ▶</button></div>`;
    h += "</div>";

    // --- Página: auditoría final (un solo paso) e insertar ---
    h += `<div class="pagina" data-pagina="auditoria">`;
    if (!hayBorrador || !p) h += `<div class="quien">Primero pide qué debe hacer la función.</div>`;
    else if (!audAlDia) h += `<div class="botones">${this.boton("auditar", aud ? "🔎 Auditar de nuevo (cambió el borrador)" : "🔎 Auditoría final: casos, qué hacer y la versión ideal", undefined, { prim: true, off: ocupado })}</div><div class="quien">Un solo paso con la IA mediana, a ciegas: prueba los casos, comenta cada uno, dice qué hacer, cómo mejorarla y propone la versión ideal.</div>`;
    else if (pred && pred.espero === undefined)
      h += `<div class="probar"><b>🎯 Antes de ver la auditoría:</b> ¿qué da <code>${esc(pred.llamada)}</code>? <input id="cj-pred" data-guardar data-enter="cj-predecir" size="16" placeholder="tu predicción"> ${this.boton("predecirFuncion", "Comprobar", undefined, { prim: true, off: ocupado, campos: "cj-pred", id: "cj-predecir" })}</div>`;
    else {
      const a = aud!;
      if (pred) h += `<div class="quien">🎯 Predijiste <code>${esc(pred.espero ?? "")}</code> para <code>${esc(pred.llamada)}</code>: ${pred.acierto ? "✓ acertaste" : `✗ da <code>${esc(pred.obtenido ?? "")}</code>${pred.explicacion ? ` — ${esc(pred.explicacion)}` : ""}`}</div>`;
      h += `<div class="oferta"><b>${{ lista: "🟢 Lista", casi: "🟡 Casi", falta: "🔴 Falta" }[a.estado]}</b> — ${esc(a.resumen)}</div>`;
      const casos = k?.casos ?? [];
      if (casos.length) {
        const comentario = (l: string) => a.casos?.find((x) => x.llamada.replace(/\s/g, "") === l.replace(/\s/g, ""))?.comentario ?? "";
        h += `<table class="casos"><tr><th>caso</th><th>debe dar</th><th></th></tr>${casos.map((x) => `<tr><td><code>${esc(x.llamada)}</code></td><td><code>${esc(x.esperado)}</code></td><td>${x.raro ? "⚠" : x.pasa === undefined ? "❓" : x.pasa ? "✅" : `❌ <code>${esc((x.obtenido ?? "").slice(0, 50))}</code>`}${comentario(x.llamada) ? `<div class="quien">${esc(comentario(x.llamada))}</div>` : ""}</td></tr>`).join("")}</table>`;
      }
      if (a.queHacer?.length) h += `<div><b>Qué hacer</b><ol>${a.queHacer.map((x) => `<li>${esc(x)}</li>`).join("")}</ol></div>`;
      if (a.hallazgos.length) h += `<div><b>Cómo mejorarla</b><ul>${a.hallazgos.map((x) => `<li>${esc(x.texto)} <span class="quien">— ${esc(x.porque)}</span></li>`).join("")}</ul></div>`;
      if (a.ideal) h += `<div class="oferta">💡 <b>Versión ideal:</b> ${esc(a.ideal.descripcion)} ${this.boton("verIdeal", "Ver diff con tu borrador", undefined, off)}<textarea id="cj-ideal" data-guardar rows="2" placeholder="Qué tomas de ella, con tus palabras (o «tomar la versión ideal completa»)"></textarea><div class="fila">${this.boton("pedirIdeal", "✍ Pedir esto", undefined, { off: ocupado, campos: "cj-ideal" })}</div></div>`;
      const cc = this.camposLlamada("cj-cc", params);
      h += `<details><summary>✎ Agregar un caso (o cambiar uno: su número)</summary><div class="params">${cc.html}</div><div>debe dar <input id="cj-ce" data-guardar placeholder="un valor, o error: …" size="16"> · caso nº <input id="cj-ci" data-guardar size="3" placeholder="nuevo"> ${this.boton("caso", "Guardar y probar", undefined, { off: ocupado, campos: [...cc.ids, "cj-ce", "cj-ci"].join(",") })}</div></details>`;
      h += `<div class="botones">${this.boton("insertarPropuesta", "⤵ Insertar en mi archivo", p.fecha, { prim: true, off: ocupado })}${this.boton("verBorrador", "Ver diff", undefined, off)}</div>`;
    }
    h += `<div class="nav"><button class="navb" data-pagina="pedir">◀ Pedir</button><span></span></div></div>`;
    if (p) h += `<div class="fila pie">${this.boton("descartarPropuesta", "Descartar propuesta", undefined, off)}</div>`;
    return `${h}</div>`;
  }

  /** Casos según la intención, tu predicción, ajustar con tu orden e insertar (igual por pasos y por pedidos). */
  private casosHtml(p: NonNullable<ReturnType<typeof leerPropuesta>>, nombre: string, params: string[], ocupado: boolean, conAjuste: boolean): string {
    const off = { off: ocupado };
    const casos = p.construir?.casos;
    const pred = p.construir?.prediccion;
    let h = "";
    if (!casos) h += `<div class="botones">${this.boton("casos", "🧪 Proponer casos y probar el borrador", undefined, { prim: true, off: ocupado })}</div>`;
    else {
      const filas = casos
        .map((x) => {
          const oculto = pred && pred.llamada === x.llamada && pred.espero === undefined;
          const res = oculto ? "🎯 predice abajo" : x.raro ? `⚠ no encaja: ${esc(x.raro)}` : x.pasa === undefined ? "❓ por probar o lo decides tú" : x.pasa ? "✅" : `❌ da <code>${esc((x.obtenido ?? "").slice(0, 60))}</code>${x.ajustar ? '<div class="quien">encaja con el objetivo: ajústalo con tu orden (abajo)</div>' : ""}`;
          return `<tr><td><code>${esc(x.llamada)}</code></td><td><code>${esc(x.esperado)}</code>${x.duda ? `<div class="quien">${esc(x.duda)}</div>` : ""}</td><td>${res}</td></tr>`;
        })
        .join("");
      h += `<table class="casos"><tr><th>llamada</th><th>debe dar</th><th>borrador</th></tr>${filas}</table>`;
      if (casos.some((x) => x.pasa === undefined && x.esperado !== "?" && !x.raro)) h += `<div class="botones">${this.boton("casos", "🧪 Volver a probar los casos", undefined, off)}</div>`;
      if (pred && pred.espero === undefined)
        h += `<div class="probar"><b>🎯 Antes de insertarla:</b> ¿qué da <code>${esc(pred.llamada)}</code>? <input id="cj-pred" data-guardar data-enter="cj-predecir" size="16" placeholder="tu predicción"> ${this.boton("predecirFuncion", "Comprobar", undefined, { prim: true, off: ocupado, campos: "cj-pred", id: "cj-predecir" })}</div>`;
      else if (pred) h += `<div class="quien">🎯 Predijiste <code>${esc(pred.espero ?? "")}</code> para <code>${esc(pred.llamada)}</code>: ${pred.acierto ? "✓ acertaste" : `✗ da <code>${esc(pred.obtenido ?? "")}</code>${pred.explicacion ? ` — ${esc(pred.explicacion)}` : ""}`}</div>`;
      const cc = this.camposLlamada("cj-cc", params);
      h += `<details><summary>✎ Agregar un caso (o cambiar uno: su número)</summary><div class="params">${cc.html}</div><div>debe dar <input id="cj-ce" data-guardar placeholder="un valor, o error: …" size="16"> · caso nº <input id="cj-ci" data-guardar size="3" placeholder="nuevo"> ${this.boton("caso", "Guardar y probar", undefined, { off: ocupado, campos: [...cc.ids, "cj-ce", "cj-ci"].join(",") })}</div><div class="quien">texto sin comillas = texto</div></details>`;
      if (conAjuste) h += `<details${casos.some((x) => x.ajustar && !x.pasa) ? " open" : ""}><summary>✎ Ajustar la función (tu orden)</summary><textarea id="cj-ajuste" data-guardar rows="2" placeholder="haz que también… (con tus palabras)"></textarea><div class="fila">${this.boton("ajuste", "Ajustar con mi orden", undefined, { off: ocupado, campos: "cj-ajuste" })}</div></details>`;
    }
    h += `<div class="botones">${this.boton("insertarPropuesta", "⤵ Insertar en mi archivo", p.fecha, { prim: !!casos && (!pred || pred.espero !== undefined), off: ocupado })}${this.boton("verBorrador", "Ver diff", undefined, off)}</div>`;
    return h;
  }

  /** Un campo por parámetro (con la entrada sugerida ya puesta): no hace falta escribir la llamada. */
  private camposLlamada(prefijo: string, params: string[], sugerida?: string): { html: string; ids: string[] } {
    const args = sugerida ? argumentosDe(sugerida) : [];
    const n = Math.max(params.length, args.length);
    if (!n) return { html: '<span class="quien">(sin parámetros)</span>', ids: [] };
    const ids = Array.from({ length: n }, (_, i) => `${prefijo}-a${i}`);
    const html = ids.map((id, i) => `<label class="param">${esc(params[i] ?? `arg${i + 1}`)} <input id="${id}" data-guardar value="${esc(args[i] !== undefined ? valorDeCampo(args[i]!) : "")}" size="12"></label>`).join(" ");
    return { html, ids };
  }

  /** Lo que la IA ofrece en palabras para un paso. */
  private ofertaHtml(o: { idea: string; alternativas: string[] }): string {
    return `<div class="oferta">💬 <b>Puedo hacerlo así:</b> ${esc(o.idea)}${o.alternativas.length ? `<ul>${o.alternativas.map((a) => `<li>Otra forma: ${esc(a)}</li>`).join("")}</ul>` : ""}</div>`;
  }

  /** Programar · aprender: tu idea antes de ver la propuesta de la IA. */
  private campoIdea(paso: number, texto: string | undefined, ocupado: boolean): string {
    return `<div class="porcion actual"><b>Paso ${paso}</b>${texto ? ` · ${esc(texto)}` : ""}<div>Antes de ver la propuesta: <b>¿cómo lo harías tú?</b> <span class="quien">(en palabras; no hace falta acertar)</span></div><textarea id="cj-idea" data-guardar rows="2" placeholder="Yo revisaría que… y si no…"></textarea><div class="fila">${this.boton("idea", "Anotar y ver cómo lo haría la IA", undefined, { prim: true, off: ocupado, campos: "cj-idea" })}</div></div>`;
  }

  private async programarAccion(cmd: string, arg: unknown, doc: vscode.TextDocument, nota: Nota | undefined): Promise<void> {
    const cwd = root(doc);
    if (!cwd || this.modo.tipo !== "funcion") return;
    const rel = relDe(cwd, doc.uri.fsPath);
    const funcion = this.modo.funcion;
    const nombre = funcion?.replace(/#\d+$/, "") ?? "";
    const destino = funcion ? ["--funcion", funcion] : [];
    const k = `${this.modo.uri}#${nota?.id ?? "nueva"}`;
    // Mientras la IA trabaja, "pensando…" en la nota.
    const ocupar = async <T,>(fn: () => Promise<T>): Promise<T> => {
      this.pensando.add(k);
      await this.render();
      try {
        return await fn();
      } finally {
        this.pensando.delete(k);
        await this.render();
      }
    };
    const fArg = funcion ? ["--funcion", `${rel}:${funcion}`] : ["--archivo", rel];
    // Construir juntos: lo que viene del panel trae {arg, campos}; los errores se muestran en el panel.
    const CONSTRUIR = ["construir", "otra", "idea", "orden", "rehacer", "deshacer", "ajuste", "quitar", "dejar", "dejarSugerencia", "ordenSugerencia", "quitarPrevio", "pedir", "pedirUna", "pedirPendiente", "pedirIdeal", "separar", "crearAuxiliares", "auditar", "verIdeal", "guardarPlan", "probarPorcion", "casos", "caso", "predecirFuncion", "verBorrador"];
    if (funcion && CONSTRUIR.includes(cmd)) {
      const clave = `${rel}#${funcion}`;
      let d: { arg?: string; campos?: Record<string, string> } = {};
      try {
        d = typeof arg === "string" && arg.startsWith("{") ? (JSON.parse(arg) as typeof d) : { arg: typeof arg === "string" ? arg : arg === undefined ? undefined : String(arg) };
      } catch {
        d = {};
      }
      const campo = (id: string) => (d.campos?.[id] ?? "").trim();
      const k = String(Number(d.arg ?? 0) + 1); // porción (1-based para la CLI)
      const prog = (...a: string[]) => ocupar(() => correr(["programar", ...a.slice(0, 1), rel, "--funcion", funcion, ...a.slice(1), "--json"], cwd));
      try {
        this.avisoConstruir = undefined;
        switch (cmd) {
          case "construir":
            await prog("construir");
            break;
          case "pedir":
            await prog("pedir", "--texto", campo("cj-pedido"));
            break;
          case "pedirIdeal":
            await prog("pedir", "--ideal", "--texto", campo("cj-ideal"));
            break;
          case "pedirUna": {
            const sep = leerPropuesta(cwd, rel, funcion)?.construir?.separar;
            if (sep) await prog("pedir", "--una", "--texto", sep.pedido);
            break;
          }
          case "pedirPendiente": {
            const pend = leerPropuesta(cwd, rel, funcion)?.construir?.pedidoPendiente;
            if (pend) await prog("pedir", "--texto", pend);
            break;
          }
          case "separar":
            await prog("separar");
            break;
          case "auditar":
            await prog("auditar");
            break;
          case "crearAuxiliares": {
            // Tu clic: las auxiliares vacías (firma + qué hacen) entran a tu archivo, después de la función.
            const st = JSON.parse(await correr(["programar", "auxiliares", rel, "--funcion", funcion, "--json"], cwd)) as { texto: string; despuesDeLinea: number; auxiliares: { nombre: string }[] };
            if (!st.texto.trim()) {
              await prog("auxiliares", "--registrar");
              break;
            }
            const ok = await vscode.window.showInformationMessage(`¿Agregar a tu archivo ${st.auxiliares.map((a) => a.nombre).join(", ")} (vacías: solo la firma y qué hacen)?`, { modal: true }, "Agregar");
            if (ok !== "Agregar") break;
            const linea = Math.min(st.despuesDeLinea, doc.lineCount) - 1;
            const edit = new vscode.WorkspaceEdit();
            edit.insert(doc.uri, doc.lineAt(linea).range.end, `\n${st.texto}`);
            if (!(await vscode.workspace.applyEdit(edit))) throw new Error("no se pudieron agregar las funciones (¿cambió el archivo?)");
            await guardar(doc);
            await prog("auxiliares", "--registrar");
            break;
          }
          case "verIdeal": {
            const pr = leerPropuesta(cwd, rel, funcion);
            if (!pr?.construir?.auditoria?.ideal) break;
            const a = await vscode.workspace.openTextDocument({ content: pr.codigo, language: doc.languageId });
            const b = await vscode.workspace.openTextDocument({ content: pr.construir.auditoria.ideal.codigo, language: doc.languageId });
            await vscode.commands.executeCommand("vscode.diff", a.uri, b.uri, `${nombre}: tu borrador ↔ versión ideal`);
            break;
          }
          case "otra":
            await prog("otra", "--paso", String(Number(d.arg)));
            break;
          case "idea":
            await prog("idea", "--texto", campo("cj-idea"));
            break;
          case "orden": {
            // Las órdenes del formulario (cj-orden-N), en orden de paso; las vacías quedan para después.
            const pares = Object.keys(d.campos ?? {})
              .map((id) => ({ n: Number(/^cj-orden-(\d+)$/.exec(id)?.[1]), t: campo(id) }))
              .filter((x) => x.n && x.t)
              .sort((a, b) => a.n - b.n);
            if (!pares.length) {
              this.avisoConstruir = { clave, texto: "escribe tu orden de al menos un paso (con tus palabras)" };
              break;
            }
            await prog("orden", ...pares.flatMap((x) => ["--paso", String(x.n), "--texto", x.t]));
            break;
          }
          case "quitar":
          case "dejar":
            await prog(cmd, "--porcion", String(Number(d.arg) + 1));
            break;
          case "dejarSugerencia":
            await prog("dejar", "--sugerencia", String(Number(d.arg) + 1));
            break;
          case "quitarPrevio":
            await prog("quitar", "--previo");
            break;
          case "ordenSugerencia":
            await prog("orden", "--sugerencia", String(Number(d.arg) + 1), "--texto", campo(`cj-prev-${Number(d.arg)}`));
            break;
          case "rehacer":
            await prog("orden", "--texto", campo("cj-rehacer"), "--rehacer");
            break;
          case "ajuste":
            await prog("orden", "--texto", campo("cj-ajuste"), "--ajuste");
            break;
          case "deshacer":
            await prog("deshacer");
            break;
          case "guardarPlan":
            await correr(["programar", "plan", rel, "--funcion", funcion, ...campo("cj-plan").split("\n").flatMap((x) => (x.trim() ? ["--pasos", x.trim()] : []))], cwd);
            break;
          case "probarPorcion": {
            const n = Number(d.arg ?? 0);
            const py = doc.languageId === "python";
            const valores = Object.keys(d.campos ?? {}).filter((id) => id.startsWith(`cj-pr${n}-a`)).sort((a, b) => Number(a.split("-a").pop()) - Number(b.split("-a").pop())).map((id) => d.campos![id] ?? "");
            if (!campo(`cj-espero-${n}`)) {
              this.avisoConstruir = { clave, texto: "escribe qué crees que da ANTES de comprobar" };
              break;
            }
            const entrada = armarLlamada(nombre, valores, py);
            const r = JSON.parse(await prog("probar", "--porcion", k, "--entrada", entrada, "--espero", esperadoLiteral(campo(`cj-espero-${n}`), py))) as { prueba: { toca: boolean; acierto: boolean } };
            if (!r.prueba.toca) this.avisoConstruir = { clave, texto: "esa entrada no pasa por estas líneas: usa la sugerida o elige otra" };
            break;
          }
          case "casos":
            await prog("casos");
            break;
          case "caso": {
            const i = campo("cj-ci");
            const py = doc.languageId === "python";
            const valores = Object.keys(d.campos ?? {}).filter((id) => id.startsWith("cj-cc-a")).sort((a, b) => Number(a.split("-a").pop()) - Number(b.split("-a").pop())).map((id) => d.campos![id] ?? "");
            await prog("caso", ...(i ? ["--indice", i] : []), "--llamada", armarLlamada(nombre, valores, py), "--esperado", esperadoLiteral(campo("cj-ce"), py));
            break;
          }
          case "predecirFuncion":
            await prog("predecir", "--espero", esperadoLiteral(campo("cj-pred"), doc.languageId === "python"));
            break;
          case "verBorrador": {
            const p = leerPropuesta(cwd, rel, funcion);
            const simbolos = await funcionesDe(doc);
            const s = simbolos.find((x) => claveDeSimbolo(simbolos, x) === funcion);
            if (!p || !s) break;
            const a = await vscode.workspace.openTextDocument({ content: doc.getText(s.range), language: doc.languageId });
            const b = await vscode.workspace.openTextDocument({ content: p.codigo, language: doc.languageId });
            await vscode.commands.executeCommand("vscode.diff", a.uri, b.uri, `${nombre}: tu archivo ↔ borrador`);
            break;
          }
        }
      } catch (e) {
        this.avisoConstruir = { clave, texto: e instanceof Error ? e.message : String(e) };
      }
      void vscode.commands.executeCommand("cai.panel.refrescar");
      return void this.render();
    }
    switch (cmd) {
      case "objetivo":
        await correr(["entender", String(arg), ...fArg], cwd);
        return void this.render();
      case "entender":
        await ocupar(() => correr(["entender", ...fArg, "--texto", typeof arg === "string" ? arg : "", "--json"], cwd));
        return;
      case "plan":
        if (!funcion) return;
        await ocupar(() => correr(["programar", "plan", rel, ...destino, "--json"], cwd));
        void vscode.commands.executeCommand("cai.panel.refrescar");
        return;
      case "editarPlan": {
        if (!funcion) return;
        const v = await vscode.window.showInputBox({ prompt: `Plan de ${nombre}: 3 a 5 pasos separados por "|" (si son más, son dos funciones)`, value: (nota?.plan?.pasos ?? []).map((p) => p.texto).join(" | ") });
        if (v === undefined) return;
        await correr(["programar", "plan", rel, ...destino, ...v.split("|").flatMap((x) => (x.trim() ? ["--pasos", x.trim()] : []))], cwd);
        return void this.render();
      }
      case "paso": {
        if (!funcion || typeof arg !== "string" || !arg.trim()) return;
        const n = (nota?.plan?.pasos.findIndex((p) => !p.hecho) ?? -1) + 1 || 1;
        await ocupar(() => correr(["programar", "paso", rel, ...destino, "--paso", String(n), "--texto", arg.trim(), "--json"], cwd));
        return;
      }
      case "contrato": {
        if (!funcion) return;
        // Tus casos: la entrada y el resultado esperado los pones tú (uno a la vez; vacío para terminar).
        const casos: string[] = [];
        for (let i = 1; i <= 8; i++) {
          const llamada = await vscode.window.showInputBox({ prompt: `Caso ${i} de ${nombre}: la llamada (vacío para terminar; al menos 2 y uno borde: vacío, 0, negativo, null…)`, value: `${nombre}(` , valueSelection: [nombre.length + 1, nombre.length + 1] });
          if (!llamada?.trim() || llamada.trim() === `${nombre}(`) break;
          const esperado = await vscode.window.showInputBox({ prompt: `¿Qué debe dar ${llamada.trim()}? (un valor, o "error: parte del mensaje")` });
          if (esperado === undefined) return;
          casos.push("--caso", llamada.trim(), esperado.trim());
        }
        if (!casos.length) return;
        await correr(["programar", "contrato", rel, ...destino, ...casos], cwd);
        return void this.render();
      }
      case "pr":
      case "adaptar":
        if (!funcion) return;
        await ocupar(() => correr(["programar", "pr", rel, ...destino, ...(cmd === "adaptar" && typeof arg === "string" ? ["--desde", arg] : []), "--json"], cwd));
        return;
      case "probar": {
        if (!funcion) return;
        const entrada = await vscode.window.showInputBox({ prompt: `Tu entrada para la porción ${Number(arg) + 1}: una llamada a ${nombre}(…) que pase por esas líneas`, value: `${nombre}(`, valueSelection: [nombre.length + 1, nombre.length + 1] });
        if (!entrada?.trim()) return;
        const espero = await vscode.window.showInputBox({ prompt: `¿Qué esperas que dé ${entrada.trim()}? (antes de ejecutar; un valor o "error")` });
        if (!espero?.trim()) return;
        const r = JSON.parse(await ocupar(() => correr(["programar", "probar", rel, ...destino, "--porcion", String(Number(arg) + 1), "--entrada", entrada.trim(), "--espero", espero.trim(), "--json"], cwd))) as { prueba: { toca: boolean; acierto: boolean; obtenido: string }; aprobadas: number; total: number };
        vscode.window.setStatusBarMessage(`ComplementAIry: ${!r.prueba.toca ? "esa entrada no pasa por esta porción: elige otra" : r.prueba.acierto ? `✓ coincide (${r.aprobadas}/${r.total} porciones)` : `✗ da ${r.prueba.obtenido}`}`, 8000);
        return;
      }
      case "descartarPropuesta":
        if (!funcion) return;
        await correr(["programar", "descartar", rel, ...destino], cwd);
        return void this.render();
      case "diffPropuesta": {
        const p = funcion && leerPropuesta(cwd, rel, funcion);
        if (!p || !p.original) return;
        const a = await vscode.workspace.openTextDocument({ content: p.original.codigo, language: doc.languageId });
        const b = await vscode.workspace.openTextDocument({ content: p.codigo, language: doc.languageId });
        return void vscode.commands.executeCommand("vscode.diff", a.uri, b.uri, `${nombre}: tu versión (${p.original.proyecto}) ↔ adaptada`);
      }
      case "insertarPropuesta":
        if (funcion) return this.insertarPropuesta(cwd, rel, funcion, doc, typeof arg === "string" ? arg : "");
    }
  }

  /** Tu clic: la propuesta entra a tu archivo (con vista previa), y queda registrado cómo se probó. */
  private async insertarPropuesta(cwd: string, rel: string, funcion: string, doc: vscode.TextDocument, vista: string): Promise<void> {
    const p = leerPropuesta(cwd, rel, funcion);
    if (!p) return;
    // Se inserta exactamente lo que viste (si la propuesta cambió mientras tanto, se vuelve a mostrar).
    if (vista && p.fecha !== vista) {
      void vscode.window.showWarningMessage("La propuesta cambió desde que la viste: revísala de nuevo antes de insertarla.");
      return void this.render();
    }
    if (p.tipo === "construir") {
      // Las mismas reglas que la CLI, ANTES de tocar tu archivo (de a una porción, casos, tu predicción).
      try {
        await correr(["programar", "insertado", rel, "--funcion", funcion, "--comprobar"], cwd, { silencioso: true });
      } catch (e) {
        this.avisoConstruir = { clave: `${rel}#${funcion}`, texto: e instanceof Error ? e.message : String(e) };
        return void this.render();
      }
    } else if (p.porciones?.some((x) => !x.aprobada) && leerConfig(cwd).programar?.prediccionObligatoria !== false)
      return void vscode.window.showWarningMessage("Faltan porciones por probar (la prueba es obligatoria en este proyecto).");
    const ed = await vscode.window.showTextDocument(doc, { preview: false });
    const edit = new vscode.WorkspaceEdit();
    if (p.tipo === "dirigido") {
      // Como los snippets: después de la línea indicada (si sigue ahí), o en el cursor.
      let linea = p.linea && doc.lineAt(Math.min(p.linea, doc.lineCount) - 1).text.trim() === (p.despues ?? "").trim() ? p.linea : undefined;
      if (linea) {
        const r = doc.lineAt(linea - 1).range;
        ed.selection = new vscode.Selection(r.start, r.end);
        ed.revealRange(r, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      }
      const donde = await vscode.window.showInformationMessage(linea ? `¿Insertar el paso después de la línea ${linea}?` : "¿Dónde insertar el paso?", { modal: true }, ...(linea ? ["Aquí"] : []), "En el cursor");
      if (!donde) return;
      if (donde === "En el cursor") linea = ed.selection.active.line + 1;
      edit.insert(doc.uri, doc.lineAt(linea! - 1).range.end, `\n${p.codigo}`);
    } else {
      const simbolos = await funcionesDe(doc);
      const s = simbolos.find((x) => claveDeSimbolo(simbolos, x) === funcion);
      if (!s) return void vscode.window.showWarningMessage(`No encuentro ${funcion} en el archivo: ¿la renombraste?`);
      const pregunta = `¿Reemplazar ${funcion.replace(/#\d+$/, "")} por la propuesta (${p.porciones?.length ?? 1} porción(es))?`;
      let ok = await vscode.window.showInformationMessage(pregunta, { modal: true }, "Reemplazar", "Ver diff primero");
      if (ok === "Ver diff primero") {
        const b = await vscode.workspace.openTextDocument({ content: p.codigo, language: doc.languageId });
        const a = await vscode.workspace.openTextDocument({ content: doc.getText(s.range), language: doc.languageId });
        await vscode.commands.executeCommand("vscode.diff", a.uri, b.uri, "Tu función ↔ propuesta");
        // Con el diff a la vista, la decisión queda a un clic (sin volver a empezar).
        ok = await vscode.window.showInformationMessage(pregunta, "Reemplazar");
        if (ok === "Reemplazar") await vscode.window.showTextDocument(doc, { preview: false });
      }
      if (ok !== "Reemplazar") return;
      edit.replace(doc.uri, s.range, p.codigo);
    }
    if (!(await vscode.workspace.applyEdit(edit))) return void vscode.window.showWarningMessage("No se pudo insertar (¿cambió el archivo?).");
    try {
      const r = await correr(["programar", "insertado", rel, "--funcion", funcion], cwd);
      vscode.window.setStatusBarMessage(`ComplementAIry: ${r.trim().replace(/^✓\s*/, "")}`, 6000);
    } catch (e) {
      mostrarError(e);
    }
    await this.render();
  }

  /** Markdown → HTML, y luego solo etiquetas de texto (sin atributos salvo href http/https): lo que viene de la IA o de archivos no puede inyectar botones, estilos ni imágenes. */
  private async md(texto: string): Promise<string> {
    try {
      return sanear(await vscode.commands.executeCommand<string>("markdown.api.render", texto));
    } catch {
      return `<p>${esc(texto).replace(/\n/g, "<br>")}</p>`;
    }
  }

  /** `campos`: ids de los campos del panel que viajan con el clic (como {arg, campos}). */
  private boton(cmd: string, texto: string, arg?: string | number, o: { prim?: boolean; off?: boolean; campos?: string; id?: string } = {}): string {
    return `<button data-cmd="${cmd}"${arg !== undefined ? ` data-arg="${esc(String(arg))}"` : ""}${o.campos ? ` data-campos="${o.campos}"` : ""}${o.id ? ` id="${o.id}"` : ""}${o.prim ? ' class="prim"' : ""}${o.off ? " disabled" : ""}>${texto}</button>`;
  }

  private generacion = 0;

  async render(): Promise<void> {
    if (!this.view?.visible) return;
    const gen = ++this.generacion; // si mientras tanto empezó otro dibujo, este se descarta
    let html = "";
    let caja: { placeholder: string; botones: { cmd: string; texto: string }[]; ocupado?: boolean } | null = null;
    const m = this.modo;
    if (m.tipo === "funcion") {
      const { doc, nota } = this.notaActual();
      const ocupado = this.pensando.has(`${m.uri}#${nota?.id ?? "nueva"}`) || this.notas.ocupado(m.uri, nota?.id);
      const cwd = doc && root(doc);
      const rel = doc && cwd ? relDe(cwd, doc.uri.fsPath) : "";
      const v = nota?.verificacion;
      html += `<h2>${m.funcion ? `<code>${esc(m.funcion.replace(/#\d+$/, ""))}</code>` : "📄 Este archivo"}${v ? `<span class="estado">${ESTADO[v.estado]}</span>` : nota ? '<span class="estado">sin verificar</span>' : ""}</h2>`;
      html += `<div class="sub">${esc(rel)}${nota ? ` · línea ${nota.ancla.linea}` : ""}${nota?.estado === "resuelta" ? " · nota cerrada (si pides algo, se reabre)" : ""} ${this.boton("ir", "Ir")}</div>`;
      // El modo que rige aquí (y de dónde viene); cambiarlo no toca lo ya hecho.
      const cfg = cwd ? leerConfig(cwd) : {};
      const ef = modoEfectivo(cfg, rel, m.funcion);
      const opcion = (v: string, t: string, sel: boolean) => `<option value="${v}"${sel ? " selected" : ""}>${t}</option>`;
      const propio = m.funcion ? cfg.modos?.porFuncion?.[`${rel}:${m.funcion}`] : cfg.modos?.porArchivo?.[rel];
      // Lo que regiría sin un modo propio aquí (para mostrar "heredado (…)").
      const heredado = m.funcion ? modoEfectivo(cfg, rel).modo : modoEfectivo({ ...cfg, modos: { ...cfg.modos, porArchivo: {} } }, rel).modo;
      // Dos ejes: quién escribe (tú / la IA, construyendo juntos) y cuánta ayuda (sugerir / aprender).
      const quien = (e: string) => (e === "ia" ? "la IA" : "tú");
      const propioOk = esModo(propio) ? propio : undefined;
      html += `<div class="sub">${m.funcion ? "Esta función" : "Este archivo"} · ¿Quién escribe? <select data-cmd="modoEje">${opcion("heredar", `heredado (${quien(MODOS[heredado].escribe)})`, !propioOk)}${opcion("escribe:manual", "✍ Tú", MODOS[propioOk ?? heredado].escribe === "manual" && !!propioOk)}${opcion("escribe:ia", "🤖 La IA (construir juntos)", MODOS[propioOk ?? heredado].escribe === "ia" && !!propioOk)}</select> · Ayuda: <select data-cmd="modoEje">${opcion("ayuda:sugerir", "💡 Sugerir", ef.c.ayuda === "sugerir")}${opcion("ayuda:aprender", "🎓 Aprender", ef.c.ayuda === "aprender")}</select> <span class="quien">· rige: ${esc(MODOS[ef.modo].etiqueta)} (por ${{ funcion: "esta función", archivo: "el archivo", carpeta: "la carpeta", proyecto: "el proyecto" }[ef.origen]})</span></div>`;
      if (ocupado) html += `<div class="pensando">⏳ pensando…${this.vivo ? `<div class="msg">${esc(this.vivo).replace(/\n/g, "<br>")}</div>` : ""}</div>`;
      // Impacto (sin IA): una función que esta usa cambió.
      if (nota?.impacto?.length) html += `<div class="accion">⚠ Cambió ${nota.impacto.map((i) => `<code>${esc(i.funcion)}</code>`).join(", ")}, que esta función usa: revisa si sigue bien (✅ ¿Quedó lista? lo limpia).</div>`;
      if (nota?.accion) html += `<div class="accion"><b>▶ Qué hacer:</b> ${esc(nota.accion)}</div>`;
      // Lo único que esta nota dice de otras funciones: cuáles usa y aún no están listas (sin IA).
      if (nota?.dependencias?.length)
        html += `<div class="sub">${nota.dependencias.map((d) => `⏳ Usa <code>${esc(d.funcion.replace(/#\d+$/, ""))}</code>${d.archivo !== rel ? ` (${esc(d.archivo)})` : ""}: aún no está lista (${esc(d.estado)}). ${this.boton("verNota", "Ver su nota", `${d.archivo}::${d.funcion}`)}`).join("<br>")}</div>`;
      // La guía de la línea (texto completo; en el editor puede verse recortada).
      if (guiaActual.texto && guiaActual.uri === m.uri) html += `<div class="sub">💡 Guía actual (línea ${(guiaActual.linea ?? 0) + 1}): ${esc(guiaActual.texto)}</div>`;
      // Decisiones de esta función o archivo: pendientes con un botón por opción; vigentes, con quién decidió.
      if (cwd) {
        const ds = leerDecisiones(cwd).filter((d) => d.alcance.archivo === rel && (m.funcion ? d.alcance.funcion === m.funcion : !d.alcance.funcion) && d.estado !== "retractada");
        for (const d of ds.filter((x) => x.estado === "pendiente"))
          html += `<div class="accion"><b>❓ Decide:</b> ${esc(d.pregunta)}<div class="botones">${d.opciones
            .map((o) => this.boton("decidir", `${o.opcion === d.recomendada ? "⭐ " : ""}${esc(o.opcion)}`, `${d.id}::${o.opcion}`) + (o.consecuencia ? `<span class="quien"> ${esc(o.consecuencia)}</span>` : ""))
            .join("<br>")}<br>${this.boton("decidirOtra", "Otra… (escríbela abajo y pulsa)", d.id)}</div></div>`;
        const vig = ds.filter((x) => x.estado === "vigente");
        if (vig.length) html += `<div class="sub">Decidido: ${vig.map((d) => `${esc(d.pregunta)} → <b>${esc(d.eleccion ?? "")}</b>`).join(" · ")} <span class="quien">(se cambia o retracta en el panel → Proyecto → Decisiones)</span></div>`;
      }
      // 🎯 Objetivo de la función (o del archivo): qué debe hacer y cuándo está terminada; lo confirmas tú.
      if (nota?.objetivo) {
        const o = nota.objetivo;
        html += `<div class="accion"><b>🎯 Objetivo</b> <span class="quien">${o.terminada ? "🏁 terminada" : o.confirmado ? "✓ confirmado por ti" : "borrador: confírmalo o corrígelo abajo"}</span><div>${esc(o.texto)}</div>${o.criterios.length ? `<ul>${o.criterios.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}<div class="botones">${!o.confirmado ? this.boton("objetivo", "✓ Confirmar objetivo", "confirmar", { prim: true, off: ocupado }) : ""}${o.confirmado && !o.terminada && v?.estado === "lista" ? this.boton("objetivo", "🏁 Dar por terminada", "terminado", { prim: true, off: ocupado }) : ""}${o.confirmado ? this.boton("objetivo", "↺ Reabrir", "reabrir", { off: ocupado }) : ""}</div></div>`;
      }
      // Modo programar: plan de pasos, tú diriges / como un PR (por porciones con el probador), y la propuesta.
      if (m.funcion && cwd && MODOS[ef.modo].proponerSolucion) html += this.bloqueProgramar(cwd, rel, m.funcion, nota, ocupado);
      // Tests de esta función: el resultado de la última prueba (al pedirlos o al guardar con Ctrl+S).
      if (nota?.ultimaPrueba) {
        const u = nota.ultimaPrueba;
        const icono: Record<string, string> = { pasa: "✅", falla: "❌", decidir: "❓", "no-ejecutable": "⚠️" };
        const hace = Math.round((Date.now() - Date.parse(u.fecha)) / 1000);
        const cuando = hace < 90 ? `hace ${hace} s` : new Date(u.fecha).toLocaleTimeString();
        const filas = u.detalle
          .map((d) => `<div>${icono[d.estado] ?? "·"} ${esc(d.descripcion)} <span class="quien"><code>${esc(d.llamada)}</code> → esperado <code>${esc(d.esperado || "error")}</code>${d.obtenido && d.estado !== "pasa" ? `, obtuvo <code>${esc(d.obtenido.slice(0, 80))}</code>` : ""}</span></div>`)
          .join("");
        html += `<details class="accion"${u.fallan ? " open" : ""}><summary><b>🧪 Tests</b> (${cuando}): ${u.pasan} ✅ · ${u.fallan} ❌${nota.testsProbados?.archivo ? ` · <code>${esc(nota.testsProbados.archivo)}</code>` : ""}</summary>${filas}</details>`;
      }
      // Lo que ya se dio no se vuelve a ofrecer (queda en el historial); "Más ayuda" pide el escalón que falta.
      const dados = new Set(nota?.dados ?? []);
      const botones = BOTONES.filter((b) => (m.funcion ? b.pedido !== "plano" : b.pedido !== "tests") && !dados.has(b.pedido)).map((b) => this.boton("pedir", b.etiqueta, b.pedido, { off: ocupado }));
      if (["pista", "piezas", "pseudo", "ejemplo"].some((e) => dados.has(e))) botones.unshift(this.boton("pedir", "➕ Más ayuda", "mas", { off: ocupado }));
      botones.push(this.boton("verificar", m.funcion ? "✅ ¿Quedó lista?" : "🔎 Revisar archivo", undefined, { prim: true, off: ocupado }));
      if (!nota?.objetivo) botones.push(this.boton("entender", "🎯 Objetivo", undefined, { off: ocupado }));
      if (m.funcion && MODOS[ef.modo].predecir) botones.push(this.boton("predecir", "🎯 Predecir", undefined, { off: ocupado }));
      if (nota) nota.snippets.forEach((s, i) => botones.push(this.boton("insertar", `⤵ Insertar <code>${esc(s.llamada.split(/\s/)[0]!)}</code>`, i, { off: ocupado })));
      if (nota && nota.estado === "abierta") botones.push(this.boton("resolver", "✓ Resuelta", undefined, { off: ocupado }));
      html += `<div class="botones">${botones.join("")}</div>`;
      if (!nota) html += `<p class="vacio">${m.funcion ? `<code>${esc(m.funcion)}</code> todavía no tiene nota.` : "El archivo no tiene nota general."} Pide ayuda con un botón o escríbele abajo.</p>`;
      else {
        // Resumen arriba (lo último que dijo la IA) + historial de pedidos (qué y cuándo), cada uno plegable.
        if (nota.explicacion) html += `<div class="accion"><b>Tu explicación</b> ${nota.explicacion.coincide ? "✓ coincide con el código" : "✗ no coincide del todo"}: “${esc(nota.explicacion.texto)}”${nota.explicacion.comentario ? `<div class="quien">${esc(nota.explicacion.comentario)}</div>` : ""}</div>`;
        const turnos = turnosDe(nota.hilo);
        const ultimaIa = [...nota.hilo].reverse().find((x) => x.quien === "ia");
        if (ultimaIa) {
          const corto = resumenMd(ultimaIa.texto);
          html += `<div class="ultimo"><div class="quien">Lo último (${esc(etiquetaKind(ultimaIa.meta?.kind))} · ${cuando(ultimaIa.fecha)}${metaDe(ultimaIa)})</div>${await this.md(corto)}${corto !== ultimaIa.texto ? `<details><summary>ver todo</summary>${await this.md(ultimaIa.texto)}</details>` : ""}</div>`;
        }
        if (turnos.length) {
          html += `<div class="historial"><div class="quien"><b>Historial</b></div>`;
          for (const t of [...turnos].reverse()) {
            const cuerpo = (await Promise.all(t.mensajes.map(async (x) => `<div class="msg"><div class="quien">${x.quien === "ia" ? `${ICONO[nota.tipo] ?? "📝"} ComplementAIry` : "Tú"} · ${cuando(x.fecha)}${metaDe(x)}</div>${await this.md(x.texto)}</div>`))).join("");
            html += `<details class="turno"><summary><span>${t.humano ? "🙋" : "🤖"} ${esc(t.titulo)}</span><span class="quien">${cuando(t.fecha)}${t.resultado ? ` · ${esc(t.resultado)}` : ""}</span></summary>${cuerpo}</details>`;
          }
          html += "</div>";
        }
      }
      const nombre = m.funcion?.replace(/#\d+$/, "");
      caja = m.funcion && MODOS[ef.modo].proponerSolucion
        ? {
            placeholder: `Pregúntale sobre ${nombre} o la porción de arriba (¿por qué así?, ¿qué pasa si…?); para cambiarla usa ✎ en la porción`,
            botones: [{ cmd: "texto", texto: "Preguntar" }, { cmd: "entender", texto: "🎯 Objetivo" }],
            ocupado,
          }
        : nota?.objetivo && !nota.objetivo.confirmado && m.funcion
          ? { placeholder: `Corrige o completa el objetivo de ${nombre} (o responde sus preguntas)`, botones: [{ cmd: "entender", texto: "🎯 Enviar" }, { cmd: "texto", texto: "Preguntar otra cosa" }], ocupado }
          : MODOS[ef.modo].explicar && m.funcion
        ? { placeholder: `Escríbele sobre ${nombre}, o explica con tus palabras qué hace y verifica`, botones: [{ cmd: "texto", texto: "Enviar" }, { cmd: "verificarExplicando", texto: "✅ Verificar con mi explicación" }], ocupado }
        : { placeholder: m.funcion ? `Escríbele sobre ${nombre} (Enter envía; también !pista, !pseudo…)` : "Pregunta sobre el archivo (Enter envía)", botones: [{ cmd: "texto", texto: "Enviar" }], ocupado };
    } else if (m.tipo === "tarea") {
      const t = m.tarea;
      const origen = { estructura: "de la estructura del proyecto", panorama: "del panorama", plano: "del plano del archivo", manual: "" }[t.origen ?? "manual"] ?? "";
      html += `<h2>${t.hecha ? "☑" : "☐"} ${esc(t.titulo)}</h2><div class="sub">Tarea ${esc(origen)}${t.archivo ? ` · <code>${esc(t.archivo)}</code>` : ""}</div>`;
      if (t.detalle) html += `<div class="md">${await this.md(t.detalle)}</div>`;
      const cwd = root(vscode.window.activeTextEditor?.document);
      const falta = !!(t.archivo && cwd && !fs.existsSync(path.join(cwd, t.archivo)));
      html += `<div class="botones">${t.archivo ? this.boton("ir", falta && t.crear ? "📄 Crear archivo" : "Ir al archivo", undefined, { prim: true }) : ""}${t.hecha ? "" : this.boton("hecha", "✓ Hecha")}${this.boton("descartar", "✕ Descartar")}</div>`;
    } else if (m.tipo === "pregunta") {
      const q = m.pregunta;
      const ocupado = this.pensando.has("pregunta");
      html += `<h2>❓ ${esc(q.pregunta)}</h2>`;
      if (q.sugerencia) html += `<div class="accion"><b>Sugerencia:</b> ${esc(q.sugerencia)}</div>`;
      html += '<div class="sub">Tu respuesta queda en la memoria del proyecto y se usa en todas las sugerencias. ¿No queda clara? Pregúntale abajo.</div>';
      for (const x of q.dialogo ?? []) html += `<div class="msg"><div class="quien">${x.quien === "ia" ? "ComplementAIry" : "Tú"}</div>${await this.md(x.texto)}</div>`;
      if (ocupado) html += '<div class="pensando">⏳ pensando…</div>';
      caja = {
        placeholder: q.sugerencia ? `Tu respuesta (p. ej.: ${q.sugerencia}) o tu duda` : "Tu respuesta o tu duda",
        botones: [
          { cmd: "responder", texto: "Responder" },
          { cmd: "conversar", texto: "Preguntarle" },
        ],
        ocupado,
      };
    } else html = '<p class="vacio">Pon el cursor en una función para ver su nota, o elige algo en el panel.</p>';
    if (gen !== this.generacion) return;
    void this.view.webview.postMessage({ html, caja, clave: m.tipo === "funcion" ? `${m.uri}#${m.funcion ?? ""}` : m.tipo });
  }
}

// --- Historial de la nota: "qué pediste y cuándo" ------------------------------------------------

type Msg = Nota["hilo"][number];
// Se arma al usarla (no al cargar el módulo): notaView y notasView se importan entre sí, y al cargar
// este archivo BOTONES todavía puede no existir (eso tumbaba la activación de la extensión).
let etiquetasPedido: Record<string, string> | undefined;
const ETIQUETA_PEDIDO = (): Record<string, string> =>
  (etiquetasPedido ??= Object.fromEntries([...BOTONES.map((b) => [b.pedido, b.etiqueta.replace(/^\S+\s/, "")]), ["mas", "Más ayuda"], ["lista", "¿Quedó lista?"], ["ayuda", "Ayuda"]]));
const ETIQUETA_KIND: Record<string, string> = { verificar: "¿Quedó lista?", revisar: "Revisión", acompanar: "Revisión al guardar", tests: "Tests", impacto: "Aviso de impacto", responder: "Respuesta", plano: "Plano", predecir: "Predicción" };

export function etiquetaKind(kind?: string): string {
  return (kind && (ETIQUETA_KIND[kind] ?? ETIQUETA_PEDIDO()[kind])) || "Respuesta";
}

/** "hoy 11:05", "ayer 18:20" o "9 oct 10:00". */
export function cuando(fecha: string): string {
  const d = new Date(fecha);
  const hora = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dia = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dif = Math.round((dia(new Date()) - dia(d)) / 86_400_000);
  return dif === 0 ? `hoy ${hora}` : dif === 1 ? `ayer ${hora}` : `${d.toLocaleDateString([], { day: "numeric", month: "short" })} ${hora}`;
}

const metaDe = (x: Msg) => (x.meta?.modelo || x.meta?.costo !== undefined ? ` · ${x.meta.modelo ? esc(x.meta.modelo.replace(/^claude-/, "")) : ""}${x.meta.costo !== undefined ? ` · US$${x.meta.costo.toFixed(3)}` : ""}` : "");

/** Lo principal de una respuesta: hasta 4 líneas con contenido (el resto, en "ver todo"). */
export function resumenMd(texto: string): string {
  const lineas = texto.split("\n");
  const out: string[] = [];
  let n = 0;
  for (const l of lineas) {
    if (/^\s*(---|```)/.test(l)) break; // no cortar a mitad de un bloque: hasta el primer separador
    out.push(l);
    if (l.trim() && ++n >= 4) break;
  }
  return out.join("\n").trim() || texto;
}

/** Agrupa el hilo en turnos: un pedido tuyo con sus respuestas, o algo automático de la IA. */
export function turnosDe(hilo: Msg[]): { humano: boolean; titulo: string; fecha: string; resultado: string; mensajes: Msg[] }[] {
  const out: { humano: boolean; titulo: string; fecha: string; resultado: string; mensajes: Msg[] }[] = [];
  for (const x of hilo) {
    if (x.quien === "tu") {
      const p = x.meta?.pedido;
      const titulo = p && p !== "pregunta" && ETIQUETA_PEDIDO()[p] ? ETIQUETA_PEDIDO()[p] : `“${x.texto.replace(/^Pido:\s*/, "").replace(/\s+/g, " ").slice(0, 42)}${x.texto.length > 42 ? "…" : ""}”`;
      out.push({ humano: true, titulo, fecha: x.fecha, resultado: "", mensajes: [x] });
    } else {
      const ult = out[out.length - 1];
      // Una respuesta se suma al pedido anterior si es su respuesta (mismo turno); si no, es algo automático.
      if (ult?.humano && ult.mensajes.length === 1) ult.mensajes.push(x);
      else out.push({ humano: false, titulo: etiquetaKind(x.meta?.kind), fecha: x.fecha, resultado: "", mensajes: [x] });
      const t = out[out.length - 1]!;
      t.resultado = resultadoCorto(x.texto);
    }
  }
  return out;
}

/** El resultado en pocas palabras: el veredicto (🟢/🟡/🔴), un conteo de tests o la primera frase. */
function resultadoCorto(texto: string): string {
  const v = /^\*\*(🟢|🟡|🔴) ([^*]+)\*\*/.exec(texto);
  if (v) return `${v[1]} ${v[2]!.toLowerCase()}`;
  const t = /(\d+) ✅[^\d]*(\d+) ❌/.exec(texto);
  if (t) return `${t[1]}✅ ${t[2]}❌`;
  const plano = texto.replace(/\*\*[^*]*\*\*\s*·?\s*/, "").replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim();
  return plano.length > 40 ? `${plano.slice(0, 40)}…` : plano;
}
