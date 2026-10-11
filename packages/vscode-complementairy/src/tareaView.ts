import * as vscode from "vscode";
import path from "node:path";
import { correr, mostrarError, root } from "./comun";
import { tieneCai } from "./iniciar";

/**
 * Panel "Tarea" (v1): la tarea de punta a punta (manifiesto V). Siempre muestra QUÉ FALTA; cada botón pide
 * algo tuyo (tu respuesta, tu diseño, tu porqué, tu paráfrasis, tu evidencia), nunca un "Aceptar" pelado.
 * Toda la lógica está en la CLI (`cai pedir`, `cai tarea`, `cai avanzar`, `cai revisar --tarea`…).
 */

interface Pregunta {
  clave: string;
  pregunta: string;
  sugerencia?: string;
  porque?: string;
  respuesta?: string;
}
interface Tarea {
  id: string;
  titulo: string;
  tipo: string;
  intencion: string;
  ejecutor: string;
  estado: string;
  entrevista: Pregunta[];
  diseno?: { problema: string; enfoque: string; contexto: string[]; criterios: string[] };
  plan?: { flujoDeDatos: string; pasos: string[]; retos: string[]; comoProbar: string[]; funcionesClave: { nombre: string; que: string }[]; modelo?: string };
  restricciones: { alcance: string[]; sinDependencias: boolean; preservar: string[]; presupuestoLineas: number };
  parafrasis?: string;
  hallazgos?: { clave: string; tipo: string; archivo: string; linea: number; texto: string; resuelto?: unknown }[];
  bucle?: { senales: string[] };
  endurecida?: string;
  adjuntos: string[];
}
interface Detalle {
  tarea: Tarea;
  faltan: string[];
  siguiente: string;
  decisiones: { id: string; pregunta: string; estado: string; opciones: { opcion: string; consecuencia: string }[]; eleccion?: string }[];
}
interface TramoRevisar {
  id: string;
  archivo: string;
  desde: number;
  hasta: number;
  codigo: string;
  pide: string;
  minimo: number;
  porque: string;
  funcion?: string;
}

const esc = (t: string) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const ICONO: Record<string, string> = { borrador: "📝", "diseñada": "✏️", planificada: "🗺️", aprobada: "✅", ejecutando: "⚙️", "en-revision": "🔍", revisada: "🧪", probada: "📦", cerrada: "✔", desconectada: "⛔", descartada: "✖" };

export class TareaView implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private actual?: string;
  private aviso = "";
  private comparar: string[] = [];
  private ocupado = false;

  registrar(ctx: vscode.ExtensionContext): void {
    const w = vscode.workspace.createFileSystemWatcher("**/.cai/{tareas/**,pedidos/*.json,decisiones.json,procedencia/*.json}");
    for (const ev of [w.onDidChange, w.onDidCreate, w.onDidDelete]) ev(() => !this.ocupado && void this.render());
    ctx.subscriptions.push(
      w,
      vscode.window.registerWebviewViewProvider("cai.tarea", this, { webviewOptions: { retainContextWhenHidden: true } }),
      vscode.commands.registerCommand("cai.tarea.pedir", async () => {
        const texto = await vscode.window.showInputBox({ prompt: "¿Qué quieres? (con tus palabras: qué cambia, dónde y cómo sabrás que funciona)", ignoreFocusOut: true });
        if (texto) await this.accion({ cmd: "pedir", campos: { texto } });
      }),
      vscode.commands.registerCommand("cai.tarea.avanzar", () => this.accion({ cmd: "avanzar" })),
    );
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

  /** Corre la CLI; los códigos 1 (falta algo) se muestran, no son errores. */
  private async cli(args: string[]): Promise<string> {
    const cwd = this.cwd();
    if (!cwd) throw new Error("abre un archivo de un proyecto con ComplementAIry");
    return correr(args, cwd, { aceptar: [1] });
  }

  private async accion(m: { cmd: string; arg?: string; campos?: Record<string, string> }): Promise<void> {
    const c = m.campos ?? {};
    const id = this.actual ?? "";
    const reb = c.rebatir?.trim() ? ["--rebatir", c.rebatir.trim()] : [];
    const porArgs: Record<string, () => string[] | null> = {
      pedir: () => ["pedir", c.texto ?? "", ...reb],
      sugerir: () => ["tarea", id, "--sugerir"],
      responder: () => ["tarea", id, "--responder", m.arg!, c[`r_${m.arg}`] ?? "", ...(c[`b_${m.arg}`]?.trim() ? ["--rebatir", c[`b_${m.arg}`]!.trim()] : [])],
      diseno: () => ["tarea", id, "--diseno", ...(c.problema ? ["--problema", c.problema] : []), ...(c.enfoque ? ["--enfoque", c.enfoque] : []), ...(c.contexto ? ["--contexto", c.contexto] : []), ...(c.criterio ? ["--criterio", c.criterio] : []), ...reb],
      planificar: () => ["tarea", id, "--planificar"],
      decidir: () => ["decidir", m.arg!, "--elegir", c[`o_${m.arg}`] ?? "", "--porque", c[`p_${m.arg}`] ?? ""],
      aprobar: () => ["tarea", id, "--aprobar", c.parafrasis ?? ""],
      ejecutar: () => ["tarea", id, "--ejecutar", ...(c.aislada === "true" ? ["--aislada"] : [])],
      avanzar: () => ["avanzar", ...(id ? [id] : [])],
      explicacion: () => ["revisar", "--tarea", id, "--tramo", m.arg!, "--explicacion", c[`e_${m.arg}`] ?? "", ...(c[`s_${m.arg}`] ? ["--seguridad", c[`s_${m.arg}`]!] : [])],
      prediccion: () => ["revisar", "--tarea", id, "--tramo", m.arg!, "--llamada", c[`l_${m.arg}`] ?? "", "--espero", c[`x_${m.arg}`] ?? "", ...(c[`s_${m.arg}`] ? ["--seguridad", c[`s_${m.arg}`]!] : [])],
      bordes: () => ["revisar", "--tarea", id, "--tramo", m.arg!, "--bordes", c[`b_${m.arg}`] ?? "", "--rendimiento", c[`r_${m.arg}`] ?? ""],
      mutante: () => ["revisar", "--tarea", id, "--tramo", m.arg!, "--mutante", c[`m_${m.arg}`] ?? ""],
      visual: () => (c[`v_${m.arg}`] ? ["revisar", "--tarea", id, "--tramo", m.arg!, "--captura", c[`v_${m.arg}`]!, "--descripcion", c[`d_${m.arg}`] ?? ""] : null),
      resolver: () => ["pruebas", id, "--resolver", m.arg!, "--como", c[`c_${m.arg}`] ?? "no-aplica", "--nota", c[`n_${m.arg}`] ?? ""],
      desconectar: () => ["desconectar", id, c.motivo || "a mano"],
      volver: () => ["volver", id, "--replanteo", c.replanteo ?? "", ...(c.manual === "true" ? ["--manual"] : [])],
      descartar: () => ["tarea", id, "--descartar", c.porque ?? ""],
      refactorizar: () => ["tarea", id, "--refactorizar", c.refactor ?? ""],
    };
    if (m.cmd === "elegir") {
      this.actual = m.arg;
      this.aviso = "";
      this.comparar = [];
      return this.render();
    }
    if (m.cmd === "abrir") {
      const cwd = this.cwd();
      if (!cwd || !m.arg) return;
      const [archivo, linea] = m.arg.split(":");
      const doc = await vscode.workspace.openTextDocument(path.join(cwd, archivo!));
      const ed = await vscode.window.showTextDocument(doc);
      const l = Math.max(0, Number(linea ?? 1) - 1);
      ed.revealRange(new vscode.Range(l, 0, l, 0), vscode.TextEditorRevealType.InCenter);
      return;
    }
    if (m.cmd === "adjuntar") {
      const f = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { Imágenes: ["png", "jpg", "jpeg", "gif", "webp", "svg"] } });
      if (!f?.[0]) return;
      porArgs.adjuntar = () => ["tarea", id, "--adjuntar", f[0]!.fsPath];
      m.cmd = "adjuntar";
    }
    const args = porArgs[m.cmd]?.();
    if (!args) return;
    this.ocupado = true;
    await this.render(`⏳ ${m.cmd}…`);
    try {
      const out = await this.cli(args);
      this.aviso = out.trim().split("\n").slice(-12).join("\n");
      this.comparar = [];
      if (m.cmd === "pedir") this.actual = /\b(t\d+)\b/.exec(out)?.[1] ?? this.actual;
    } catch (e) {
      this.aviso = `✘ ${e instanceof Error ? e.message.replace(/^cai:\s*/, "") : String(e)}`;
    } finally {
      this.ocupado = false;
      await this.render();
    }
  }

  async render(estado = ""): Promise<void> {
    if (!this.view) return;
    const cwd = this.cwd();
    let cuerpo = "";
    if (!cwd) cuerpo = `<p>Abre un archivo de un proyecto con ComplementAIry (o inícialo: <code>cai init</code>).</p>`;
    else {
      try {
        const lista = JSON.parse(await correr(["tarea", "--json"], cwd, { silencioso: true })) as Tarea[];
        if (!this.actual || !lista.some((t) => t.id === this.actual)) this.actual = lista[0]?.id;
        cuerpo = this.encabezado(lista);
        if (this.actual) {
          const d = JSON.parse(await correr(["tarea", this.actual, "--faltan", "--json"], cwd, { silencioso: true, aceptar: [1] })) as Detalle;
          const tramos = d.tarea.estado === "en-revision" ? (JSON.parse(await correr(["revisar", "--tarea", this.actual, "--json"], cwd, { silencioso: true })) as TramoRevisar[]) : [];
          cuerpo += this.detalle(d, tramos);
        }
      } catch (e) {
        cuerpo += `<div class="aviso">${esc(e instanceof Error ? e.message : String(e))}</div>`;
      }
    }
    this.view.webview.html = this.html(cuerpo, estado);
  }

  private encabezado(lista: Tarea[]): string {
    const opts = lista.map((t) => `<option value="${t.id}" ${t.id === this.actual ? "selected" : ""}>${ICONO[t.estado] ?? ""} ${t.id} · ${esc(t.titulo.slice(0, 50))}</option>`).join("");
    return `<div class="barra">${lista.length ? `<select data-cmd="elegir">${opts}</select>` : "<span>Sin tareas activas</span>"}</div>
<details ${lista.length ? "" : "open"}><summary>➕ Pedir algo (con tus palabras)</summary><div data-form>
<textarea name="texto" placeholder="Qué cambia, dónde (archivo, función, campo) y cómo sabrás que funciona. Si pides varias cosas, se separan en varias tareas."></textarea>
<textarea name="rebatir" class="chico" placeholder="(opcional) Si el juez dijo que es vago y no estás de acuerdo: por qué"></textarea>
<button class="prim" data-cmd="pedir">Pedir</button></div></details>`;
  }

  private detalle(d: Detalle, tramos: TramoRevisar[]): string {
    const t = d.tarea;
    const p: string[] = [];
    p.push(`<h3>${ICONO[t.estado] ?? ""} ${t.id} · ${esc(t.titulo)}</h3><div class="meta">${t.estado} · ${t.tipo} · ${t.intencion === "aprender" ? "aprender (escribes tú)" : "producir"} · escribe: ${t.ejecutor}${t.endurecida ? ` · ⚠ endurecida: ${esc(t.endurecida)}` : ""}${t.bucle?.senales.length ? ` · ⚠ señales de bucle: ${esc(t.bucle.senales.join(", "))}` : ""}</div>`);
    if (this.aviso) p.push(`<pre class="aviso">${esc(this.aviso)}</pre>`);
    if (this.comparar.length) p.push(`<div class="caja">${this.comparar.map(esc).join("<br>")}</div>`);
    if (d.faltan.length) p.push(`<div class="falta"><b>Falta</b><ul>${d.faltan.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div>`);
    else p.push(`<div class="ok">Siguiente: ${esc(d.siguiente)}</div>`);
    p.push(`<button class="prim" data-cmd="avanzar">▶ Avanzar</button>`);

    if (t.estado === "borrador") {
      p.push(`<h4>Entrevista de restricciones</h4><button data-cmd="sugerir">💡 Que la IA sugiera (con su porqué)</button>`);
      for (const q of t.entrevista) {
        p.push(`<div class="caja ${q.respuesta ? "hecho" : ""}" data-form><b>${esc(q.pregunta)}</b>${q.sugerencia ? `<div class="sug">IA sugiere: ${esc(q.sugerencia)}<br><i>porque ${esc(q.porque ?? "")}</i></div>` : ""}
${q.respuesta ? `<div>✔ ${esc(q.respuesta)}</div>` : `<textarea name="r_${q.clave}" placeholder="Tu respuesta, con tus palabras (corta vale; «sí» no)"></textarea><textarea class="chico" name="b_${q.clave}" placeholder="(si el juez la rechaza y no estás de acuerdo) por qué"></textarea><button data-cmd="responder" data-arg="${q.clave}">Responder</button>`}</div>`);
      }
      const ds = t.diseno;
      p.push(`<h4>Tu diseño (V.1)</h4><div class="caja" data-form>
<label>Problema</label><textarea name="problema" placeholder="Qué pasa hoy y por qué importa">${esc(ds?.problema ?? "")}</textarea>
<label>Enfoque (tus palabras; nombra archivos/funciones)</label><textarea name="enfoque">${esc(ds?.enfoque ?? "")}</textarea>
<label>Contexto (archivos o funciones, separados por coma)</label><input name="contexto" value="${esc((ds?.contexto ?? []).join(", "))}">
<label>Criterio verificable (ej.: <code>f(2) → 4</code> o un comando)</label><input name="criterio" value="">
${ds?.criterios.length ? `<div class="meta">criterios: ${esc(ds.criterios.join(" | "))}</div>` : ""}
<textarea class="chico" name="rebatir" placeholder="(si el juez dice que el enfoque es vago y no estás de acuerdo) por qué"></textarea>
<button class="prim" data-cmd="diseno">Guardar diseño</button>${t.tipo === "ui" ? ` <button data-cmd="adjuntar">📎 Captura</button>` : ""}</div>`);
    }
    if (t.estado === "diseñada") p.push(t.ejecutor === "humano" ? `<p>Escríbela tú. Cuando termines: ▶ Avanzar.</p>` : `<button class="prim" data-cmd="planificar">🗺️ Pedir el plan (sin código)</button>`);
    if (t.plan) p.push(`<details ${t.estado === "planificada" ? "open" : ""}><summary>Plan ${esc(t.plan.modelo ?? "")}</summary><div class="caja"><b>Flujo:</b> ${esc(t.plan.flujoDeDatos)}<ol>${t.plan.pasos.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>${t.plan.retos.length ? `<b>Retos:</b> ${esc(t.plan.retos.join(" · "))}<br>` : ""}<b>Cómo probar:</b> ${esc(t.plan.comoProbar.join(" · "))}</div></details>`);
    const pend = d.decisiones.filter((x) => x.estado === "pendiente");
    if (pend.length) {
      p.push(`<h4>Decide tú (prohibido adivinar)</h4>`);
      for (const x of pend)
        p.push(`<div class="caja" data-form><b>${esc(x.pregunta)}</b>${x.opciones.map((o, i) => `<label class="op"><input type="radio" name="o_${x.id}" value="${esc(o.opcion)}" ${i ? "" : ""}> ${esc(o.opcion)} <span class="meta">${esc(o.consecuencia)}</span></label>`).join("")}<textarea name="p_${x.id}" placeholder="Por qué eliges esa (con tus palabras)"></textarea><button data-cmd="decidir" data-arg="${x.id}">Decidir</button> <span class="meta">(matriz o valor esperado: <code>cai decidir ${x.id}</code>)</span></div>`);
    }
    if (t.estado === "planificada") p.push(`<h4>Aprobar</h4><div class="caja" data-form><div class="meta">Alcance: ${esc(t.restricciones.alcance.join(", ") || "(sin fijar)")} · ${t.restricciones.sinDependencias ? "sin dependencias nuevas" : "con dependencias"} · ≤ ${t.restricciones.presupuestoLineas} líneas por paso</div><textarea name="parafrasis" placeholder="Con tus palabras: qué va a hacer el plan (menciona al menos 2 pasos)"></textarea><button class="prim" data-cmd="aprobar">Aprobar con mi paráfrasis</button></div>`);
    if (t.estado === "aprobada") p.push(`<div data-form><label><input type="checkbox" name="aislada" value="true"> en un worktree aparte (paralelo)</label><br><button class="prim" data-cmd="ejecutar">⚙️ Ejecutar</button> <span class="meta">Luego, en Claude Code: «implementa ${t.id}»</span></div>`);
    if (t.estado === "ejecutando") p.push(`<div data-form><textarea class="chico" name="motivo" placeholder="¿Da vueltas? por qué la desconectas"></textarea><button data-cmd="desconectar">⛔ Desconectar</button></div>`);
    if (t.estado === "en-revision") {
      p.push(`<h4>Revisión: tu evidencia por tramo</h4>`);
      tramos.forEach((x, i) => {
        const n = String(i + 1);
        const seg = `<label class="meta">¿Qué tan seguro estás? (1 nada – 5 totalmente; obligatoria al predecir) <select name="s_${n}"><option value="">-</option>${[1, 2, 3, 4, 5].map((k) => `<option>${k}</option>`).join("")}</select></label>`;
        const ui = /\.(tsx|jsx|vue|svelte|css|scss|sass|less|html)$/i.test(x.archivo);
        const inputs: Record<string, string> = {
          explicacion: `<textarea name="e_${n}" placeholder="Qué hace y por qué, con tus palabras (nombra piezas del tramo)"></textarea>${seg}<button data-cmd="explicacion" data-arg="${n}">Enviar explicación</button>`,
          prediccion: `<input name="l_${n}" placeholder="${esc(x.funcion ?? "f")}(…) con valores que elijas"><input name="x_${n}" placeholder="lo que crees que devuelve">${seg}<button data-cmd="prediccion" data-arg="${n}">Predecir y ejecutar</button>`,
          bordes: `<textarea name="b_${n}" placeholder="Tus casos borde o de error, separados por ;  (antes de ver los de la IA)"></textarea><textarea class="chico" name="r_${n}" placeholder="Impacto en rendimiento (o por qué no importa)"></textarea><button data-cmd="bordes" data-arg="${n}">Comparar con la IA</button>`,
          mutante: `<input name="m_${n}" placeholder="si niego una condición de este tramo, ¿qué tests fallan? (nombres o «ninguno»)"><button data-cmd="mutante" data-arg="${n}">Ejecutar el mutante</button>`,
        };
        const visual = ui && x.minimo <= 2 ? `<details><summary>o evidencia visual (interfaz)</summary><input name="v_${n}" placeholder="ruta de la captura del resultado (png/jpg)"><textarea name="d_${n}" placeholder="Qué cambia en pantalla y por qué, con tus palabras"></textarea><button data-cmd="visual" data-arg="${n}">Enviar captura</button></details>` : "";
        p.push(`<div class="caja" data-form><a data-cmd="abrir" data-arg="${esc(x.archivo)}:${x.desde}">${esc(x.id)}</a>${x.funcion ? ` (${esc(x.funcion)})` : ""} — pide <b>${esc(x.pide)}</b> (nivel ${x.minimo})<div class="meta">${esc(x.porque)}</div><pre>${esc(x.codigo)}</pre>${inputs[x.pide] ?? ""}${visual}</div>`);
      });
      p.push(`<details><summary>Editaste a mano: que la IA refactorice ALREDEDOR de tus cambios</summary><div data-form><textarea name="refactor" placeholder="Qué debe ajustar (sin tocar tus líneas)"></textarea><button data-cmd="refactorizar">Pedir refactor</button></div></details>`);
    }
    const hs = (t.hallazgos ?? []).filter((h) => !h.resuelto);
    if (hs.length) {
      p.push(`<h4>Pruebas (V.5): cada hallazgo, un test tuyo o «no aplica porque…»</h4>`);
      for (const h of hs) {
        const k = h.clave.split(":").slice(-3).join(":");
        p.push(`<div class="caja" data-form><a data-cmd="abrir" data-arg="${esc(h.archivo)}:${h.linea}">${esc(h.archivo)}:${h.linea}</a> ${esc(h.texto)}<select name="c_${esc(k)}"><option value="no-aplica">no aplica porque…</option><option value="test">escribí un test</option><option value="explicacion">explicación</option></select><textarea class="chico" name="n_${esc(k)}" placeholder="tu razón, o el nombre del test"></textarea><button data-cmd="resolver" data-arg="${esc(k)}">Resolver</button></div>`);
      }
    }
    if (t.estado === "desconectada") p.push(`<h4>Pull the plug</h4><div class="caja" data-form><textarea name="replanteo" placeholder="Qué falló en el diseño o en el plan (tu replanteo)"></textarea><label><input type="checkbox" name="manual" value="true"> seguir a mano</label><br><button class="prim" data-cmd="volver">↶ Volver al último punto verde</button></div>`);
    if (!["cerrada", "descartada"].includes(t.estado)) p.push(`<details><summary>Descartar</summary><div data-form><textarea class="chico" name="porque" placeholder="por qué (queda en el rastro del pedido)"></textarea><button data-cmd="descartar">Descartar</button></div></details>`);
    return p.join("\n");
  }

  private html(cuerpo: string, estado: string): string {
    const nonce = Math.random().toString(36).slice(2);
    const csp = this.view!.webview.cspSource;
    return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${csp} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);padding:0 10px 10px;line-height:1.45}
.barra{position:sticky;top:0;background:var(--vscode-sideBar-background);padding:6px 0;z-index:1}
select,input,textarea{font:inherit;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,transparent);max-width:100%;box-sizing:border-box}
input,textarea{width:100%;margin:2px 0}textarea{min-height:44px}textarea.chico{min-height:26px;opacity:.85}
.caja{border-left:3px solid var(--vscode-focusBorder);padding:4px 8px;margin:6px 0;background:var(--vscode-textBlockQuote-background)}
.hecho{border-left-color:var(--vscode-testing-iconPassed,#73c991);opacity:.85}
.falta{border-left:3px solid var(--vscode-editorWarning-foreground);padding:2px 8px;margin:6px 0}
.ok{border-left:3px solid var(--vscode-testing-iconPassed,#73c991);padding:2px 8px;margin:6px 0}
.aviso{white-space:pre-wrap;background:var(--vscode-textCodeBlock-background);padding:6px;font-size:.9em}
.sug{color:var(--vscode-descriptionForeground);margin:3px 0}
.meta{color:var(--vscode-descriptionForeground);font-size:.85em}
button{font:inherit;border:0;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border-radius:3px;padding:3px 8px;margin:2px;cursor:pointer}
button.prim{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
pre{white-space:pre-wrap;font-family:var(--vscode-editor-font-family);font-size:.9em;background:var(--vscode-textCodeBlock-background);padding:4px}
a{cursor:pointer;color:var(--vscode-textLink-foreground)}label.op{display:block}
</style></head><body>${estado ? `<div class="meta">${esc(estado)}</div>` : ""}${cuerpo}
<script nonce="${nonce}">
const vs = acquireVsCodeApi();
const campos = (el) => { const f = el.closest("[data-form]"); const o = {}; if (!f) return o;
  f.querySelectorAll("input,textarea,select").forEach((x) => { if (!x.name) return; if (x.type === "radio") { if (x.checked) o[x.name] = x.value; } else if (x.type === "checkbox") o[x.name] = x.checked ? "true" : ""; else o[x.name] = x.value; }); return o; };
document.addEventListener("click", (e) => { const b = e.target.closest("[data-cmd]"); if (!b || b.tagName === "SELECT") return; vs.postMessage({ cmd: b.dataset.cmd, arg: b.dataset.arg, campos: campos(b) }); });
document.addEventListener("change", (e) => { if (e.target.dataset && e.target.dataset.cmd === "elegir") vs.postMessage({ cmd: "elegir", arg: e.target.value }); });
</script></body></html>`;
  }
}
