import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.js";
import { contextBlock, projectContext } from "./context.js";
import { ask } from "./llm.js";
import { home, loadPerfil, nivelDe, puntaje, registrar } from "./profile.js";
import { iaOpts } from "./tutor.js";

/**
 * La guía también en la terminal: explicar un comando antes de correrlo, responder preguntas
 * con la misma escalera de pistas y explicar el último error. La IA explica; nunca ejecuta.
 */

/** Riesgos detectados sin IA (patrones conocidos). */
const RIESGOS: [RegExp, string][] = [
  [/\brm\s+(-\w*r\w*f|-\w*f\w*r)\b/, "borra recursivamente sin preguntar (rm -rf): no hay papelera"],
  [/\bsudo\b/, "corre con permisos de administrador"],
  [/--force\b|\s-f\b/, "fuerza la operación saltando protecciones (--force / -f)"],
  [/\bgit\s+reset\s+--hard\b/, "descarta cambios sin commitear (git reset --hard)"],
  [/\bgit\s+push\b.*(--force|\s-f\b)/, "reescribe el historial remoto (push forzado)"],
  [/\bgit\s+clean\s+-\w*f/, "borra archivos no versionados (git clean -f)"],
  [/\bchmod\s+(-R\s+)?777\b/, "da permisos totales a todos (chmod 777)"],
  [/\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(sh|bash)\b/, "ejecuta un script descargado sin revisarlo (curl | sh)"],
  [/\bdd\s+if=/, "escribe bytes crudos en un destino (dd): un error puede borrar un disco"],
  [/\bmkfs\b/, "formatea un sistema de archivos"],
  [/(^|[^>])>\s*[^&\s|]/, "redirige con > : sobrescribe el archivo destino"],
  [/\bdocker\s+(system|volume|image)\s+prune\b/, "borra recursos de Docker"],
  [/\bDROP\s+(TABLE|DATABASE)\b|\bTRUNCATE\b/i, "borra datos de la base"],
  [/\bnpm\s+publish\b|\bpnpm\s+publish\b/, "publica un paquete (público e irreversible)"],
];

export function riesgos(cmd: string): string[] {
  return RIESGOS.filter(([re]) => re.test(cmd)).map(([, why]) => why);
}

/** Tema de perfil para un comando: su primera palabra (git, docker, pnpm...). */
const temaDe = (cmd: string) => cmd.trim().split(/\s+/).find((w) => !/^(sudo|env|time|\w+=\S*)$/.test(w)) ?? "terminal";

const EXPLICA_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["resumen", "partes", "riesgos", "docs"],
  properties: {
    resumen: { type: "string" },
    partes: { type: "array", items: { type: "object", additionalProperties: false, required: ["fragmento", "significado"], properties: { fragmento: { type: "string" }, significado: { type: "string" } } } },
    riesgos: { type: "array", items: { type: "string" } },
    docs: { type: "array", items: { type: "string" } },
  },
};

const BASE = `Sos el tutor de terminal de AICode. Explicás; nunca ejecutás nada ni proponés ejecutarlo por el usuario.
Español neutro con tuteo, concreto y CORTO: máximo ~120 palabras por respuesta (en "explica": resumen de 2 oraciones, una oración por parte, máximo 4 riesgos). Adaptate al nivel: aprendiz = explicá cada término; experto = mínimo.
Links solo a documentación oficial que conozcas con certeza (man pages, docs.docker.com, git-scm.com, docs del paquete).`;

export async function explica(root: string, cmd: string): Promise<string> {
  const tema = temaDe(cmd);
  const nivel = nivelDe(puntaje(loadPerfil(), tema));
  const det = riesgos(cmd);
  const { data } = await ask<{ resumen: string; partes: { fragmento: string; significado: string }[]; riesgos: string[]; docs: string[] }>({
    kind: "explica",
    system: BASE,
    cwd: root,
    schema: EXPLICA_SCHEMA,
    ...iaOpts(loadConfig(root)),
    prompt: `Explicá qué hace este comando, parte por parte, y qué riesgos tiene. Programador: ${nivel} en ${tema}.\nDirectorio: ${root}\nComando: ${cmd}`,
  });
  const out = [`\n${data.resumen}\n`];
  for (const p of data.partes) out.push(`  ${p.fragmento.padEnd(24)} ${p.significado}`);
  const todos = [...new Set([...det.map((d) => `${d} [detectado]`), ...data.riesgos])];
  if (todos.length) out.push("", "⚠ Riesgos:", ...todos.map((r) => `  - ${r}`));
  if (data.docs.length) out.push("", "Docs:", ...data.docs.map((d) => `  ${d}`));
  return out.join("\n");
}

// --- Preguntas con escalera -------------------------------------------------------

interface Conversacion {
  pregunta: string;
  nivel: number;
  historial: { quien: "humano" | "tutor"; texto: string }[];
  tema: string;
  extra?: string;
}

const convFile = () => path.join(home(), "terminal.json");
const loadConv = (): Conversacion | null => {
  try {
    return JSON.parse(fs.readFileSync(convFile(), "utf8")) as Conversacion;
  } catch {
    return null;
  }
};
const saveConv = (c: Conversacion) => {
  fs.mkdirSync(home(), { recursive: true });
  fs.writeFileSync(convFile(), JSON.stringify(c, null, 2));
};

const LADDER = `Escalera (no superes el nivel indicado):
1. Pregunta guía o concepto clave, y qué comando/opción mirar con --help o man.
2. Piezas: comandos u opciones concretas que sirven, con link a la documentación.
3. Pasos en palabras.
4. Un ejemplo análogo (otro caso parecido), explicado. Nunca el comando exacto listo para pegar en su caso.`;

const RESP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["respuesta", "docs"],
  properties: { respuesta: { type: "string" }, docs: { type: "array", items: { type: "string" } } },
};

async function responder(root: string, c: Conversacion): Promise<string> {
  const nivelProg = nivelDe(puntaje(loadPerfil(), c.tema));
  const ctx = contextBlock(projectContext(root, "."));
  const { data } = await ask<{ respuesta: string; docs: string[] }>({
    kind: "pregunta",
    system: `${BASE}\n${LADDER}`,
    cwd: root,
    schema: RESP_SCHEMA,
    ...iaOpts(loadConfig(root)),
    prompt: [
      `Nivel MÁXIMO de la escalera: ${c.nivel}. Programador: ${nivelProg} en ${c.tema}.`,
      ctx,
      c.extra ? `Contexto adicional:\n${c.extra}` : "",
      "Conversación:",
      ...c.historial.map((h) => `${h.quien === "tutor" ? "TUTOR" : "PROGRAMADOR"}: ${h.texto}`),
    ]
      .filter(Boolean)
      .join("\n"),
  });
  c.historial.push({ quien: "tutor", texto: data.respuesta });
  saveConv(c);
  return `\n[nivel ${c.nivel}] ${data.respuesta}${data.docs.length ? `\n\nDocs:\n${data.docs.map((d) => `  ${d}`).join("\n")}` : ""}\n\n(¿Necesitás más? aicode pregunta --mas   ·   ¿Lo intentaste? aicode pregunta --intente "lo que hiciste")`;
}

export async function pregunta(root: string, texto: string, o: { mas?: boolean; intente?: string } = {}): Promise<string> {
  const prev = loadConv();
  if ((o.mas || o.intente) && prev) {
    if (o.mas) {
      prev.nivel = Math.min(4, prev.nivel + 1);
      prev.historial.push({ quien: "humano", texto: "Necesito más ayuda." });
      registrar(prev.tema, -0.02, "pidió más ayuda en terminal");
    } else prev.historial.push({ quien: "humano", texto: `Intenté: ${o.intente}` });
    return responder(root, prev);
  }
  if (!texto.trim()) throw new Error('uso: aicode pregunta "<tu pregunta>"');
  const tema = /\b(docker|git|pnpm|npm|python|pip|bash|ssh|kubectl|sql|postgres|node)\b/i.exec(texto)?.[1]?.toLowerCase() ?? "terminal";
  const nivel = nivelDe(puntaje(loadPerfil(), tema)) === "experto" ? 2 : 1;
  return responder(root, { pregunta: texto, nivel, tema, historial: [{ quien: "humano", texto }] });
}

// --- Correr un comando y entender su error ----------------------------------------

const errFile = () => path.join(home(), "ultimo-error.json");

/** Corre un comando del humano mostrando su salida; si falla, guarda la salida para `aicode error`. */
export function corre(root: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    // Un solo argumento = línea de shell (permite pipes); varios = se citan uno por uno.
    const cmd = args.length === 1 ? args[0]! : args.map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, "'\\''")}'`)).join(" ");
    const child = spawn("sh", ["-c", cmd], { cwd: root, stdio: ["inherit", "pipe", "pipe"] });
    const tail: string[] = [];
    const keep = (b: Buffer) => {
      tail.push(...b.toString("utf8").split("\n"));
      if (tail.length > 200) tail.splice(0, tail.length - 200);
    };
    child.stdout.on("data", (b: Buffer) => {
      process.stdout.write(b);
      keep(b);
    });
    child.stderr.on("data", (b: Buffer) => {
      process.stderr.write(b);
      keep(b);
    });
    child.on("close", (code) => {
      if (code) {
        fs.mkdirSync(home(), { recursive: true });
        fs.writeFileSync(errFile(), JSON.stringify({ cmd, code, cwd: root, salida: tail.join("\n"), fecha: new Date().toISOString() }, null, 2));
        console.error(`\n✗ Falló (código ${code}). Para entender por qué: aicode error`);
      }
      resolve(code ?? 1);
    });
  });
}

export async function error(root: string): Promise<string> {
  let e: { cmd: string; code: number; salida: string };
  try {
    e = JSON.parse(fs.readFileSync(errFile(), "utf8")) as typeof e;
  } catch {
    throw new Error("no hay errores guardados. Corré tus comandos con: aicode corre -- <comando>");
  }
  const tema = temaDe(e.cmd);
  return responder(root, {
    pregunta: `¿Por qué falló \`${e.cmd}\`?`,
    nivel: 1,
    tema,
    extra: `Comando: ${e.cmd}\nCódigo de salida: ${e.code}\nÚltimas líneas de salida:\n${e.salida.slice(-6000)}`,
    historial: [{ quien: "humano", texto: `Corrí \`${e.cmd}\` y falló. ¿Qué significa este error? Ayudame a entenderlo para arreglarlo yo.` }],
  });
}

export const SHELL_SNIPPET = `# AICode en tu shell (pegá en ~/.bashrc o ~/.zshrc)
ia()  { aicode pregunta "$*"; }          # ia cómo veo los logs de un contenedor
iamas() { aicode pregunta --mas; }       # más ayuda sobre la última pregunta
ex()  { aicode explica -- "$@"; }        # ex git rebase -i HEAD~3   (explica, no ejecuta)
c()   { aicode corre -- "$@"; }          # c pnpm test   (si falla: aicode error)
`;
