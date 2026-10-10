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

// Seguridad: un proyecto clonado no puede cambiar el comando que se ejecuta, y nada pasa por un shell.
{
  const fs = require("node:fs");
  const pkg = require("../package.json");
  const comando = pkg.contributes.configuration.properties["cai.comando"];
  if (comando.scope !== "machine") throw new Error('cai.comando debe tener "scope": "machine" (si no, un .vscode/settings.json del repo lo cambia)');
  if (pkg.capabilities?.untrustedWorkspaces?.supported !== false) throw new Error("la extensión no debe correr en carpetas sin confianza (capabilities.untrustedWorkspaces)");
  const out = path.join(__dirname, "..", "out");
  for (const f of fs.readdirSync(out).filter((x) => x.endsWith(".js")))
    if (/["']sh["'],\s*\[\s*["']-c["']/.test(fs.readFileSync(path.join(out, f), "utf8"))) throw new Error(`${f} ejecuta la CLI con "sh -c": usa correr()/comandoCli() (sin shell)`);
}

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
// El bloque "construir juntos" del panel Nota se dibuja con una propuesta de ejemplo (stepper, porción
// que toca con sus campos, sin cajas en la barra de arriba).
function construirSeDibuja() {
  const fs = require("node:fs");
  const os = require("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cai-humo-"));
  try {
    fs.mkdirSync(path.join(dir, ".cai", "cache", "propuestas"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".cai", "config.json"), JSON.stringify({ modo: "programar", modosVersion: 2 }));
    const prop = {
      tipo: "construir", archivo: "a.js", funcion: "doble", fecha: "2026-10-10T00:00:00Z", costo: 0,
      codigo: 'function doble(x) {\n  if (typeof x !== "number") throw new Error("x");\n}',
      porciones: [{ desde: 2, hasta: 2, paso: 1, porque: "Valida.", pruebas: [], aprobada: false, incluida: true, codigo: '  if (typeof x !== "number") throw new Error("x");', orden: "haz que lance si x no es number", entrada: 'doble("a")', verificacion: { agregado: ["también rechaza NaN"], falta: [] } }],
      construir: { ayuda: "sugerir", pasosPlan: 3, base: { cabecera: ["function doble(x) {"], cierre: ["}"], sangria: "  " }, ofertas: [{ paso: 2, idea: "Devolvería x por dos.", alternativas: [] }, { paso: 3, idea: "Redondearía.", alternativas: [] }], previo: [{ texto: "No validas x.", porque: "da NaN", estado: "pendiente" }] },
    };
    fs.writeFileSync(path.join(dir, ".cai", "cache", "propuestas", `${encodeURIComponent("a.js")}#doble.json`), JSON.stringify(prop));
    // Probar sin escribir llamadas: un campo por parámetro; la llamada la arma el panel.
    const comun = require(path.join(__dirname, "..", "out", "comun.js"));
    const igual = (a, b, que) => {
      if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${que}: se esperaba ${JSON.stringify(b)} y dio ${JSON.stringify(a)}`);
    };
    igual(comun.parametrosDe("export function slug(titulo: string, max = 10, ...resto: string[]) {"), ["titulo", "max", "…resto"], "parámetros TS");
    igual(comun.parametrosDe("def f(self, a: int = 1, b=None):"), ["a", "b"], "parámetros Python");
    igual(comun.parametrosDe("function f({ a, b } = {}, c) {"), ["{ a, b }", "c"], "parámetros desestructurados");
    igual(comun.argumentosDe('slug("a, b", [1, 2], { x: 1 })'), ['"a, b"', "[1, 2]", "{ x: 1 }"], "argumentos de una llamada");
    igual(comun.armarLlamada("slug", ["Canción Ñandú", "5", "", ""]), 'slug("Canción Ñandú", 5)', "armar la llamada (texto sin comillas = texto)");
    igual(comun.armarLlamada("f", ["[1, 2]", "", "true"]), "f([1, 2], undefined, true)", "un campo vacío en el medio");
    igual(comun.armarLlamada("f", ["", "x"], true), 'f(None, "x")', "vacío en Python");
    igual([comun.esperadoLiteral("error: vacío"), comun.esperadoLiteral("hola"), comun.esperadoLiteral('""'), comun.esperadoLiteral("-3.5")], ["error: vacío", '"hola"', '""', "-3.5"], "lo que esperas");
    igual(comun.valorDeCampo('"Hola"'), "Hola", "un texto sugerido se muestra sin comillas");
    const { NotaPanel } = require(path.join(__dirname, "..", "out", "notaView.js"));
    const panel = Object.create(NotaPanel.prototype);
    const nota = { plan: { pasos: [{ texto: "Validar" }, { texto: "Duplicar" }, { texto: "Redondear" }], fecha: "" } };
    const html = panel.bloqueConstruir(dir, "a.js", "doble", nota, false);
    for (const esperado of ['class="chip"', 'data-inicial="plan"', 'data-pagina="paso-3"', 'id="cj-orden-2"', 'id="cj-orden-3"', "Escribir los pasos 2–3", "Puedo hacerlo así", "Sobre lo que ya tenías", "Dejarlo así", "Agregó algo que tu orden no pedía", "Quitarlo", "Tu orden", 'id="cj-espero-0"', 'class="param"', 'id="cj-pr0-a0" data-guardar value="a"', "data-campos", "▶"])
      if (!html.includes(esperado)) throw new Error(`el bloque "construir juntos" no muestra ${esperado}`);
    // Una página por paso: cada paso por escribir tiene su propuesta y su orden JUNTAS (sin subir y bajar).
    const pagina3 = html.split('data-pagina="paso-3"><div class="titulo-paso">')[1]?.split('<div class="pagina"')[0] ?? "";
    if (!pagina3.includes("Puedo hacerlo así") || !pagina3.includes('id="cj-orden-3"')) throw new Error("la página del paso 3 no tiene su propuesta y su orden juntas");
    // El script del panel Nota (no lo ve el compilador: es texto): que al menos sea JavaScript válido.
    const esqueleto = panel.esqueleto({ cspSource: "vscode-resource:" });
    const script = esqueleto.split(/<script nonce="[^"]*">/)[1]?.split("</script>")[0] ?? "";
    if (!script.includes("mostrarPagina")) throw new Error("el script del panel no tiene la navegación por páginas");
    try {
      new Function(script);
    } catch (e) {
      throw new Error(`el script del panel Nota tiene un error de sintaxis: ${e.message}`);
    }
    // Por pedidos (modo programar): pedir, separar y auditoría final después de tu predicción.
    const codigoP = 'function doble(x) {\n  return x * 2;\n}';
    const pedido = {
      tipo: "construir", archivo: "a.js", funcion: "doble", fecha: "2026-10-10T00:00:00Z", costo: 0, codigo: codigoP,
      porciones: [{ desde: 2, hasta: 2, paso: 0, tipo: "ajuste", porque: "", pruebas: [], aprobada: false, incluida: true, codigo: "  return x * 2;", orden: "que devuelva el doble de x", entrada: "doble(3)" }],
      construir: { ayuda: "sugerir", forma: "pedido", base: { cabecera: ["function doble(x) {"], cierre: ["}"], sangria: "  " }, historial: [[]], casos: [{ descripcion: "d", llamada: "doble(0)", esperado: "0", obtenido: "0", pasa: true }], prediccion: { llamada: "doble(0)" }, auditoria: { estado: "lista", resumen: "ok", casos: [], queHacer: [], hallazgos: [], ideal: { descripcion: "igual", codigo: "x" }, codigo: codigoP, fecha: "" }, separar: { pedido: "que lea y mueva", motivo: "hace dos cosas", auxiliares: [{ nombre: "leer", firma: "leer(ruta)", proposito: "lee" }] } },
    };
    fs.writeFileSync(path.join(dir, ".cai", "cache", "propuestas", `${encodeURIComponent("a.js")}#doble.json`), JSON.stringify(pedido));
    const htmlP = panel.bloqueProgramar(dir, "a.js", "doble", { plan: undefined }, false);
    for (const esperado of ["Construir con tus pedidos", 'data-inicial="auditoria"', "Pide un cambio", 'id="cj-pedido"', "Es mucho para una función", "Crear estas funciones vacías", "Antes de ver la auditoría", "Deshacer el último pedido", 'id="cj-pr0-a0" data-guardar value="3"'])
      if (!htmlP.includes(esperado)) throw new Error(`el modo por pedidos no muestra ${esperado}`);
    if (htmlP.includes("Versión ideal")) throw new Error("la auditoría se ve antes de tu predicción");
    if (/showInputBox/.test(fs.readFileSync(path.join(__dirname, "..", "out", "notaView.js"), "utf8").split("bloqueConstruir")[1]?.split("insertarPropuesta(")[0] ?? ""))
      throw new Error("construir juntos no debe usar cajas en la barra de arriba (showInputBox)");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

Promise.resolve()
  .then(() => construirSeDibuja())
  .then(() => ext.activate(ctx))
  .then(() => setTimeout(() => (console.log("✓ la extensión carga y se activa (y dibuja 'construir juntos')"), process.exit(0)), 1500))
  .catch(fallar);
