// Prueba de humo: carga la extensión compilada con un `vscode` simulado y llama a activate().
// Atrapa los errores que tumban la activación (p. ej. un import circular que deja algo sin definir
// al cargar un módulo), que el compilador no ve. Uso: node scripts/humo.cjs (después de pnpm build).
const Module = require("node:module");
const path = require("node:path");

// Valores concretos donde la extensión necesita datos de verdad (sin proyecto abierto).
const FIJOS = {
  "vscode.workspace.workspaceFolders": undefined,
  "vscode.workspace.textDocuments": [],
  "vscode.window.activeTextEditor": undefined,
  "vscode.window.visibleTextEditors": [],
  "vscode.workspace.getConfiguration()": { get: (_k, d) => d, update: async () => {}, has: () => false, inspect: () => undefined },
};

/** Un objeto que acepta cualquier acceso, llamada o `new` y devuelve otro igual (o lo razonable). */
function falso(nombre) {
  if (nombre in FIJOS) return FIJOS[nombre];
  const f = function () {};
  return new Proxy(f, {
    get(_, k) {
      if (k === Symbol.toPrimitive) return () => nombre;
      if (k === Symbol.iterator) return function* () {};
      if (k === "then") return undefined;
      if (k === "toString" || k === "valueOf") return () => nombre;
      if (k === "length") return 0;
      return falso(`${nombre}.${String(k)}`);
    },
    apply(_, __, args) {
      // Los eventos (onDidX(fn)) y registros devuelven algo con dispose().
      return falso(`${nombre}()`);
    },
    construct() {
      return falso(`new ${nombre}`);
    },
  });
}

const vscode = falso("vscode");
const cargar = Module._load;
Module._load = function (pedido, ...resto) {
  if (pedido === "vscode") return vscode;
  return cargar.call(this, pedido, ...resto);
};

const ext = require(path.join(__dirname, "..", "out", "extension.js"));
const estado = () => ({ get: (_k, d) => d, update: async () => {}, keys: () => [] });
const ctx = {
  subscriptions: { push() {} },
  extensionPath: path.join(__dirname, ".."),
  extensionUri: falso("uri"),
  extension: { packageJSON: require("../package.json"), id: "complementairy.complementairy" },
  globalState: estado(),
  workspaceState: estado(),
  asAbsolutePath: (p) => p,
};
const fallar = (e) => {
  console.error("✗ la extensión NO arranca bien:", e && e.stack ? e.stack : e);
  process.exit(1);
};
// También lo que falla poco después de activar (tareas en segundo plano).
process.on("uncaughtException", fallar);
process.on("unhandledRejection", fallar);
Promise.resolve()
  .then(() => ext.activate(ctx))
  .then(() => setTimeout(() => (console.log("✓ la extensión carga y se activa"), process.exit(0)), 1500))
  .catch(fallar);
