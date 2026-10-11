import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { decidir, setDecisor } from "../../src/ia/decisor.js";
import { permitido } from "../../src/ia/roles.js";
import { esLocal, mejorInstalado, olvidarDeteccion, urlLocal } from "../../src/ia/systemone.js";
import { agregarDecisorLocal, loadConfig } from "../../src/proyecto/config.js";

const CLI = path.join(__dirname, "..", "..", "dist", "cli.js");
let root = "";
let puerto = 0;
let servidor: http.Server;
let instalados = ["tev1:latest", "nimble:latest", "llama3:latest"];
const pedidos: { url: string; body: Record<string, unknown> }[] = [];

/** Un Ollama falso: /api/tags y /v1/systemone con el formato publicado de Jev. */
beforeAll(async () => {
  servidor = http.createServer((req, res) => {
    let txt = "";
    req.on("data", (d) => (txt += d));
    req.on("end", () => {
      if (req.url === "/api/tags") return res.end(JSON.stringify({ models: instalados.map((name) => ({ name })) }));
      if (req.url === "/api/version") return res.end(JSON.stringify({ version: "0.35.0" }));
      if (req.url === "/v1/systemone" && req.method === "POST") {
        const body = JSON.parse(txt) as { model: string; state: string; questions: Record<string, { type: string; instructions?: string }> };
        pedidos.push({ url: req.url, body });
        const vago = /mejora el buscador/.test(body.state);
        const answers = Object.fromEntries(Object.entries(body.questions).map(([k, q]) => [k, q.type === "noul" ? { type: "noul", noul: vago ? 0.93 : 0.08 } : { type: q.type }]));
        return res.end(JSON.stringify({ model: body.model, answers }));
      }
      res.statusCode = 404;
      res.end("{}");
    });
  });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  puerto = (servidor.address() as { port: number }).port;
});
afterAll(() => servidor.close());

const url = () => `http://127.0.0.1:${puerto}/v1/systemone`;
const config = (ia: Record<string, unknown>) => fs.writeFileSync(path.join(root, ".cai", "config.json"), JSON.stringify({ version: 1, ia }));
const caso = (texto: string) => ({ estado: `pedido: ${texto}`, preguntas: { vago: { type: "noul" as const, description: "¿es vago?" } } });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cai-so1-"));
  process.env.CAI_HOME = path.join(root, ".home");
  execFileSync("git", ["init", "-q"], { cwd: root });
  fs.mkdirSync(path.join(root, ".cai"));
  pedidos.length = 0;
  instalados = ["tev1:latest", "nimble:latest", "llama3:latest"];
  olvidarDeteccion();
  setDecisor(null);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("otros System One: Ollama (nimble, tev1), servidores locales y privacidad", () => {
  test("el motor ollama-systemone sin modelo usa el mejor modelo de decisión instalado, con el formato de Jev", async () => {
    config({ privacidad: "solo-local", motores: { "ollama-systemone": { tipo: "systemone", url: url(), local: true } }, decisor: { cadena: ["ollama-systemone:"] } });
    const d = await decidir(loadConfig(root), caso("mejora el buscador"), root, () => ({ vago: { valor: false, confianza: 0 } }));
    expect(d.fuente).toBe("ollama-systemone:nimble");
    expect(d.respuestas.vago).toEqual({ valor: true, confianza: 0.93 });
    expect(pedidos[0]!.body.model).toBe("nimble");
    expect(pedidos[0]!.body.questions).toEqual({ vago: { type: "noul", instructions: "¿es vago?" } });
  });

  test("sin modelos de decisión instalados se salta (y vale lo siguiente de la cadena)", async () => {
    instalados = ["llama3:latest"];
    config({ privacidad: "solo-local", motores: { "ollama-systemone": { tipo: "systemone", url: url(), local: true } }, decisor: { cadena: ["ollama-systemone:"] } });
    const d = await decidir(loadConfig(root), caso("agrega el campo editable"), root, () => ({ vago: { valor: false, confianza: 0.5 } }));
    expect(d.fuente).toBe("heuristica");
    expect(pedidos).toHaveLength(0);
  });

  test("el orden de preferencia sigue el acierto publicado", () => {
    expect(mejorInstalado(["tev1:0.8b", "tev1"])).toBe("tev1");
    expect(mejorInstalado(["tev1", "nimble"])).toBe("nimble");
    expect(mejorInstalado(["llama3"])).toBeNull();
  });

  test("un servidor local propio (laya-serve, kev, von…) se agrega primero en la cadena y responde", async () => {
    const cadena = agregarDecisorLocal(root, "laya", { tipo: "systemone", url: url(), local: true }, "laya:laya", ["claude-code:claude-haiku-5-5"]);
    expect(cadena).toEqual(["laya:laya", "claude-code:claude-haiku-5-5"]);
    const d = await decidir({ ...loadConfig(root), ia: { ...loadConfig(root).ia, privacidad: "solo-local" } }, caso("agrega el campo editable a GET /api/users/:id"), root, () => ({ vago: { valor: true, confianza: 0 } }));
    expect(d.fuente).toBe("laya:laya");
    expect(d.respuestas.vago).toEqual({ valor: false, confianza: 0.92 });
  });

  test("«local: true» con una url de afuera NO cuenta como local (la privacidad no se engaña)", () => {
    expect(urlLocal("http://localhost:11434/v1/systemone")).toBe(true);
    expect(urlLocal("http://host.docker.internal:11434/v1/systemone")).toBe(true);
    expect(urlLocal("https://openrouter.ai/api/v1/systemone")).toBe(false);
    const trucho = { tipo: "systemone" as const, url: "https://ejemplo.com/v1/systemone", local: true };
    expect(esLocal(trucho)).toBe(false);
    config({ privacidad: "solo-local" });
    expect(permitido(loadConfig(root), "trucho", trucho)).toMatch(/no es local/);
    config({});
    expect(permitido(loadConfig(root), "trucho", trucho)).toMatch(/opt-in|optIn/);
  });

  test("CLI: el catálogo detecta lo instalado, --probar consulta de verdad y --agregar rechaza lo que no es local", async () => {
    config({ motores: { "ollama-systemone": { tipo: "systemone", url: url(), local: true } } });
    const correr = (...a: string[]) => promisify(execFile)("node", [CLI, ...a], { cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root } });
    const lista = JSON.parse((await correr("ia", "systemone", "--json")).stdout) as { ollama: { instalados: string[]; elegido: string }; modelos: { id: string; listo: boolean }[] };
    expect(lista.ollama.elegido).toBe("nimble");
    expect(lista.modelos.find((m) => m.id === "tev1")!.listo).toBe(true);
    expect(lista.modelos.find((m) => m.id === "tev1:0.8b")!.listo).toBe(false);
    expect(lista.modelos.map((m) => m.id)).toEqual(expect.arrayContaining(["laya", "kev", "von", "onejev", "openjev", "jev", "jev-openrouter"]));
    const prueba = JSON.parse((await correr("ia", "systemone", "--probar", "ollama-systemone:tev1", "--json")).stdout) as { valor: boolean; esperado: boolean }[];
    expect(prueba.every((f) => f.valor === f.esperado)).toBe(true);
    await expect(correr("ia", "systemone", "--agregar", "laya", "--url", "https://ejemplo.com/v1/systemone")).rejects.toThrow(/no es una dirección de tu máquina/);
  });
});
