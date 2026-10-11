// Copia la lógica compartida de la CLI (packages/complementairy/src/compartido.ts) a la extensión
// antes de compilar: una sola fuente para los modos (y lo que se sume), sin reescribirla aquí.
const fs = require("node:fs");
const path = require("node:path");
const origen = path.join(__dirname, "..", "..", "complementairy", "src", "nucleo", "compartido.ts");
const destino = path.join(__dirname, "..", "src", "compartido.ts");
const aviso = "// GENERADO desde packages/complementairy/src/compartido.ts (scripts/compartido.cjs): no lo edites aquí.\n";
fs.writeFileSync(destino, aviso + fs.readFileSync(origen, "utf8"));
