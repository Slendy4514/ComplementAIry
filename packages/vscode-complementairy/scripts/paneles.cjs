// Prueba de los paneles v1 (Tarea y Comprensión) con un `vscode` simulado y la CLI REAL de ComplementAIry,
// sobre un proyecto temporal sin IA: se dibujan, muestran lo que falta y sus botones corren los comandos de
// verdad (incluido el rechazo de «sí» y la evidencia por tramo). Uso: node scripts/paneles.cjs (después de
// compilar la CLI y la extensión).
const Module = require("node:module");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { execFileSync } = require("node:child_process");

const CLI = path.join(__dirname, "..", "..", "complementairy", "dist", "cli.js");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cai-paneles-"));
process.env.CAI_HOME = path.join(dir, ".home");
const archivo = path.join(dir, "src", "users.ts");

// --- Un proyecto con una tarea en borrador y otra en revisión (sin IA) ------------------------------------
const w = (f, s) => {
  fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
  fs.writeFileSync(path.join(dir, f), s);
};
execFileSync("git", ["init", "-q"], { cwd: dir });
execFileSync("git", ["config", "user.email", "yo@ejemplo.cl"], { cwd: dir });
execFileSync("git", ["config", "user.name", "Yo"], { cwd: dir });
// solo-local y sin motores locales: ninguna IA disponible, corre el piso determinista (rápido y repetible).
w(".cai/config.json", JSON.stringify({ version: 1, ia: { privacidad: "solo-local", decisor: { cadena: ["nada:"] } } }));
w("src/users.ts", 'export function obtenerUsuario(id: number) {\n  return { id, nombre: "Ana" };\n}\n');
execFileSync("git", ["add", "-A"], { cwd: dir });
execFileSync("git", ["commit", "-qm", "inicio"], { cwd: dir });

// --- vscode simulado: lo justo para los paneles ------------------------------------------------------------
const nada = () => ({ dispose() {} });
/** Lo que el simulado no define a mano: un objeto que acepta cualquier acceso o llamada (como en humo.cjs). */
function falso(nombre) {
  const f = function () {};
  return new Proxy(f, {
    get(_, k) {
      if (k === Symbol.toPrimitive || k === "toString" || k === "valueOf") return () => nombre;
      if (k === Symbol.iterator) return function* () {};
      if (k === "then") return undefined;
      return falso(`${nombre}.${String(k)}`);
    },
    apply: () => falso(`${nombre}()`),
    construct: () => falso(`new ${nombre}`),
  });
}
/** Completa un objeto a mano con `falso` para lo que falte, en todos sus niveles. */
const completar = (o, nombre) =>
  new Proxy(o, {
    get(t, k) {
      if (k in t) return t[k] && typeof t[k] === "object" && !Array.isArray(t[k]) ? completar(t[k], `${nombre}.${String(k)}`) : t[k];
      return falso(`${nombre}.${String(k)}`);
    },
  });
const evento = () => nada;
const proveedores = {};
const vscode = completar({
  window: {
    activeTextEditor: { document: { uri: { fsPath: archivo, scheme: "file", toString: () => `file://${archivo}` } } },
    createOutputChannel: () => ({ append() {}, appendLine() {}, show() {}, clear() {} }),
    registerWebviewViewProvider: (id, p) => ((proveedores[id] = p), nada()),
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    setStatusBarMessage: nada,
    onDidChangeActiveTextEditor: evento,
  },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: dir } }],
    getWorkspaceFolder: () => ({ uri: { fsPath: dir } }),
    getConfiguration: () => ({ get: (k, d) => (k === "comando" ? `node ${CLI}` : d), update: async () => {} }),
    createFileSystemWatcher: () => ({ onDidChange: evento, onDidCreate: evento, onDidDelete: evento, dispose() {} }),
    onDidSaveTextDocument: evento,
    onDidChangeTextDocument: evento,
    textDocuments: [],
  },
  commands: { registerCommand: () => nada(), executeCommand: async () => undefined },
  Uri: { file: (p) => ({ fsPath: p }) },
  Range: class {},
  ProgressLocation: {},
  ConfigurationTarget: { Global: 1 },
  ThemeColor: class {},
  OverviewRulerLane: { Left: 1 },
  TextEditorRevealType: {},
}, "vscode");
const cargar = Module._load;
Module._load = function (pedido, ...resto) {
  return pedido === "vscode" ? vscode : cargar.call(this, pedido, ...resto);
};

const nodo = (codigo) => execFileSync("node", ["--input-type=module", "-e", codigo], { cwd: dir, encoding: "utf8", env: process.env });
const dist = path.join(__dirname, "..", "..", "complementairy", "dist");

/** Una vista web simulada: guarda el HTML que dibuja y deja mandarle mensajes como si hicieras clic. */
function vista() {
  const v = { html: "", recibir: null };
  v.webview = { options: {}, cspSource: "vscode-resource:", onDidReceiveMessage: (fn) => ((v.recibir = fn), nada()) };
  Object.defineProperty(v.webview, "html", { set: (h) => (v.html = h), get: () => v.html });
  return v;
}
const esperar = async (cond, que, ms = 20000) => {
  const hasta = Date.now() + ms;
  while (Date.now() < hasta) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`no pasó: ${que}`);
};
/** El aviso que dejó el último clic (salida de la CLI o su error). */
const aviso = (html) => (html.match(/<pre class="aviso">([\s\S]*?)<\/pre>/) ?? [])[1] ?? "";
/** Hace clic y espera a que el aviso cambie y cumpla `cond`. */
async function clic(v, msj, cond, que) {
  const antes = aviso(v.html);
  v.recibir(msj);
  await esperar(() => aviso(v.html) && aviso(v.html) !== antes, `${que} (el panel no respondió)`);
  const a = aviso(v.html);
  if (process.env.VER) console.log(`· ${que}:\n  ${a.split("\n").join("\n  ")}`);
  if (!cond(a)) throw new Error(`${que}: el aviso fue\n${a}`);
  return a;
}
const debe = (html, texto, que) => {
  if (!html.includes(texto)) throw new Error(`${que}: el panel no muestra «${texto}»\n${html.replace(/<style>[\s\S]*?<\/style>/, "").slice(0, 1500)}`);
};

async function main() {
  // t1 en borrador (entrevista); t2 con código de la IA en revisión.
  nodo(`const t = await import(${JSON.stringify(path.join(dist, "proyecto/tareas.js"))});
    t.crearTarea(${JSON.stringify(dir)}, { titulo: "Campo editable en obtenerUsuario" });
    const t2 = t.crearTarea(${JSON.stringify(dir)}, { titulo: "Validar el id" });
    t.conTarea(${JSON.stringify(dir)}, t2.id, (x) => ({ ...x, estado: "en-revision", tocados: ["src/users.ts"], restricciones: { ...x.restricciones, alcance: ["src/users.ts"] } }));
    const p = await import(${JSON.stringify(path.join(dist, "proyecto/procedencia.js"))});
    const fs = await import("node:fs");
    p.asentar(${JSON.stringify(dir)}, "src/users.ts", fs.readFileSync("src/users.ts", "utf8"), { origen: "humano" });
    const nuevo = 'export function obtenerUsuario(id: number) {\\n  if (!Number.isInteger(id)) throw new RangeError("id inválido: " + id);\\n  return { id, nombre: "Ana" };\\n}\\n';
    fs.writeFileSync("src/users.ts", nuevo);
    p.asentar(${JSON.stringify(dir)}, "src/users.ts", nuevo, { origen: "ia", tarea: t2.id });`);

  const { TareaView } = require(path.join(__dirname, "..", "out", "tareaView.js"));
  const { ComprensionView } = require(path.join(__dirname, "..", "out", "comprensionView.js"));

  // --- Panel Tarea ---
  const tarea = new TareaView();
  tarea.registrar({ subscriptions: { push() {} } });
  const vt = vista();
  proveedores["cai.tarea"].resolveWebviewView(vt);
  await esperar(() => vt.html.includes("Falta") || vt.html.includes("Siguiente"), "el panel Tarea se dibuja");
  debe(vt.html, "t1", "lista de tareas");
  // Elegir t1 (borrador): entrevista y diseño.
  vt.recibir({ cmd: "elegir", arg: "t1" });
  await esperar(() => vt.html.includes("Entrevista de restricciones"), "t1 muestra la entrevista");
  debe(vt.html, "¿Qué archivos o carpetas se pueden tocar?", "pregunta de alcance");
  debe(vt.html, "Tu diseño", "formulario de diseño");
  // «sí» se rechaza (piso determinista, sin IA).
  await clic(vt, { cmd: "responder", arg: "alcance", campos: { r_alcance: "sí" } }, (a) => a.startsWith("✘"), "«sí» se rechaza en el panel");
  // Una respuesta con contenido se guarda.
  await clic(vt, { cmd: "responder", arg: "alcance", campos: { r_alcance: "solo src/users.ts, el resto no se toca" } }, (a) => !a.startsWith("✘"), "la respuesta se acepta");
  await esperar(() => vt.html.includes("solo src/users.ts, el resto no se toca"), "la respuesta queda a la vista");
  const t1 = JSON.parse(fs.readFileSync(path.join(dir, ".cai", "tareas", "t1", "tarea.json"), "utf8"));
  if (JSON.stringify(t1.restricciones.alcance) !== '["src/users.ts"]' || t1.diseno.contexto.some((c) => /resto/.test(c))) throw new Error(`la respuesta no se tradujo bien: ${JSON.stringify({ alcance: t1.restricciones.alcance, contexto: t1.diseno.contexto })}`);
  // t2 en revisión: el tramo de la IA, con lo que se pide y su formulario.
  vt.recibir({ cmd: "elegir", arg: "t2" });
  await esperar(() => vt.html.includes("Revisión: tu evidencia por tramo"), "t2 muestra la revisión");
  debe(vt.html, "src/users.ts:2-2", "el tramo de la IA");
  debe(vt.html, "RangeError", "el código del tramo");
  // Una explicación de relleno se rechaza (piso determinista).
  await clic(vt, { cmd: "explicacion", arg: "1", campos: { e_1: "valida cosas" } }, (a) => a.startsWith("✘"), "la explicación de relleno se rechaza");
  // Sin seguridad declarada no se ejecuta la predicción; con ella, se ejecuta de verdad y acierta.
  await clic(vt, { cmd: "prediccion", arg: "1", campos: { l_1: "obtenerUsuario(1.5)", x_1: "error: id inválido: 1.5" } }, (a) => a.startsWith("✘") && a.includes("seguro"), "pide la seguridad antes de ejecutar");
  await clic(vt, { cmd: "prediccion", arg: "1", campos: { l_1: "obtenerUsuario(1.5)", x_1: "error: id inválido: 1.5", s_1: "4" } }, (a) => !a.startsWith("✘"), "la predicción se ejecuta y acierta");
  // Y quedó guardada como evidencia válida (lo que mira el pre-commit), no solo dicha en pantalla.
  const evs = fs.readdirSync(path.join(dir, ".cai", "evidencias")).map((f) => JSON.parse(fs.readFileSync(path.join(dir, ".cai", "evidencias", f), "utf8")));
  if (!evs.some((e) => e.tipo === "prediccion" && e.ok && e.seguridad === 4)) throw new Error(`no quedó la evidencia de predicción: ${JSON.stringify(evs)}`);
  if (evs.some((e) => e.tipo === "explicacion" && e.ok)) throw new Error("la explicación de relleno quedó como válida");

  // --- Panel Comprensión ---
  const comp = new ComprensionView();
  comp.registrar({ subscriptions: { push() {} } });
  const vc = vista();
  proveedores["cai.comprension"].resolveWebviewView(vc);
  await esperar(() => vc.html.includes("Lo que no revisó un humano, por riesgo"), "el panel Comprensión se dibuja");
  const cuerpos = {
    semana: /<pre class="txt">[^<]*Tareas cerradas/,
    yo: /Kata \(ganar una licencia/,
    repaso: /Sin mirar el código|Nada que repasar hoy/,
    reconstruir: /oráculo oculto/,
    recorrido: /Antes de leer cada función|Nada riesgoso sin entender/,
  };
  for (const [p, re] of Object.entries(cuerpos)) {
    vc.recibir({ cmd: "pestana", arg: p });
    await esperar(() => re.test(vc.html) || /class="aviso"/.test(vc.html), `pestaña ${p}`);
    if (!re.test(vc.html)) throw new Error(`la pestaña ${p} falló: ${aviso(vc.html) || vc.html.match(/<div class="aviso">([\s\S]*?)<\/div>/)?.[1]}`);
  }
  console.log("✓ paneles Tarea y Comprensión: se dibujan y sus botones corren la CLI real (respuesta, rechazo de «sí», revisión, predicción ejecutada, pestañas)");
}

main()
  .then(() => (fs.rmSync(dir, { recursive: true, force: true }), process.exit(0)))
  .catch((e) => {
    console.error("✗", e && e.stack ? e.stack : e);
    fs.rmSync(dir, { recursive: true, force: true });
    process.exit(1);
  });
