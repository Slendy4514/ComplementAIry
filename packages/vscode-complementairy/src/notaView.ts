import fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import { claveDeSimbolo, correr, guiaActual, leerConfig, leerDecisiones, leerPropuesta, modoEfectivo, MODOS, mostrarError, notasDe, relDe, root, vista, type Nota } from "./comun";
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
          return this.programarAccion(m.cmd, arg, doc, nota);
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
.ultimo{border-left:3px solid var(--vscode-focusBorder);padding:2px 8px;margin:8px 0}
.historial{margin-top:10px;border-top:1px solid var(--vscode-widget-border,rgba(128,128,128,.25));padding-top:4px}
details.turno>summary{display:flex;justify-content:space-between;gap:8px;color:var(--vscode-foreground);margin:3px 0}
details.turno>summary span.quien{white-space:nowrap}
#caja{position:sticky;bottom:0;background:var(--vscode-sideBar-background);padding-top:6px}
select{font:inherit;color:var(--vscode-dropdown-foreground);background:var(--vscode-dropdown-background);border:1px solid var(--vscode-dropdown-border,transparent)}
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
texto.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && principal && texto.value.trim()) { e.preventDefault(); vscode.postMessage({ cmd: principal, arg: texto.value }); texto.value = ""; }
});
</script></body></html>`;
  }

  // --- Modo programar y objetivo (todo pasa por la CLI; el código entra a tu archivo SOLO aquí, con tu clic) ---

  private bloqueProgramar(cwd: string, rel: string, funcion: string, nota: Nota | undefined, ocupado: boolean): string {
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
    if (p.porciones?.some((x) => !x.aprobada) && leerConfig(cwd).programar?.prediccionObligatoria !== false)
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
      const ok = await vscode.window.showInformationMessage(`¿Reemplazar ${funcion.replace(/#\d+$/, "")} por la propuesta (${p.porciones?.length ?? 1} porción(es))?`, { modal: true }, "Reemplazar", "Ver diff primero");
      if (ok === "Ver diff primero") {
        const b = await vscode.workspace.openTextDocument({ content: p.codigo, language: doc.languageId });
        const a = await vscode.workspace.openTextDocument({ content: doc.getText(s.range), language: doc.languageId });
        return void vscode.commands.executeCommand("vscode.diff", a.uri, b.uri, "Tu función ↔ propuesta");
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
      // El modo que rige aquí (y de dónde viene); cambiarlo no toca lo ya hecho.
      const cfg = cwd ? leerConfig(cwd) : {};
      const ef = modoEfectivo(cfg, rel, m.funcion);
      const opcion = (v: string, t: string, sel: boolean) => `<option value="${v}"${sel ? " selected" : ""}>${t}</option>`;
      const propio = m.funcion ? cfg.modos?.porFuncion?.[`${rel}:${m.funcion}`] : cfg.modos?.porArchivo?.[rel];
      // Lo que regiría sin un modo propio aquí (para mostrar "heredado (…)").
      const heredado = m.funcion ? modoEfectivo(cfg, rel).modo : modoEfectivo({ ...cfg, modos: { ...cfg.modos, porArchivo: {} } }, rel).modo;
      html += `<div class="sub">Modo ${m.funcion ? "de esta función" : "de este archivo"}: <select data-cmd="modo">${opcion("heredar", `heredado (${heredado})`, !propio)}${["sugerir", "aprender", "programar"].map((k) => opcion(k, k, propio === k)).join("")}</select> <span class="quien">· rige: ${ef.modo} (por ${{ funcion: "esta función", archivo: "el archivo", carpeta: "la carpeta", proyecto: "el proyecto" }[ef.origen]})</span></div>`;
      if (ocupado) html += `<div class="pensando">⏳ pensando…${this.vivo ? `<div class="msg">${esc(this.vivo).replace(/\n/g, "<br>")}</div>` : ""}</div>`;
      // Impacto (sin IA): una función que esta usa cambió.
      if (nota?.impacto?.length) html += `<div class="accion">⚠ Cambió ${nota.impacto.map((i) => `<code>${esc(i.funcion)}</code>`).join(", ")}, que esta función usa: revisa si sigue bien (✅ ¿Quedó lista? lo limpia).</div>`;
      if (nota?.accion) html += `<div class="accion"><b>▶ Qué hacer:</b> ${esc(nota.accion)}</div>`;
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
      const siguiente = nota?.plan?.pasos.findIndex((p) => !p.hecho) ?? -1;
      caja = m.funcion && MODOS[ef.modo].proponerSolucion
        ? {
            placeholder: siguiente >= 0 ? `Paso ${siguiente + 1}: ${nota!.plan!.pasos[siguiente]!.texto} — dime en palabras CÓMO hacerlo (la IA escribe solo eso)` : `Dime en palabras el siguiente paso de ${nombre} (la IA escribe solo eso), o pregúntale`,
            botones: [{ cmd: "paso", texto: `🧭 Escribir ${siguiente >= 0 ? `el paso ${siguiente + 1}` : "este paso"}` }, { cmd: "texto", texto: "Preguntar" }, { cmd: "entender", texto: "🎯 Objetivo" }],
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
    void this.view.webview.postMessage({ html, caja });
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
