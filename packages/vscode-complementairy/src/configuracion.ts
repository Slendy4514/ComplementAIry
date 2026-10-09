import fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import { dataDir, leerConfig, mostrarError, root, type ConfigProyecto } from "./comun";

/**
 * Configuración en una pantalla: qué ayuda dar por defecto, sugerencias rápidas, el acompañante
 * (y el autoguardado), los modelos por tamaño de tarea y dónde se ven las notas. Lo del proyecto se
 * guarda en .cai/config.json (lo demás de ese archivo se conserva); lo del editor, en los ajustes de VSCode.
 */

const MODELOS = ["claude-haiku-4-5", "claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1"];

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function registrarConfiguracion(ctx: vscode.ExtensionContext): void {
  let panel: vscode.WebviewPanel | undefined;
  ctx.subscriptions.push(
    vscode.commands.registerCommand("cai.configurar", () => {
      const cwd = root(vscode.window.activeTextEditor?.document);
      if (!cwd) return void vscode.window.showWarningMessage("ComplementAIry: abre un proyecto primero.");
      if (panel) return panel.reveal();
      let c: ConfigProyecto;
      try {
        c = leerConfig(cwd, true);
      } catch (e) {
        return mostrarError(e);
      }
      panel = vscode.window.createWebviewPanel("cai.configuracion", "ComplementAIry: configuración", vscode.ViewColumn.Active, { enableScripts: true });
      panel.onDidDispose(() => (panel = undefined));
      panel.webview.html = html(panel.webview, c, vscode.workspace.getConfiguration("cai").get<boolean>("notasEnLinea", false));
      panel.webview.onDidReceiveMessage(async (m: { cmd: string; datos: Record<string, string | boolean> }) => {
        if (m.cmd !== "guardar") return;
        try {
          await guardar(cwd, m.datos);
          vscode.window.setStatusBarMessage("ComplementAIry: configuración guardada ✓", 4000);
          panel?.dispose();
        } catch (e) {
          mostrarError(e);
        }
      });
    }),
  );
}

/** Valores que muestra el formulario cuando el archivo no dice nada (los mismos que usa la CLI). */
function inicial(c: ConfigProyecto, enLinea: boolean): Record<string, string | boolean> {
  const s = vscode.workspace.getConfiguration("cai").get<string>("vista", "proyecto");
  return {
    modo: c.modo ?? "programar",
    procesoAbierto: c.rapidas?.procesoAbierto !== false,
    ayuda: c.ayuda?.porDefecto ?? "auto",
    rapidas: c.rapidas?.activas !== false,
    rapidasEspera: String((c.rapidas?.esperaMs ?? 1200) / 1000),
    soloConNota: c.rapidas?.soloConNota === true,
    maxHoraRapidas: String(c.rapidas?.maxHora ?? 240),
    nivel: c.acompanar?.nivel ?? "normal",
    revisar: c.acompanar?.revisar !== false,
    verificar: c.acompanar?.verificar !== false,
    espera: String(c.acompanar?.esperaAutoguardado ?? 45),
    maxHora: String(c.acompanar?.maxLlamadasHora ?? 20),
    chico: c.ia?.modelos?.chico ?? "claude-haiku-4-5",
    mediano: c.ia?.modelos?.mediano ?? "claude-sonnet-5-5",
    grande: c.ia?.modelos?.grande ?? "claude-opus-5-5",
    vista: c.vista ?? (s === "comentarios" ? "comentarios" : "notas"),
    tests: c.tests?.carpeta ?? "tests",
    enLinea,
  };
}

/** Escribe SOLO lo que cambiaste (o lo que ya estaba escrito): no fija valores por defecto ni toca el resto del archivo. */
async function guardar(cwd: string, d: Record<string, string | boolean>): Promise<void> {
  const file = path.join(dataDir(cwd), "config.json");
  const actual = leerConfig(cwd, true);
  const antes = inicial(actual, vscode.workspace.getConfiguration("cai").get<boolean>("notasEnLinea", false));
  const nuevo = JSON.parse(JSON.stringify(actual)) as Record<string, unknown>;
  const num = (k: string, min: number, max: number) => {
    const n = Number(d[k]);
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(`"${k}" tiene que ser un número entre ${min} y ${max} (recibí "${d[k]}")`);
    return n;
  };
  const poner = (ruta: string[], k: string, valor: unknown) => {
    const cambio = String(d[k]) !== String(antes[k]);
    let o = nuevo;
    for (const p of ruta.slice(0, -1)) o = (o[p] ??= {}) as Record<string, unknown>;
    const ultima = ruta[ruta.length - 1]!;
    if (cambio || ultima in o) o[ultima] = valor;
  };
  const texto = (k: string) => String(d[k] ?? "").trim();
  poner(["vista"], "vista", texto("vista") === "comentarios" ? "comentarios" : "notas");
  poner(["modo"], "modo", texto("modo") === "aprender" ? "aprender" : "programar");
  poner(["rapidas", "procesoAbierto"], "procesoAbierto", d.procesoAbierto === true);
  poner(["ayuda", "porDefecto"], "ayuda", texto("ayuda") || "auto");
  poner(["rapidas", "activas"], "rapidas", d.rapidas === true);
  poner(["rapidas", "esperaMs"], "rapidasEspera", num("rapidasEspera", 0.6, 30) * 1000);
  poner(["rapidas", "soloConNota"], "soloConNota", d.soloConNota === true);
  poner(["rapidas", "maxHora"], "maxHoraRapidas", num("maxHoraRapidas", 0, 2000));
  poner(["acompanar", "nivel"], "nivel", texto("nivel") || "normal");
  poner(["acompanar", "revisar"], "revisar", d.revisar === true);
  poner(["acompanar", "verificar"], "verificar", d.verificar === true);
  poner(["acompanar", "esperaAutoguardado"], "espera", num("espera", 5, 600));
  poner(["acompanar", "maxLlamadasHora"], "maxHora", num("maxHora", 0, 500));
  poner(["ia", "modelos", "chico"], "chico", texto("chico") || "claude-haiku-4-5");
  poner(["ia", "modelos", "mediano"], "mediano", texto("mediano") || "claude-sonnet-5-5");
  poner(["ia", "modelos", "grande"], "grande", texto("grande") || "claude-opus-5-5");
  poner(["tests", "carpeta"], "tests", texto("tests") || "tests");
  // Objetos que quedaron vacíos (nada cambió ahí) no se escriben.
  for (const [k, v] of Object.entries(nuevo)) if (v && typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length && !(k in actual)) delete nuevo[k];
  const ia = nuevo.ia as { modelos?: object } | undefined;
  if (ia?.modelos && !Object.keys(ia.modelos).length) delete ia.modelos;
  if (ia && !Object.keys(ia).length && !("ia" in actual)) delete nuevo.ia;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(nuevo, null, 2) + "\n");
  if (d.enLinea !== antes.enLinea) await vscode.workspace.getConfiguration("cai").update("notasEnLinea", d.enLinea === true, vscode.ConfigurationTarget.Global);
}

function html(w: vscode.Webview, c: ConfigProyecto, enLinea: boolean): string {
  const nonce = Math.random().toString(36).slice(2);
  const sel = (id: string, valor: string, ops: [string, string][]) =>
    `<select id="${id}">${ops.map(([v, t]) => `<option value="${v}"${v === valor ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
  const chk = (id: string, on: boolean) => `<input type="checkbox" id="${id}"${on ? " checked" : ""}>`;
  const txt = (id: string, v: string, lista?: string) => `<input id="${id}" value="${esc(v)}"${lista ? ` list="${lista}"` : ""}>`;
  const numero = (id: string, v: number, paso = 1) => `<input id="${id}" type="number" step="${paso}" value="${v}">`;
  const fila = (titulo: string, control: string, ayuda: string) => `<div class="fila"><label>${titulo}</label><div>${control}<div class="ayuda">${ayuda}</div></div></div>`;
  const a = c.acompanar ?? {};
  const m = c.ia?.modelos ?? {};
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${w.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:12px 20px;max-width:760px}
h1{font-size:1.3em}h2{font-size:1.05em;margin-top:22px;border-bottom:1px solid var(--vscode-widget-border,rgba(128,128,128,.3));padding-bottom:4px}
.fila{display:grid;grid-template-columns:220px 1fr;gap:10px;margin:10px 0;align-items:start}
@media (max-width:560px){.fila{grid-template-columns:1fr}}
.ayuda{font-size:.9em;color:var(--vscode-descriptionForeground);margin-top:3px}
input,select{font:inherit;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,rgba(128,128,128,.4));padding:3px 6px}
input[type=number]{width:90px}input:not([type]){width:260px;max-width:100%}
button{font:inherit;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:0;padding:6px 14px;border-radius:3px;cursor:pointer;margin-top:18px}
</style></head><body>
<h1>ComplementAIry: configuración</h1>
<div class="ayuda">Se guarda en <code>.cai/config.json</code> de este proyecto (lo demás de ese archivo se conserva).</div>
<h2>Modo</h2>
${fila("Modo del proyecto", sel("modo", c.modo ?? "programar", [["programar", "🚀 Programar: ayuda directa, snippets, sugerencias rápidas"], ["aprender", "🎓 Aprender: ayuda gradual, predecir, explicar con tus palabras"]]), "Se puede cambiar por carpeta, archivo o función desde la barra de estado o el panel Nota (gana el más específico). Cambiar de modo no toca lo ya hecho: notas, tareas, estructura y panorama quedan igual.")}
<h2>Ayuda</h2>
${fila("Al preguntar, dame", sel("ayuda", c.ayuda?.porDefecto ?? "auto", [["auto", "Según mi nivel (automático)"], ["pista", "💡 Una pista"], ["piezas", "🧩 Las piezas (funciones/APIs)"], ["pseudo", "📝 Pseudocódigo"], ["ejemplo", "🔁 Un ejemplo análogo"]]), "Lo que responde cuando preguntas sin pedir un escalón. Siempre puedes pedir otro con los botones o \"no entiendo\" para subir uno.")}
${fila("Guía mientras escribes", chk("rapidas", c.rapidas?.activas !== false), "Texto gris al final de la línea del cursor: qué sigue o qué está mal ahí. Se actualiza en cada pausa. No se inserta nada.")}
${fila("Proceso de Claude Code abierto", chk("procesoAbierto", c.rapidas?.procesoAbierto !== false), "Mantiene Claude Code arrancado para las sugerencias rápidas: ~1 s y ~US$0,002 cada una (sin él, ~20 s). Si falla, se usa la llamada normal.")}
${fila("Pausa antes de guiar (s)", numero("rapidasEspera", (c.rapidas?.esperaMs ?? 1200) / 1000, 0.2), "Segundos sin escribir antes de actualizar la guía de la línea.")}
${fila("Solo en funciones con nota", chk("soloConNota", c.rapidas?.soloConNota === true), "Apagado: te guía en cualquier función (en las que tienen nota, siguiendo sus pasos).")}
${fila("Tope de guías por hora", numero("maxHoraRapidas", c.rapidas?.maxHora ?? 240), "Cada una cuesta ~US$0,002 con el proceso abierto (240/h ≈ US$0,50/h como máximo).")}
<h2>Acompañante (al guardar)</h2>
${fila("Nivel", sel("nivel", a.nivel ?? "normal", [["silencioso", "Silencioso: solo responde lo que preguntas"], ["normal", "Normal: planos, ayuda si te trabas, comentarios"], ["activo", "Activo: ayuda antes"]]), "")}
${fila("Comentar lo que terminas", chk("revisar", a.revisar !== false), "Al terminar una función, una revisión corta en su nota.")}
${fila("\"¿Quedó lista?\" al guardar", chk("verificar", a.verificar !== false), "Verifica las funciones con nota que cambiaron (primero sin IA, después el modelo chico).")}
${fila("Con autoguardado, esperar (s)", numero("espera", a.esperaAutoguardado ?? 45), "Con Ctrl+S actúa enseguida; con autoguardado espera a que dejes de editar este tiempo.")}
${fila("Máximo de llamadas por hora", numero("maxHora", a.maxLlamadasHora ?? 20), "Límite para el acompañante automático (lo que pides tú no cuenta).")}
<h2>Modelos (todos a través de tu Claude Code)</h2>
<datalist id="modelos">${MODELOS.map((x) => `<option value="${x}">`).join("")}</datalist>
${fila("Chico", txt("chico", m.chico ?? "claude-haiku-4-5", "modelos"), "Sugerencias rápidas, comentario al terminar una función, verificar al guardar, conversar sobre preguntas.")}
${fila("Mediano", txt("mediano", m.mediano ?? "claude-sonnet-5-5", "modelos"), "Responder notas, revisar un archivo, \"¿quedó lista?\" con el botón, tests, plano de un archivo.")}
${fila("Grande", txt("grande", m.grande ?? "claude-opus-5-5", "modelos"), "Panorama, estructura del proyecto, conocer, arquitectura.")}
<h2>Dónde se ve</h2>
${fila("Vista", sel("vista", String(inicial(c, enLinea).vista), [["notas", "Notas (panel Nota; el archivo no se toca)"], ["comentarios", "Comentarios @guia dentro del archivo"]]), "")}
${fila("Notas también dentro del código", chk("enLinea", enLinea), "Hilos de VSCode entre las líneas (como antes). Apagado: solo el ícono del margen y el panel Nota.")}
${fila("Carpeta de tests", txt("tests", c.tests?.carpeta ?? "tests"), "")}
<button id="guardar">Guardar</button>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
document.getElementById("guardar").addEventListener("click", () => {
  const datos = {};
  for (const el of document.querySelectorAll("input[id],select[id]")) datos[el.id] = el.type === "checkbox" ? el.checked : el.value;
  vscode.postMessage({ cmd: "guardar", datos });
});
</script></body></html>`;
}
