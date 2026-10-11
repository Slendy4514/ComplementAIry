import * as vscode from "vscode";
import path from "node:path";
import { correr, root } from "./comun";
import { tieneCai } from "./iniciar";

/**
 * Panel "Comprensión" (v1): lo que NO revisó un humano (por riesgo), tu informe de la semana, el repaso
 * espaciado, tu expediente (licencias, dominios, calibración), la reconstrucción semanal y el recorrido
 * para conocer un proyecto ajeno (tu hipótesis primero, después la IA, después la diferencia).
 */

const esc = (t: string) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

interface Fila {
  archivo: string;
  funcion: string;
  lineas: number;
  origen: string;
  riesgo: number;
}

export class ComprensionView implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private aviso = "";
  private pestana: "revisar" | "semana" | "repaso" | "yo" | "reconstruir" | "recorrido" = "revisar";
  private recorridoIa: Record<string, string> = {};

  registrar(ctx: vscode.ExtensionContext): void {
    const w = vscode.workspace.createFileSystemWatcher("**/.cai/{procedencia/*.json,evidencias/*.json}");
    for (const ev of [w.onDidChange, w.onDidCreate]) ev(() => this.pestana === "revisar" && void this.render());
    ctx.subscriptions.push(w, vscode.window.registerWebviewViewProvider("cai.comprension", this, { webviewOptions: { retainContextWhenHidden: true } }));
  }

  private cwd(): string | undefined {
    const c = root(vscode.window.activeTextEditor?.document);
    return c && tieneCai(c) ? c : undefined;
  }

  resolveWebviewView(v: vscode.WebviewView): void {
    this.view = v;
    v.webview.options = { enableScripts: true };
    v.webview.onDidReceiveMessage((m: { cmd: string; arg?: string; campos?: Record<string, string> }) => void this.accion(m));
    void this.render();
  }

  private async accion(m: { cmd: string; arg?: string; campos?: Record<string, string> }): Promise<void> {
    const cwd = this.cwd();
    if (!cwd) return;
    const c = m.campos ?? {};
    if (m.cmd === "pestana") {
      this.pestana = m.arg as typeof this.pestana;
      this.aviso = "";
      return this.render();
    }
    if (m.cmd === "abrir" && m.arg) {
      const doc = await vscode.workspace.openTextDocument(path.join(cwd, m.arg));
      await vscode.window.showTextDocument(doc);
      return;
    }
    const args: Record<string, string[]> = {
      repaso: ["repaso", "--item", m.arg ?? "", "--llamada", c[`l_${m.arg}`] ?? "", "--espero", c[`x_${m.arg}`] ?? "", ...(c[`s_${m.arg}`] ? ["--seguridad", c[`s_${m.arg}`]!] : [])],
      empezar: ["reconstruir", "--empezar", m.arg ?? ""],
      terminar: ["reconstruir", "--terminar", c.reflexion ?? ""],
      hipotesis: ["mapa", "--parada", m.arg ?? "", "--hipotesis", c[`h_${m.arg}`] ?? ""],
      diferencia: ["mapa", "--parada", m.arg ?? "", "--diferencia", c[`d_${m.arg}`] ?? ""],
      kata: ["kata", c.construccion ?? ""],
    };
    if (!args[m.cmd]) return;
    try {
      const out = await correr(args[m.cmd]!, cwd, { aceptar: [1] });
      this.aviso = out.trim().split("\n").slice(-20).join("\n");
      if (m.cmd === "hipotesis" && m.arg) this.recorridoIa[m.arg] = out;
      if (m.cmd === "empezar") {
        const dir = /Worktree SIN IA: (.+)/.exec(out)?.[1];
        if (dir && (await vscode.window.showInformationMessage(`Reconstrucción en ${dir} (sin IA). ¿Abrirla en otra ventana?`, "Abrir")) === "Abrir") await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(dir), true);
      }
    } catch (e) {
      this.aviso = `✘ ${e instanceof Error ? e.message.replace(/^cai:\s*/, "") : String(e)}`;
    }
    await this.render();
  }

  async render(): Promise<void> {
    if (!this.view) return;
    const cwd = this.cwd();
    const pest = (["revisar", "semana", "repaso", "yo", "reconstruir", "recorrido"] as const).map((p) => `<button class="${p === this.pestana ? "prim" : ""}" data-cmd="pestana" data-arg="${p}">${{ revisar: "Sin revisar", semana: "Semana", repaso: "Repaso", yo: "Yo", reconstruir: "Reconstruir", recorrido: "Recorrido" }[p]}</button>`).join("");
    let cuerpo = "";
    if (!cwd) cuerpo = "<p>Abre un archivo de un proyecto con ComplementAIry.</p>";
    else
      try {
        cuerpo = await this.contenido(cwd);
      } catch (e) {
        cuerpo = `<pre class="aviso">${esc(e instanceof Error ? e.message : String(e))}</pre>`;
      }
    this.view.webview.html = this.html(`<div class="barra">${pest}</div>${this.aviso ? `<pre class="aviso">${esc(this.aviso)}</pre>` : ""}${cuerpo}`);
  }

  private async contenido(cwd: string): Promise<string> {
    const j = async <T>(args: string[]) => JSON.parse(await correr([...args, "--json"], cwd, { silencioso: true, aceptar: [1] })) as T;
    switch (this.pestana) {
      case "revisar": {
        const r = await j<{ filas: Fila[]; resumen: string[] }>(["informe"]);
        return `${r.resumen.map((x) => `<div class="meta">${esc(x)}</div>`).join("")}<h4>Lo que no revisó un humano, por riesgo</h4>${r.filas.length ? `<ul>${r.filas.slice(0, 40).map((f) => `<li><a data-cmd="abrir" data-arg="${esc(f.archivo)}">${esc(f.archivo)}</a> · ${esc(f.funcion)} · ${f.lineas} línea(s) <span class="meta">${esc(f.origen)}${f.riesgo ? ` · riesgo ${f.riesgo}` : ""}</span></li>`).join("")}</ul>` : "<p>✔ Todo lo que no escribiste tú tiene evidencia.</p>"}`;
      }
      case "semana":
        return `<pre class="txt">${esc((await j<string[]>(["informe", "--semana"])).join("\n"))}</pre>`;
      case "repaso": {
        const items = await j<{ n: number; tipo: string; archivo?: string; funcion?: string; hace: string; pide: string }[]>(["repaso"]);
        if (!items.length) return "<p>Nada que repasar hoy ✔</p>";
        return `<p class="meta">Sin mirar el código: elige una entrada y predice. Se ejecuta y se compara.</p>${items.map((i) => (i.tipo === "prediccion" ? `<div class="caja" data-form><b>${esc(i.funcion ?? "")}</b> <span class="meta">${esc(i.archivo ?? "")} · ${esc(i.hace)}</span><input name="l_${i.n}" placeholder="${esc(i.funcion ?? "f")}(…)"><input name="x_${i.n}" placeholder="lo que devuelve"><label class="meta">seguridad <select name="s_${i.n}"><option value="">-</option>${[1, 2, 3, 4, 5].map((k) => `<option>${k}</option>`).join("")}</select></label><button data-cmd="repaso" data-arg="${i.n}">Predecir</button></div>` : `<div class="caja">${esc(i.hace)}: ${esc(i.pide)}</div>`)).join("")}`;
      }
      case "yo":
        return `<pre class="txt">${esc((await j<string[]>(["yo"])).join("\n"))}</pre><div class="caja" data-form><b>Kata (ganar una licencia, sin IA)</b><input name="construccion" placeholder="construcción (ej.: promise-all, regex, reduce)"><button data-cmd="kata">Crear kata</button></div>`;
      case "reconstruir": {
        const cs = await j<{ archivo: string; funcion: string; lineasIa: number; tarea: string }[]>(["reconstruir"]);
        return `<p class="meta">Una funcionalidad que hiciste con IA esta semana, desde cero, solo con documentación oficial, en un worktree sin IA, contra un oráculo oculto.</p>${cs.map((c, i) => `<div class="caja">${esc(c.funcion)} <span class="meta">${esc(c.archivo)} · ${c.lineasIa} líneas de la IA</span> <button data-cmd="empezar" data-arg="${i + 1}">Empezar</button></div>`).join("") || "<p>Nada de la IA cerrado esta semana ✔</p>"}<div class="caja" data-form><b>Terminar</b><textarea name="reflexion" placeholder="Qué difiere tu versión de la original y por qué"></textarea><button data-cmd="terminar">Comparar y terminar</button></div>`;
      }
      case "recorrido": {
        const ps = await j<{ n: number; nombre: string; archivo: string; firma: string }[]>(["mapa", "--recorrido"]);
        if (!ps.length) return "<p>Nada riesgoso sin entender ✔</p>";
        return `<p class="meta">Antes de leer cada función: ¿qué crees que hace? Después la IA explica y escribes la diferencia.</p>${ps.map((p) => `<div class="caja" data-form><b>${esc(p.nombre)}</b> <span class="meta">${esc(p.archivo)}</span><pre>${esc(p.firma)}</pre>${this.recorridoIa[String(p.n)] ? `<pre class="txt">${esc(this.recorridoIa[String(p.n)]!)}</pre><textarea name="d_${p.n}" placeholder="La diferencia: qué acertaste, qué no y qué te sorprendió"></textarea><button data-cmd="diferencia" data-arg="${p.n}">Guardar</button>` : `<textarea name="h_${p.n}" placeholder="Tu hipótesis (solo con el nombre y la firma)"></textarea><button data-cmd="hipotesis" data-arg="${p.n}">Ver la función y la explicación</button>`}</div>`).join("")}`;
      }
    }
  }

  private html(cuerpo: string): string {
    const nonce = Math.random().toString(36).slice(2);
    const csp = this.view!.webview.cspSource;
    return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${csp} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);padding:0 10px 10px;line-height:1.45}
.barra{position:sticky;top:0;background:var(--vscode-sideBar-background);padding:6px 0;z-index:1;display:flex;flex-wrap:wrap;gap:2px}
select,input,textarea{font:inherit;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,transparent);box-sizing:border-box}
input,textarea{width:100%;margin:2px 0}textarea{min-height:40px}
.caja{border-left:3px solid var(--vscode-focusBorder);padding:4px 8px;margin:6px 0;background:var(--vscode-textBlockQuote-background)}
.aviso,.txt{white-space:pre-wrap;background:var(--vscode-textCodeBlock-background);padding:6px;font-size:.9em}
.meta{color:var(--vscode-descriptionForeground);font-size:.85em}
button{font:inherit;border:0;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border-radius:3px;padding:3px 8px;margin:2px;cursor:pointer}
button.prim{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
pre{white-space:pre-wrap;font-family:var(--vscode-editor-font-family);font-size:.9em}a{cursor:pointer;color:var(--vscode-textLink-foreground)}
</style></head><body>${cuerpo}
<script nonce="${nonce}">
const vs = acquireVsCodeApi();
const campos = (el) => { const f = el.closest("[data-form]"); const o = {}; if (!f) return o; f.querySelectorAll("input,textarea,select").forEach((x) => { if (x.name) o[x.name] = x.value; }); return o; };
document.addEventListener("click", (e) => { const b = e.target.closest("[data-cmd]"); if (b) vs.postMessage({ cmd: b.dataset.cmd, arg: b.dataset.arg, campos: campos(b) }); });
</script></body></html>`;
  }
}
