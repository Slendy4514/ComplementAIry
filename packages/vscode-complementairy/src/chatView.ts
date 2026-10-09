import fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import { correr, dataDir, leerDecisiones, mostrarError, root } from "./comun";
import { sanear } from "./notaView";

/**
 * Chat "Proyecto": preguntas generales fuera de cualquier archivo ("¿por dónde sigo?", "¿qué falta
 * para terminar?"). La IA lee el proyecto (solo lectura) y conoce la estructura, el panorama, el índice
 * de funciones y tus decisiones. Sus respuestas pueden traer decisiones (botones) y tareas (➕).
 */

interface MensajeChat {
  quien: "tu" | "ia";
  texto: string;
  fecha: string;
  decisiones?: string[];
  tareas?: { titulo: string; archivo: string; detalle: string }[];
  costo?: number;
}

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export class ChatView implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private pensando = false;
  private vivo = "";

  registrar(ctx: vscode.ExtensionContext): void {
    const w = vscode.workspace.createFileSystemWatcher("**/{.cai,.aicode}/cache/en-vivo/chat.txt");
    const leer = (u: vscode.Uri) => {
      try {
        this.vivo = fs.readFileSync(u.fsPath, "utf8");
      } catch {
        this.vivo = "";
      }
      void this.render();
    };
    w.onDidChange(leer);
    w.onDidCreate(leer);
    ctx.subscriptions.push(w, vscode.window.registerWebviewViewProvider("cai.chat", this, { webviewOptions: { retainContextWhenHidden: true } }));
  }

  resolveWebviewView(v: vscode.WebviewView): void {
    this.view = v;
    v.webview.options = { enableScripts: true };
    const nonce = Math.random().toString(36).slice(2);
    v.webview.html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${v.webview.cspSource} 'unsafe-inline'; img-src ${v.webview.cspSource} data:; script-src 'nonce-${nonce}';">
<style>
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);padding:0 10px 10px;line-height:1.45}
.msg{padding:6px 0;border-top:1px solid var(--vscode-widget-border,rgba(128,128,128,.25))}
.tu{color:var(--vscode-descriptionForeground)}
.quien{font-size:.8em;color:var(--vscode-descriptionForeground)}
.caja{border-left:3px solid var(--vscode-focusBorder);padding:4px 8px;margin:6px 0;background:var(--vscode-textBlockQuote-background)}
button{font:inherit;border:0;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border-radius:3px;padding:3px 8px;margin:2px;cursor:pointer}
button.prim{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
#entrada{position:sticky;bottom:0;background:var(--vscode-sideBar-background);padding-top:6px}
textarea{width:100%;box-sizing:border-box;min-height:52px;font:inherit;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,transparent);padding:4px}
.fila{display:flex;gap:4px;justify-content:space-between;margin-top:4px}
code{font-family:var(--vscode-editor-font-family)}
</style></head><body>
<div id="contenido"></div>
<div id="entrada"><textarea id="t" placeholder="Pregunta sobre el proyecto (Enter envía): ¿por dónde sigo? ¿qué falta? ¿cómo encaja X?"></textarea>
<div class="fila"><span><button data-cmd="sesion">📝 Resumen de la sesión</button><button data-cmd="limpiar">Limpiar</button></span><button class="prim" id="enviar">Enviar</button></div></div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const t = document.getElementById("t");
window.addEventListener("message", (e) => { document.getElementById("contenido").innerHTML = e.data.html; t.disabled = !!e.data.ocupado; window.scrollTo(0, document.body.scrollHeight); });
const enviar = () => { if (t.value.trim()) { vscode.postMessage({ cmd: "enviar", arg: t.value }); t.value = ""; } };
document.getElementById("enviar").addEventListener("click", enviar);
t.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } });
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-cmd]");
  if (b && !b.closest(".md")) { vscode.postMessage({ cmd: b.dataset.cmd, arg: b.dataset.arg }); return; }
  const a = e.target.closest("a[href]");
  if (a) { e.preventDefault(); vscode.postMessage({ cmd: "link", arg: a.getAttribute("href") }); }
});
</script></body></html>`;
    v.webview.onDidReceiveMessage((m: { cmd: string; arg?: string }) => void this.recibir(m).catch(mostrarError));
    v.onDidChangeVisibility(() => v.visible && void this.render());
    void this.render();
  }

  private cwd(): string | undefined {
    return root(vscode.window.activeTextEditor?.document);
  }

  private async recibir(m: { cmd: string; arg?: string }): Promise<void> {
    const cwd = this.cwd();
    if (!cwd) return;
    if (m.cmd === "link" && m.arg && /^https?:/.test(m.arg)) return void vscode.env.openExternal(vscode.Uri.parse(m.arg));
    if (m.cmd === "enviar" && m.arg?.trim()) {
      this.extra = ""; // el resumen de sesión anterior queda atrás
      this.pensando = true;
      this.vivo = "";
      await this.render(m.arg.trim());
      try {
        await correr(["chat", "--texto", m.arg.trim(), "--json"], cwd);
      } finally {
        this.pensando = false;
        this.vivo = "";
        await this.render();
        void vscode.commands.executeCommand("cai.panel.refrescar");
      }
    } else if (m.cmd === "limpiar") {
      await correr(["chat", "--limpiar"], cwd);
      this.extra = "";
      await this.render();
    } else if (m.cmd === "sesion") {
      this.pensando = true;
      await this.render("📝 Resumen de la sesión");
      try {
        const r = JSON.parse(await correr(["sesion", "--json"], cwd)) as { medido: string; resumen: string; commit: string };
        this.extra = `<div class="msg"><div class="quien">📝 Resumen de la sesión</div><pre>${esc(r.medido)}</pre>${r.resumen ? `<div class="caja">${esc(r.resumen).replace(/\n/g, "<br>")}</div>` : ""}${r.commit ? `<div class="quien">Commit sugerido (edítalo; lo haces tú):</div><pre>${esc(r.commit)}</pre><button data-cmd="copiar" data-arg="${esc(r.commit)}">Copiar</button>` : ""}</div>`;
      } finally {
        this.pensando = false;
        await this.render();
      }
    } else if (m.cmd === "copiar" && m.arg) {
      await vscode.env.clipboard.writeText(m.arg);
      vscode.window.setStatusBarMessage("ComplementAIry: copiado", 3000);
    } else if (m.cmd === "decidir" && m.arg) {
      const sep = m.arg.indexOf("::");
      await correr(["decisiones", "decidir", m.arg.slice(0, sep), m.arg.slice(sep + 2)], cwd);
      await this.render();
      void vscode.commands.executeCommand("cai.panel.refrescar");
    } else if (m.cmd === "tarea" && m.arg) {
      const t = JSON.parse(m.arg) as { titulo: string; archivo: string; detalle: string };
      await correr(["tareas", "agregar", t.titulo, ...(t.archivo ? ["--archivo", t.archivo] : []), ...(t.detalle ? ["--detalle", t.detalle] : [])], cwd);
      vscode.window.setStatusBarMessage(`ComplementAIry: tarea agregada (${t.titulo})`, 4000);
      void vscode.commands.executeCommand("cai.panel.refrescar");
    }
  }

  private extra = "";

  private async render(pendiente?: string): Promise<void> {
    if (!this.view?.visible) return;
    const cwd = this.cwd();
    if (!cwd) return void this.view.webview.postMessage({ html: '<p class="quien">Abre un proyecto.</p>' });
    let mensajes: MensajeChat[] = [];
    try {
      mensajes = (JSON.parse(fs.readFileSync(path.join(dataDir(cwd), "chat.json"), "utf8")) as { mensajes: MensajeChat[] }).mensajes ?? [];
    } catch {
      /* sin chat todavía */
    }
    const ds = leerDecisiones(cwd);
    let html = mensajes.length ? "" : '<p class="quien">Pregúntale sobre el proyecto: conoce la estructura, el panorama, el estado de cada función y tus decisiones.</p>';
    for (const m of mensajes) {
      if (m.quien === "tu") {
        html += `<div class="msg tu"><b>Tú:</b> ${esc(m.texto)}</div>`;
        continue;
      }
      const cuerpo = sanear(await vscode.commands.executeCommand<string>("markdown.api.render", m.texto).then((x) => x, () => esc(m.texto)));
      // Botones FUERA del markdown (dentro de él, los clics se ignoran: el texto viene de la IA).
      let botones = "";
      for (const id of m.decisiones ?? []) {
        const d = ds.find((x) => x.id === id);
        if (!d) continue;
        botones +=
          d.estado === "pendiente"
            ? `<div class="caja"><b>❓ ${esc(d.pregunta)}</b><br>${d.opciones.map((o) => `<button data-cmd="decidir" data-arg="${esc(`${d.id}::${o.opcion}`)}">${o.opcion === d.recomendada ? "⭐ " : ""}${esc(o.opcion)}</button>`).join("")}</div>`
            : `<div class="caja">✓ ${esc(d.pregunta)} → <b>${esc(d.eleccion ?? "(retractada)")}</b></div>`;
      }
      for (const t of m.tareas ?? []) botones += `<div class="caja">${esc(t.titulo)}${t.archivo ? ` <span class="quien">(${esc(t.archivo)})</span>` : ""} <button data-cmd="tarea" data-arg="${esc(JSON.stringify(t))}">➕ Agregar tarea</button></div>`;
      html += `<div class="msg"><div class="quien">ComplementAIry${m.costo !== undefined ? ` · US$${m.costo.toFixed(3)}` : ""}</div><div class="md">${cuerpo}</div>${botones}</div>`;
    }
    if (pendiente) html += `<div class="msg tu"><b>Tú:</b> ${esc(pendiente)}</div>`;
    html += this.extra;
    if (this.pensando) html += `<div class="msg"><div class="quien">⏳ pensando…</div>${this.vivo ? esc(this.vivo).replace(/\n/g, "<br>") : ""}</div>`;
    void this.view.webview.postMessage({ html, ocupado: this.pensando });
  }
}
