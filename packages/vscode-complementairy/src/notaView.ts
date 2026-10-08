import fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import { claveDeSimbolo, correr, mostrarError, notasDe, relDe, root, vista, type Nota } from "./comun";
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
      this.notas.onPensando((p) => {
        const k = `${p.uri}#${p.id ?? "nueva"}`;
        if (p.activo) this.pensando.add(k);
        else this.pensando.delete(k);
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
          if (modo.funcion) return this.notas.verificar(doc, modo.funcion, nota?.id);
          return void vscode.commands.executeCommand("cai.revisar");
        case "insertar":
          if (nota) return void vscode.commands.executeCommand("cai.nota.insertar", doc.uri.toString(), nota.id, Number(arg));
          return;
        case "resolver":
          if (nota) await vscode.commands.executeCommand("cai.nota.resolver", doc.uri.toString(), nota.id);
          return;
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
#caja{position:sticky;bottom:0;background:var(--vscode-sideBar-background);padding-top:6px}
textarea{width:100%;box-sizing:border-box;min-height:52px;resize:vertical;font:inherit;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,transparent);padding:4px}
.fila{display:flex;gap:4px;justify-content:flex-end;margin-top:4px}
code{font-family:var(--vscode-editor-font-family)}
</style></head><body>
<div id="contenido"><p class="vacio">Pon el cursor en una función para ver su nota.</p></div>
<div id="caja" hidden><textarea id="texto" placeholder=""></textarea><div class="fila" id="acciones"></div></div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const caja = document.getElementById("caja"), texto = document.getElementById("texto"), acciones = document.getElementById("acciones");
let principal = null;
window.addEventListener("message", (e) => {
  const d = e.data;
  document.getElementById("contenido").innerHTML = d.html;
  caja.hidden = !d.caja;
  if (d.caja) {
    texto.placeholder = d.caja.placeholder;
    texto.disabled = !!d.caja.ocupado;
    acciones.innerHTML = d.caja.botones.map((b, i) => '<button data-envio="' + b.cmd + '"' + (i === 0 ? ' class="prim"' : '') + (d.caja.ocupado ? ' disabled' : '') + '>' + b.texto + '</button>').join("");
    principal = d.caja.botones[0] && d.caja.botones[0].cmd;
    if (d.caja.limpiar) texto.value = "";
  }
});
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-cmd]");
  if (b && !b.disabled && !b.closest(".msg, .md")) { vscode.postMessage({ cmd: b.dataset.cmd, arg: b.dataset.arg }); return; }
  const env = e.target.closest("[data-envio]");
  if (env && !env.disabled && texto.value.trim()) { vscode.postMessage({ cmd: env.dataset.envio, arg: texto.value }); texto.value = ""; return; }
  const a = e.target.closest("a[href]");
  if (a) { e.preventDefault(); vscode.postMessage({ cmd: "link", arg: a.getAttribute("href") }); }
});
texto.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && principal && texto.value.trim()) { e.preventDefault(); vscode.postMessage({ cmd: principal, arg: texto.value }); texto.value = ""; }
});
</script></body></html>`;
  }

  /** Markdown → HTML, y luego solo etiquetas de texto (sin atributos salvo href http/https): lo que viene de la IA o de archivos no puede inyectar botones, estilos ni imágenes. */
  private async md(texto: string): Promise<string> {
    try {
      return sanear(await vscode.commands.executeCommand<string>("markdown.api.render", texto));
    } catch {
      return `<p>${esc(texto).replace(/\n/g, "<br>")}</p>`;
    }
  }

  private boton(cmd: string, texto: string, arg?: string | number, o: { prim?: boolean; off?: boolean } = {}): string {
    return `<button data-cmd="${cmd}"${arg !== undefined ? ` data-arg="${esc(String(arg))}"` : ""}${o.prim ? ' class="prim"' : ""}${o.off ? " disabled" : ""}>${texto}</button>`;
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
      if (ocupado) html += '<div class="pensando">⏳ pensando…</div>';
      if (nota?.accion) html += `<div class="accion"><b>▶ Qué hacer:</b> ${esc(nota.accion)}</div>`;
      const botones = BOTONES.filter((b) => (m.funcion ? b.pedido !== "plano" : b.pedido !== "tests")).map((b) => this.boton("pedir", b.etiqueta, b.pedido, { off: ocupado }));
      botones.push(this.boton("verificar", m.funcion ? "✅ ¿Quedó lista?" : "🔎 Revisar archivo", undefined, { prim: true, off: ocupado }));
      if (nota) nota.snippets.forEach((s, i) => botones.push(this.boton("insertar", `⤵ Insertar <code>${esc(s.llamada.split(/\s/)[0]!)}</code>`, i, { off: ocupado })));
      if (nota && nota.estado === "abierta") botones.push(this.boton("resolver", "✓ Resuelta", undefined, { off: ocupado }));
      html += `<div class="botones">${botones.join("")}</div>`;
      if (!nota) html += `<p class="vacio">${m.funcion ? `<code>${esc(m.funcion)}</code> todavía no tiene nota.` : "El archivo no tiene nota general."} Pide ayuda con un botón o escríbele abajo.</p>`;
      else {
        // Lo más nuevo arriba; lo viejo, plegado.
        const msgs = [...nota.hilo].reverse();
        const render = async (x: Nota["hilo"][number]) => `<div class="msg"><div class="quien">${x.quien === "ia" ? `${ICONO[nota.tipo] ?? "📝"} ComplementAIry` : "Tú"} · ${new Date(x.fecha).toLocaleString()}</div>${await this.md(x.texto)}</div>`;
        for (const x of msgs.slice(0, 3)) html += await render(x);
        if (msgs.length > 3) {
          html += `<details><summary>${msgs.length - 3} mensaje(s) anteriores</summary>`;
          for (const x of msgs.slice(3)) html += await render(x);
          html += "</details>";
        }
      }
      caja = { placeholder: m.funcion ? `Escríbele sobre ${m.funcion} (Enter envía; también !pista, !pseudo…)` : "Pregunta sobre el archivo (Enter envía)", botones: [{ cmd: "texto", texto: "Enviar" }], ocupado };
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
    void this.view.webview.postMessage({ html, caja });
  }
}
