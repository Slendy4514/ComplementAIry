import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { detectAdapters } from "./adapters.js";
import { dataDir, loadConfig, makeZoner } from "./config.js";
import { CRITERIO } from "./context.js";
import { listFiles } from "./files.js";
import { langFor } from "./lang.js";
import { ask } from "./llm.js";
import { actualizarMemoria } from "./panorama.js";
import { iaOpts } from "./tutor.js";

/**
 * `cai conocer`: para arrancar con un proyecto que ya existe. Escanea (sin IA) qué hay y quién
 * escribió qué según git; la IA redacta borradores de proyecto.md y reglas.md y prepara pocas
 * preguntas CON su respuesta probable, para que el programador solo confirme o corrija.
 */

export interface Autoria {
  /** Carpeta (glob) sugerida y por qué. */
  glob: string;
  tipo: "heredado" | "terceros";
  motivo: string;
}

const TERCEROS = /(^|\/)(vendor|third[_-]?party|external|generated|__generated__|gen)(\/|$)|\.min\.(js|css)$/i;

/** Quién escribió qué, según el historial de git (determinista). */
export function sugerirAutoria(root: string, archivos: string[]): { autoria: Autoria[]; resumen: string } {
  const out: Autoria[] = [];
  // Terceros por nombre de carpeta.
  const dirsTerceros = new Set(archivos.filter((f) => TERCEROS.test(f)).map((f) => f.split("/").slice(0, f.split("/").findIndex((p) => TERCEROS.test(p + "/")) + 1).join("/")));
  for (const d of dirsTerceros) if (d) out.push({ glob: `${d}/**`, tipo: "terceros", motivo: "por el nombre de la carpeta (código externo o generado)" });

  let yo = "";
  let log = "";
  try {
    yo = execFileSync("git", ["config", "user.email"], { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim().toLowerCase();
    log = execFileSync("git", ["log", "--no-merges", "--format=%x00%ae", "--name-only"], { cwd: root, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 << 20 }).toString();
  } catch {
    return { autoria: out, resumen: "sin historial de git: no se puede saber quién escribió qué" };
  }
  const autores = new Map<string, Set<string>>();
  for (const bloque of log.split("\0").filter(Boolean)) {
    const [email, ...files] = bloque.split("\n").filter(Boolean);
    for (const f of files) {
      if (!autores.has(f)) autores.set(f, new Set());
      autores.get(f)!.add(email!.toLowerCase());
    }
  }
  const todos = new Set([...autores.values()].flatMap((s) => [...s]));
  const usuario = yo.split("@")[0]!.replace(/^\d+\+/, "");
  const esMio = (e: string) => e === yo || (!!usuario && e.replace(/^\d+\+/, "").startsWith(usuario + "@"));
  if (!yo || ![...todos].some(esMio)) {
    return { autoria: out, resumen: todos.size ? `hay ${todos.size} autor(es) en git y ninguno coincide con tu correo (${yo || "sin configurar"}): no se sugiere autoría` : "el repositorio no tiene commits" };
  }
  // Por carpeta (hasta 2 niveles): si casi nada lo tocaste vos, es candidato a heredado.
  const porDir = new Map<string, { total: number; ajenos: number }>();
  for (const f of archivos) {
    if (!autores.has(f) || TERCEROS.test(f)) continue;
    const partes = f.split("/");
    if (partes.length < 2) continue;
    const dir = partes.slice(0, Math.min(2, partes.length - 1)).join("/");
    const e = porDir.get(dir) ?? { total: 0, ajenos: 0 };
    e.total++;
    if (![...autores.get(f)!].some(esMio)) e.ajenos++;
    porDir.set(dir, e);
  }
  const candidatos = [...porDir].filter(([, e]) => e.total >= 3 && e.ajenos / e.total >= 0.8);
  // Quedarse con la carpeta más alta (si src/ entera es ajena, no listar src/x y src/y).
  for (const [dir, e] of candidatos) {
    if (candidatos.some(([otro]) => otro !== dir && dir.startsWith(otro + "/"))) continue;
    out.push({ glob: `${dir}/**`, tipo: "heredado", motivo: `${e.ajenos} de ${e.total} archivos nunca los modificaste vos (según git)` });
  }
  return { autoria: out, resumen: `${todos.size} autor(es) en el historial` };
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["resumen", "proyecto", "reglas", "preguntas"],
  properties: {
    resumen: { type: "string", description: "Qué es el proyecto, en 1-2 oraciones." },
    proyecto: { type: "string", description: "Borrador de proyecto.md en markdown (sin título): qué hace, para quién, partes principales, estado. 5-12 líneas." },
    reglas: { type: "array", maxItems: 10, items: { type: "string" }, description: "Convenciones que SE VEN en el código (nombres, errores, módulos, tests, formato). Una por ítem, concreta." },
    preguntas: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["pregunta", "sugerencia", "opciones"],
        properties: {
          pregunta: { type: "string" },
          sugerencia: { type: "string", description: "La respuesta más probable según el código." },
          opciones: { type: "array", maxItems: 4, items: { type: "string" } },
        },
      },
    },
  },
};

const SISTEMA = `Ayudas a una persona a arrancar con ComplementAIry en un proyecto que YA existe, para que no tenga que pensar todo desde cero.
- Lee lo necesario (Read/Grep/Glob): README, configuración, puntos de entrada, algunos módulos representativos.
- Redacta un borrador de "qué busca el proyecto" y lista las convenciones que efectivamente se ven en el código.
- Haz como mucho 5 preguntas, las que más cambian cómo guiarla (objetivo, usuarios, qué es lo crítico, qué quiere mejorar o aprender, convenciones dudosas). Para cada una, da la respuesta más probable según lo que viste y 2-4 opciones: la persona solo confirma o corrige.
- No inventes: lo que no sepas va como pregunta. Español neutro con tuteo.

${CRITERIO}`;

/** ¿El archivo tiene contenido escrito (no solo la plantilla)? */
export function conContenido(file: string): boolean {
  if (!fs.existsSync(file)) return false;
  return fs.readFileSync(file, "utf8").replace(/<!--[\s\S]*?-->/g, "").replace(/^#.*$/gm, "").trim().length > 0;
}

export interface ResultadoConocer {
  resumen: string;
  escritos: string[];
  autoriaAplicada: Autoria[];
  autoriaSugerida: Autoria[];
  pendientes: number;
  costoUsd: number;
}

export async function conocer(
  root: string,
  o: { preguntar?: (texto: string) => Promise<string>; log?: (s: string) => void } = {},
): Promise<ResultadoConocer> {
  const log = o.log ?? (() => {});
  const z = makeZoner(root);
  const dir = dataDir(root);
  const archivos = listFiles(z);
  const res: ResultadoConocer = { resumen: "", escritos: [], autoriaAplicada: [], autoriaSugerida: [], pendientes: 0, costoUsd: 0 };

  // 1. Escaneo determinista.
  const pj = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();
  const readme = archivos.find((f) => /^readme(\.md)?$/i.test(f));
  const codigo = archivos.filter((f) => langFor(f) && !/\.(md|ya?ml|toml|json)$/i.test(f));
  const porDir = new Map<string, number>();
  for (const f of codigo) porDir.set(f.includes("/") ? f.split("/")[0]! : ".", (porDir.get(f.includes("/") ? f.split("/")[0]! : ".") ?? 0) + 1);
  const { autoria, resumen: resumenGit } = sugerirAutoria(root, archivos);
  res.autoriaSugerida = autoria;
  log(`cai: ${codigo.length} archivos de código; ${resumenGit}`);

  // 2. La IA redacta y prepara las preguntas (una consulta).
  const { data, costUsd } = await ask<{ resumen: string; proyecto: string; reglas: string[]; preguntas: { pregunta: string; sugerencia: string; opciones: string[] }[] }>({
    kind: "conocer",
    system: SISTEMA,
    cwd: root,
    schema: SCHEMA,
    ...iaOpts(z.config),
    prompt: [
      `Stack detectado: ${detectAdapters(root).map((a) => a.id).join(", ") || "(no detectado)"}.`,
      pj ? `package.json: nombre ${String(pj.name ?? "")}; descripción ${String(pj.description ?? "")}; scripts ${Object.keys((pj.scripts as object) ?? {}).join(", ")}; dependencias ${[...Object.keys((pj.dependencies as object) ?? {}), ...Object.keys((pj.devDependencies as object) ?? {})].join(", ")}` : "",
      readme ? `README:\n${fs.readFileSync(path.join(root, readme), "utf8").slice(0, 3000)}` : "(sin README)",
      `Archivos de código por carpeta: ${[...porDir].map(([d, n]) => `${d} (${n})`).join(", ")}`,
      `Algunos archivos:\n${archivos.slice(0, 150).join("\n")}`,
      autoria.length ? `Código que probablemente NO escribió el programador (según git):\n${autoria.map((a) => `- ${a.glob}: ${a.tipo}, ${a.motivo}`).join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  });
  res.costoUsd = costUsd;
  res.resumen = data.resumen;

  // 3. Preguntas: en la terminal (Enter = sugerencia), o pendientes en la memoria.
  const respuestas: [string, string][] = [];
  const pendientes: { p: string; r: string }[] = [];
  for (const q of data.preguntas) {
    if (!o.preguntar) {
      pendientes.push({ p: `${q.pregunta} (sugerencia: ${q.sugerencia})`, r: "" });
      continue;
    }
    const ops = q.opciones.filter((x) => x && x !== q.sugerencia);
    const txt = `\n${q.pregunta}\n  [Enter] ${q.sugerencia}\n${ops.map((x, i) => `  [${i + 1}] ${x}`).join("\n")}\n  (o escribe tu respuesta; "-" para saltar)\n> `;
    const r = (await o.preguntar(txt)).trim();
    if (r === "-") pendientes.push({ p: q.pregunta, r: "" });
    else respuestas.push([q.pregunta, r === "" ? q.sugerencia : /^\d$/.test(r) && ops[Number(r) - 1] ? ops[Number(r) - 1]! : r]);
  }
  // Autoría: solo se aplica lo que confirmes (en modo no interactivo, solo se sugiere).
  if (o.preguntar) {
    for (const a of autoria) {
      const r = (await o.preguntar(`\n¿${a.glob} es ${a.tipo === "heredado" ? "código que NO escribiste vos (heredado)" : "de terceros (librería/generado)"}? ${a.motivo}. [S/n] `)).trim().toLowerCase();
      if (r === "" || r.startsWith("s")) res.autoriaAplicada.push(a);
    }
  }

  // 4. Escribir: borradores sin pisar lo que ya escribiste.
  const conf = respuestas.map(([p, r]) => `- ${p} → ${r}`);
  const proyectoTxt = `# Qué busca este proyecto\n\n<!-- Borrador de \`cai conocer\`: corrígelo con tus palabras (la IA lo usa en cada guía y revisión). -->\n\n${data.proyecto.trim()}\n${conf.length ? `\n## Confirmado por ti\n\n${conf.join("\n")}\n` : ""}`;
  const reglasTxt = `# Reglas de cómo escribimos código\n\n<!-- Convenciones que se ven en el código (borrador de \`cai conocer\`): borra las que no quieras mantener y agrega las tuyas. -->\n\n${data.reglas.map((r) => `- ${r}`).join("\n")}\n`;
  for (const [nombre, texto] of [["proyecto", proyectoTxt], ["reglas", reglasTxt]] as const) {
    const destino = path.join(dir, `${nombre}.md`);
    const final = conContenido(destino) ? path.join(dir, `${nombre}.borrador.md`) : destino;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(final, texto);
    res.escritos.push(path.relative(root, final));
  }
  actualizarMemoria(root, (m) => {
    for (const [p, r] of respuestas) if (!m.respondidas.some((x) => x.startsWith(p))) m.respondidas.push(`${p} → ${r}`);
    for (const p of pendientes) if (!m.abiertas.some((x) => x.p === p.p) && m.abiertas.length < 6) m.abiertas.push(p);
  });
  res.escritos.push(path.relative(root, path.join(dir, "conocimiento.md")));
  res.pendientes = pendientes.length;

  if (res.autoriaAplicada.length) {
    const cfgFile = path.join(dir, "config.json");
    const raw = fs.existsSync(cfgFile) ? (JSON.parse(fs.readFileSync(cfgFile, "utf8")) as Record<string, unknown>) : {};
    const actual = loadConfig(root).autoria;
    const nueva = { ...actual };
    for (const a of res.autoriaAplicada) if (!nueva[a.tipo].includes(a.glob)) nueva[a.tipo] = [...nueva[a.tipo], a.glob];
    raw.autoria = nueva;
    fs.writeFileSync(cfgFile, JSON.stringify(raw, null, 2) + "\n");
    res.escritos.push(path.relative(root, cfgFile));
  }
  return res;
}
