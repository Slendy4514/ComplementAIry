import fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import { correr, dataDir, leerConfig, leerDecisiones, mostrarError, root, type Decision } from "./comun";
import { tieneCai } from "./iniciar";
import { sanear } from "./notaView";

/**
 * Chat "Proyecto" (fuera de los archivos), en varias conversaciones:
 * - normal: preguntas generales ("¿por dónde sigo?", "voy a implementar X"). Puede proponer decisiones,
 *   cambios de tareas y correcciones de lo que entiende del proyecto: todo se aplica con TU clic.
 * - 🎯 Entender el proyecto: pregunta de a poco (con botones), arma un borrador de objetivos y, cuando
 *   cree que entendió, lo dice; tú lo confirmas o sigues corrigiendo (y puedes reabrirlo después).
 * Eliges qué IA responde en cada conversación. Nunca escribe tu código.
 */

interface MensajeChat {
  id?: string;
  quien: "tu" | "ia";
  texto: string;
  fecha: string;
  decisiones?: string[];
  tareas?: { titulo: string; archivo: string; detalle: string }[];
  cambiosTareas?: { accion: string; id?: string; titulo?: string; archivo?: string; detalle?: string; aplicado?: string }[];
  correcciones?: { tipo: string; archivo: string; antes: string; despues: string; aplicada?: string }[];
  preguntas?: { pregunta: string; opciones: string[] }[];
  creeEntendido?: boolean;
  modelo?: string;
  costo?: number;
}

interface Conversacion {
  id: string;
  titulo: string;
  tipo: "normal" | "entender";
  modelo: "chico" | "mediano" | "grande";
  actualizada: string;
  mensajes: MensajeChat[];
}

interface Objetivos {
  estado: string;
  resumen: string;
  criterios: { id: string; texto: string }[];
  creeEntendido?: boolean;
}

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const MODELOS_DEF = { chico: "claude-haiku-4-5", mediano: "claude-sonnet-5-5", grande: "claude-opus-5-5" };

export class ChatView implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private pensando = false;
  private vivo = "";
  private extra = "";
  /** La conversación abierta (si no, la más reciente). */
  private actual?: string;
  private migrado = false;

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
    // Las conversaciones también cambian desde Claude Code (cai chat): se refresca.
    const wc = vscode.workspace.createFileSystemWatcher("**/{.cai,.aicode}/{chats/*.json,decisiones.json,objetivos.json}");
    for (const ev of [wc.onDidChange, wc.onDidCreate, wc.onDidDelete]) ev(() => !this.pensando && void this.render());
    ctx.subscriptions.push(
      w,
      wc,
      vscode.window.registerWebviewViewProvider("cai.chat", this, { webviewOptions: { retainContextWhenHidden: true } }),
      // Panel → 🎯 Objetivos: abre (o crea) la conversación "Entender el proyecto".
      vscode.commands.registerCommand("cai.chat.entender", async (o?: { empezar?: boolean }) => {
        const cwd = this.cwd();
        if (!cwd) return;
        const c = this.conversaciones(cwd).find((x) => x.tipo === "entender");
        this.actual = c?.id ?? (JSON.parse(await correr(["chat", "--nueva", "--entender", "--json"], cwd)) as Conversacion).id;
        await vscode.commands.executeCommand("cai.chat.focus");
        await this.render(undefined, true);
        // Desde "Iniciar": la IA hace la primera pregunta (no esperas a escribir algo).
        if (o?.empezar && !this.conversaciones(cwd).find((x) => x.id === this.actual)?.mensajes.length)
          await this.recibir({ cmd: "enviar", arg: "Empecemos: pregúntame lo que necesites para entender el proyecto (lee primero lo que ya hay)." });
      }),
    );
  }

  resolveWebviewView(v: vscode.WebviewView): void {
    this.view = v;
    v.webview.options = { enableScripts: true };
    const nonce = Math.random().toString(36).slice(2);
    v.webview.html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${v.webview.cspSource} 'unsafe-inline'; img-src ${v.webview.cspSource} data:; script-src 'nonce-${nonce}';">
<style>
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);padding:0 10px 10px;line-height:1.45}
.barra{position:sticky;top:0;background:var(--vscode-sideBar-background);padding:6px 0;display:flex;gap:4px;flex-wrap:wrap;align-items:center;z-index:1;border-bottom:1px solid var(--vscode-widget-border,rgba(128,128,128,.25))}
select{font:inherit;color:var(--vscode-dropdown-foreground);background:var(--vscode-dropdown-background);border:1px solid var(--vscode-dropdown-border,transparent);max-width:100%}
.msg{padding:6px 0;border-top:1px solid var(--vscode-widget-border,rgba(128,128,128,.25))}
.tu{color:var(--vscode-descriptionForeground)}
.quien{font-size:.8em;color:var(--vscode-descriptionForeground)}
.caja{border-left:3px solid var(--vscode-focusBorder);padding:4px 8px;margin:6px 0;background:var(--vscode-textBlockQuote-background)}
.hecho{border-left-color:var(--vscode-testing-iconPassed,#73c991);opacity:.85}
button{font:inherit;border:0;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border-radius:3px;padding:3px 8px;margin:2px;cursor:pointer}
button.prim{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
button:disabled{opacity:.6;cursor:default}
#entrada{position:sticky;bottom:0;background:var(--vscode-sideBar-background);padding-top:6px}
textarea{width:100%;box-sizing:border-box;min-height:52px;font:inherit;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,transparent);padding:4px}
.fila{display:flex;gap:4px;justify-content:space-between;margin-top:4px;flex-wrap:wrap}
code{font-family:var(--vscode-editor-font-family)}
del{opacity:.7}
</style></head><body>
<div id="contenido"></div>
<div id="entrada"><textarea id="t" placeholder="Pregunta sobre el proyecto (Enter envía). Para 'Otra…' en una decisión, escríbela aquí y pulsa Otra."></textarea>
<div class="fila"><span><button data-cmd="sesion">📝 Resumen de la sesión</button></span><button class="prim" id="enviar">Enviar</button></div></div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const t = document.getElementById("t");
window.addEventListener("message", (e) => {
  document.getElementById("contenido").innerHTML = e.data.html;
  t.disabled = !!e.data.ocupado;
  if (e.data.placeholder) t.placeholder = e.data.placeholder;
  if (e.data.bajar) window.scrollTo(0, document.body.scrollHeight);
});
const enviar = () => { if (t.value.trim()) { vscode.postMessage({ cmd: "enviar", arg: t.value }); t.value = ""; } };
document.getElementById("enviar").addEventListener("click", enviar);
t.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } });
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-cmd]");
  if (b && !b.disabled && !b.closest(".md")) {
    // "Otra…": lo que escribiste abajo es tu opción.
    if (b.dataset.cmd === "decidirOtra") { if (!t.value.trim()) { t.focus(); t.placeholder = "Escribe tu opción aquí y vuelve a pulsar 'Otra…'"; return; } vscode.postMessage({ cmd: "decidir", arg: b.dataset.arg + "::" + t.value.trim() }); t.value = ""; return; }
    b.disabled = true; // feedback inmediato (y no dos veces)
    vscode.postMessage({ cmd: b.dataset.cmd, arg: b.dataset.arg }); return;
  }
  const a = e.target.closest("a[href]");
  if (a) { e.preventDefault(); vscode.postMessage({ cmd: "link", arg: a.getAttribute("href") }); }
});
document.addEventListener("change", (e) => {
  const s = e.target.closest("select[data-cmd]");
  if (s) vscode.postMessage({ cmd: s.dataset.cmd, arg: s.value });
});
</script></body></html>`;
    v.webview.onDidReceiveMessage((m: { cmd: string; arg?: string }) => void this.recibir(m).catch((e) => (mostrarError(e), this.render())));
    v.onDidChangeVisibility(() => v.visible && void this.render());
    void this.render(undefined, true);
  }

  private cwd(): string | undefined {
    return root(vscode.window.activeTextEditor?.document) ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  private conversaciones(cwd: string): Conversacion[] {
    const dir = path.join(dataDir(cwd), "chats");
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .flatMap((f) => {
        try {
          return [JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Conversacion];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.actualizada.localeCompare(a.actualizada));
  }

  private async recibir(m: { cmd: string; arg?: string }): Promise<void> {
    const cwd = this.cwd();
    if (!cwd) return;
    const conv = this.conversaciones(cwd).find((c) => c.id === this.actual) ?? this.conversaciones(cwd)[0];
    const refrescarPanel = () => void vscode.commands.executeCommand("cai.panel.refrescar");
    if (m.cmd === "link" && m.arg && /^https?:/.test(m.arg)) return void vscode.env.openExternal(vscode.Uri.parse(m.arg));
    if (m.cmd === "conversacion" && m.arg) {
      if (m.arg === "__nueva" || m.arg === "__entender") {
        const c = JSON.parse(await correr(["chat", "--nueva", ...(m.arg === "__entender" ? ["--entender"] : []), "--json"], cwd)) as Conversacion;
        this.actual = c.id;
      } else this.actual = m.arg;
      this.extra = "";
      return void this.render(undefined, true);
    }
    if (m.cmd === "modelo" && m.arg && conv) {
      await correr(["chat", "--conversacion", conv.id, "--modelo", m.arg], cwd);
      return void this.render();
    }
    if (m.cmd === "enviar" && m.arg?.trim()) {
      this.extra = "";
      this.pensando = true;
      this.vivo = "";
      await this.render(m.arg.trim(), true);
      try {
        const r = JSON.parse(await correr(["chat", "--texto", m.arg.trim(), ...(conv ? ["--conversacion", conv.id] : []), "--json"], cwd)) as { conversacion: string };
        this.actual = r.conversacion;
      } finally {
        this.pensando = false;
        this.vivo = "";
        await this.render(undefined, true);
        refrescarPanel();
      }
      return;
    }
    if (m.cmd === "aplicar" && m.arg && conv) {
      // "msg::tipo::k": se aplica (tu clic) y queda marcado en la conversación (el botón pasa a ✓).
      const [msg, tipo, k] = m.arg.split("::");
      const r = await correr(["chat", "--aplicar", conv.id, msg!, tipo!, k!], cwd);
      vscode.window.setStatusBarMessage(`ComplementAIry: ${r.trim().replace(/^✓\s*/, "")}`, 4000);
      await this.render();
      return refrescarPanel();
    }
    if (m.cmd === "decidir" && m.arg) {
      const sep = m.arg.indexOf("::");
      await correr(["decisiones", "decidir", m.arg.slice(0, sep), m.arg.slice(sep + 2)], cwd);
      await this.render();
      return refrescarPanel();
    }
    if (m.cmd === "retractar" && m.arg) {
      await correr(["decisiones", "retractar", m.arg], cwd);
      await this.render();
      return refrescarPanel();
    }
    if (m.cmd === "objetivos" && m.arg) {
      await correr(["entender", m.arg], cwd);
      await this.render();
      refrescarPanel();
      // Objetivos confirmados y sin estructura todavía: proponerla a partir de ellos.
      if (m.arg === "confirmar" && !fs.existsSync(path.join(dataDir(cwd), "estructura.json"))) {
        const op = await vscode.window.showInformationMessage("Objetivos confirmados ✓. ¿Propongo la estructura del proyecto (carpetas, archivos y por dónde empezar) a partir de ellos?", "Proponer la estructura", "Más tarde");
        if (op === "Proponer la estructura")
          try {
            await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "ComplementAIry: proponiendo la estructura del proyecto…", cancellable: true }, (_p, t) => correr(["plano"], cwd, { cancelar: t }));
            refrescarPanel();
            await vscode.commands.executeCommand("cai.verEstructura");
          } catch (e) {
            mostrarError(e);
          }
      }
      return;
    }
    if (m.cmd === "iniciar") return void vscode.commands.executeCommand("cai.iniciar");
    if (m.cmd === "responderPregunta" && m.arg) return this.recibir({ cmd: "enviar", arg: m.arg });
    if (m.cmd === "borrar" && conv) {
      const ok = await vscode.window.showWarningMessage(`¿Borrar la conversación "${conv.titulo}"?`, { modal: true }, "Borrar");
      if (ok !== "Borrar") return;
      await correr(["chat", "--borrar", conv.id], cwd);
      this.actual = undefined;
      return void this.render();
    }
    if (m.cmd === "sesion") {
      this.pensando = true;
      await this.render("📝 Resumen de la sesión", true);
      try {
        const r = JSON.parse(await correr(["sesion", "--json"], cwd)) as { medido: string; resumen: string; commit: string };
        this.extra = `<div class="msg"><div class="quien">📝 Resumen de la sesión</div><pre>${esc(r.medido)}</pre>${r.resumen ? `<div class="caja">${esc(r.resumen).replace(/\n/g, "<br>")}</div>` : ""}${r.commit ? `<div class="quien">Commit sugerido (edítalo; lo haces tú):</div><pre>${esc(r.commit)}</pre><button data-cmd="copiar" data-arg="${esc(r.commit)}">Copiar</button>` : ""}</div>`;
      } finally {
        this.pensando = false;
        await this.render(undefined, true);
      }
      return;
    }
    if (m.cmd === "copiar" && m.arg) {
      await vscode.env.clipboard.writeText(m.arg);
      vscode.window.setStatusBarMessage("ComplementAIry: copiado", 3000);
      return void this.render();
    }
  }

  private botonesDecision(d: Decision): string {
    const op = (o: { opcion: string }, etiqueta = "") => `<button data-cmd="decidir" data-arg="${esc(`${d.id}::${o.opcion}`)}">${etiqueta}${o.opcion === d.recomendada ? "⭐ " : ""}${esc(o.opcion)}</button>`;
    if (d.estado === "pendiente") return `<div class="caja"><b>❓ ${esc(d.pregunta)}</b><br>${d.opciones.map((o) => op(o)).join("")}<button data-cmd="decidirOtra" data-arg="${esc(d.id)}">Otra…</button></div>`;
    if (d.estado === "vigente")
      return `<div class="caja hecho">✓ ${esc(d.pregunta)} → <b>${esc(d.eleccion ?? "")}</b><br><span class="quien">Cambiar a:</span> ${d.opciones.filter((o) => o.opcion !== d.eleccion).map((o) => op(o)).join("")}<button data-cmd="decidirOtra" data-arg="${esc(d.id)}">Otra…</button> <button data-cmd="retractar" data-arg="${esc(d.id)}">↩ Retractar</button></div>`;
    return `<div class="caja">↩ ${esc(d.pregunta)} <span class="quien">(retractada: ya no rige)</span><br>${d.opciones.map((o) => op(o)).join("")}</div>`;
  }

  private async render(pendiente?: string, bajar = false): Promise<void> {
    if (!this.view?.visible) return;
    const cwd = this.cwd();
    if (!cwd) return void this.view.webview.postMessage({ html: '<p class="quien">Abre un proyecto.</p>' });
    if (!tieneCai(cwd))
      return void this.view.webview.postMessage({ html: '<p>Este proyecto todavía no usa ComplementAIry.</p><button class="prim" data-cmd="iniciar">🚀 Iniciar ComplementAIry aquí</button><p class="quien">Crea su configuración y, si ya hay código, lo conoce; después te pregunta qué buscas (objetivos) y te propone la estructura.</p>' });
    // El chat de v0.9 (chat.json) se migra la primera vez (lo hace la CLI).
    if (!this.migrado) {
      this.migrado = true;
      if (fs.existsSync(path.join(dataDir(cwd), "chat.json"))) await correr(["chat", "--lista", "--json"], cwd, { silencioso: true }).catch(() => "");
    }
    const convs = this.conversaciones(cwd);
    const conv = convs.find((c) => c.id === this.actual) ?? convs[0];
    const cfg = leerConfig(cwd);
    const modelos = { ...MODELOS_DEF, ...cfg.ia?.modelos };
    const ds = leerDecisiones(cwd);
    // Barra: conversación (y nuevas), qué IA responde, borrar.
    let html = `<div class="barra"><select data-cmd="conversacion" title="Conversación">${convs.map((c) => `<option value="${esc(c.id)}"${c.id === conv?.id ? " selected" : ""}>${esc(c.titulo.slice(0, 40))} · ${esc(c.actualizada.slice(5, 10))}</option>`).join("")}${convs.length ? "" : '<option value="">(sin conversaciones)</option>'}<option value="__nueva">＋ Nueva conversación</option><option value="__entender">🎯 Entender el proyecto</option></select>`;
    if (conv)
      html += `<select data-cmd="modelo" title="Qué IA responde en esta conversación">${(["chico", "mediano", "grande"] as const).map((k) => `<option value="${k}"${conv.modelo === k ? " selected" : ""}>IA ${k} (${esc((modelos[k] ?? "").replace(/^claude-/, ""))})</option>`).join("")}</select><button data-cmd="borrar" title="Borrar esta conversación">🗑</button>`;
    html += "</div>";
    // Conversación "entender": el estado de los objetivos arriba.
    if (conv?.tipo === "entender") {
      let o: Objetivos | null = null;
      try {
        o = JSON.parse(fs.readFileSync(path.join(dataDir(cwd), "objetivos.json"), "utf8")) as Objetivos;
      } catch {
        /* todavía no */
      }
      if (o?.estado === "entendido") html += `<div class="caja hecho">✓ Objetivos confirmados por ti: ${esc(o.resumen)} <button data-cmd="objetivos" data-arg="reabrir">Reabrir</button></div>`;
      else if (o?.estado === "terminado") html += `<div class="caja hecho">🏁 Lo diste por terminado. <button data-cmd="objetivos" data-arg="reabrir">Reabrir</button></div>`;
      else if (o?.creeEntendido) html += `<div class="caja"><b>La IA cree que ya entendió.</b> ${esc(o.resumen)}<br><button class="prim" data-cmd="objetivos" data-arg="confirmar">✓ Confirmar objetivos</button> <span class="quien">o sigue corrigiendo abajo</span></div>`;
      else html += '<p class="quien">Cuéntale qué buscas: te preguntará de a poco (con opciones) y armará un borrador de objetivos y criterios de "terminado". Cuando crea que entendió, lo confirmas tú.</p>';
    }
    if (!conv?.mensajes.length && conv?.tipo !== "entender") html += '<p class="quien">Pregúntale sobre el proyecto: conoce los objetivos, la estructura, el panorama, el estado de cada función y tus decisiones. Si le cuentas qué vas a hacer, te propone cómo quedan tus tareas; si te equivocas de algo que entiende, corrígelo aquí.</p>';
    const msgs = conv?.mensajes ?? [];
    for (const [i, m] of msgs.entries()) {
      if (m.quien === "tu") {
        html += `<div class="msg tu"><b>Tú:</b> ${esc(m.texto)}</div>`;
        continue;
      }
      const cuerpo = sanear(await vscode.commands.executeCommand<string>("markdown.api.render", m.texto).then((x) => x, () => esc(m.texto)));
      // Botones FUERA del markdown (dentro de él, los clics se ignoran: el texto viene de la IA).
      let botones = "";
      for (const id of m.decisiones ?? []) {
        const d = ds.find((x) => x.id === id);
        if (d) botones += this.botonesDecision(d);
      }
      // Las "tareas sugeridas" de v0.9 son cambios "crear" (la CLI las convierte en el mismo orden).
      const tareas: NonNullable<MensajeChat["cambiosTareas"]> = [...(m.cambiosTareas ?? []), ...(m.tareas ?? []).map((t) => ({ accion: "crear", ...t }))];
      tareas.forEach((t, k) => {
        const que = ({ crear: "➕ Nueva tarea", editar: "✎ Editar tarea", hecha: "☑ Marcar hecha", reabrir: "↺ Reabrir", descartar: "✕ Descartar" } as Record<string, string>)[t.accion] ?? esc(t.accion);
        botones += `<div class="caja${t.aplicado ? " hecho" : ""}">${que}${t.id ? ` <code>${esc(t.id)}</code>` : ""}: ${esc(t.titulo ?? "")}${t.archivo ? ` <span class="quien">(${esc(t.archivo)})</span>` : ""}${t.detalle ? `<div class="quien">${esc(t.detalle)}</div>` : ""} ${t.aplicado ? `<button disabled>✓ Aplicado</button>` : `<button data-cmd="aplicar" data-arg="${esc(`${m.id ?? i}::tarea::${k}`)}">Aplicar</button>`}</div>`;
      });
      (m.correcciones ?? []).forEach((c, k) => {
        botones += `<div class="caja${c.aplicada ? " hecho" : ""}">✎ Corregir ${c.tipo === "proyecto" ? "lo que entiendo del proyecto" : `${c.tipo === "modulo" ? "el resumen de" : "el rol de"} <code>${esc(c.archivo)}</code>`}:${c.antes ? ` <del>${esc(c.antes)}</del> →` : ""} <b>${esc(c.despues)}</b> ${c.aplicada ? "<button disabled>✓ Aplicada</button>" : `<button data-cmd="aplicar" data-arg="${esc(`${m.id ?? i}::correccion::${k}`)}">Aplicar corrección</button>`}</div>`;
      });
      // Entender: preguntas con opciones (tu clic = tu respuesta).
      if (i === msgs.length - 1)
        for (const p of m.preguntas ?? []) botones += `<div class="caja"><b>${esc(p.pregunta)}</b><br>${p.opciones.map((o) => `<button data-cmd="responderPregunta" data-arg="${esc(o)}">${esc(o)}</button>`).join("")}<span class="quien"> o escríbelo abajo</span></div>`;
      html += `<div class="msg"><div class="quien">ComplementAIry${m.modelo ? ` · ${esc(m.modelo.replace(/^claude-/, ""))}` : ""}${m.costo !== undefined ? ` · US$${m.costo.toFixed(3)}` : ""}</div><div class="md">${cuerpo}</div>${botones}</div>`;
    }
    if (pendiente) html += `<div class="msg tu"><b>Tú:</b> ${esc(pendiente)}</div>`;
    html += this.extra;
    if (this.pensando) html += `<div class="msg"><div class="quien">⏳ pensando…</div>${this.vivo ? esc(this.vivo).replace(/\n/g, "<br>") : ""}</div>`;
    void this.view.webview.postMessage({ html, ocupado: this.pensando, bajar, placeholder: conv?.tipo === "entender" ? "Cuéntale qué buscas o responde sus preguntas (Enter envía)" : "" });
  }
}
