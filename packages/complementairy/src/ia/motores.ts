/**
 * Motores de IA intercambiables. Cada ROL (planificar, implementar, clasificar…) elige su motor y modelo
 * en .cai/config.json → ia.roles ("motor:modelo"). Todos devuelven JSON validado contra un esquema.
 *
 *   claude-code   tu sesión de Claude Code (Agent SDK; sin API key) — por defecto
 *   opencode      `opencode run -m proveedor/modelo` (la sesión y proveedores de OpenCode)
 *   anthropic     API de Anthropic directa (ANTHROPIC_API_KEY)
 *   openai        cualquier endpoint compatible con OpenAI: Ollama (local), DeepSeek, Gemini, OpenRouter, Groq…
 *
 * Privacidad: un motor externo que no es Anthropic ni local necesita opt-in explícito (ia.optIn), y con
 * ia.privacidad = "solo-local" solo se usan motores locales.
 */
import { execFile } from "node:child_process";
import { ask, registrarUso, type AskOptions } from "./llm.js";

export type TipoMotor = "claude-code" | "opencode" | "anthropic" | "openai" | "systemone";

export interface DefMotor {
  tipo: TipoMotor;
  /** URL base (openai: …/v1; systemone: …/v1/systemone). */
  url?: string;
  /** Variable de entorno con la clave (nunca la clave en el archivo). */
  claveEnv?: string;
  /** Corre en tu máquina (no manda código afuera). */
  local?: boolean;
}

/** Motores que vienen definidos (se pueden agregar más en ia.motores). */
export const MOTORES_BASE: Record<string, DefMotor> = {
  "claude-code": { tipo: "claude-code" },
  opencode: { tipo: "opencode" },
  anthropic: { tipo: "anthropic", url: "https://api.anthropic.com/v1", claveEnv: "ANTHROPIC_API_KEY" },
  ollama: { tipo: "openai", url: "http://localhost:11434/v1", local: true },
  "ollama-systemone": { tipo: "systemone", url: "http://localhost:11434/v1/systemone", local: true },
  jev: { tipo: "systemone", url: "https://api.typesafe.ai/v1/systemone", claveEnv: "TYPESAFE_API_KEY" },
  deepseek: { tipo: "openai", url: "https://api.deepseek.com/v1", claveEnv: "DEEPSEEK_API_KEY" },
  gemini: { tipo: "openai", url: "https://generativelanguage.googleapis.com/v1beta/openai", claveEnv: "GEMINI_API_KEY" },
  openrouter: { tipo: "openai", url: "https://openrouter.ai/api/v1", claveEnv: "OPENROUTER_API_KEY" },
};

export interface Pedido {
  kind: string;
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  cwd: string;
  modelo?: string;
  sinHerramientas?: boolean;
  effort?: AskOptions["effort"];
  ref?: AskOptions["ref"];
}

export interface Respuesta<T> {
  data: T;
  costo: number;
  modelo: string;
  motor: string;
}

/** ¿Este motor se puede usar ahora? (clave presente; los locales y claude-code siempre). */
export function disponible(def: DefMotor): boolean {
  if (def.tipo === "claude-code" || def.tipo === "opencode") return true;
  if (def.claveEnv) return !!process.env[def.claveEnv];
  return true;
}

/** Extrae el primer objeto JSON de un texto (para motores que no garantizan JSON puro). */
export function extraerJson(texto: string): unknown {
  const t = texto.trim();
  try {
    return JSON.parse(t);
  } catch {
    /* sigue */
  }
  const bloque = /```(?:json)?\s*([\s\S]*?)```/.exec(t)?.[1];
  if (bloque) {
    try {
      return JSON.parse(bloque);
    } catch {
      /* sigue */
    }
  }
  const ini = t.indexOf("{");
  for (let fin = t.lastIndexOf("}"); ini >= 0 && fin > ini; fin = t.lastIndexOf("}", fin - 1)) {
    try {
      return JSON.parse(t.slice(ini, fin + 1));
    } catch {
      /* prueba un cierre anterior */
    }
  }
  throw new Error("la respuesta no traía JSON");
}

/** Validación mínima contra el esquema (tipos y requeridos del primer nivel; enums). */
export function validarContraEsquema(dato: unknown, schema: Record<string, unknown>, ruta = "respuesta"): string[] {
  const e: string[] = [];
  const tipo = schema.type as string | undefined;
  if (tipo === "object") {
    if (typeof dato !== "object" || dato === null || Array.isArray(dato)) return [`${ruta}: debía ser un objeto`];
    const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    for (const r of (schema.required ?? []) as string[]) if (!(r in (dato as object))) e.push(`${ruta}.${r}: falta`);
    for (const [k, s] of Object.entries(props)) if (k in (dato as object)) e.push(...validarContraEsquema((dato as Record<string, unknown>)[k], s, `${ruta}.${k}`));
  } else if (tipo === "array") {
    if (!Array.isArray(dato)) return [`${ruta}: debía ser una lista`];
    const items = schema.items as Record<string, unknown> | undefined;
    if (items) dato.forEach((x, i) => e.push(...validarContraEsquema(x, items, `${ruta}[${i}]`)));
  } else if (tipo === "string") {
    if (typeof dato !== "string") e.push(`${ruta}: debía ser texto`);
    else if (Array.isArray(schema.enum) && !(schema.enum as unknown[]).includes(dato)) e.push(`${ruta}: «${dato}» no es una opción válida`);
  } else if (tipo === "number" || tipo === "integer") {
    if (typeof dato !== "number") e.push(`${ruta}: debía ser un número`);
  } else if (tipo === "boolean" && typeof dato !== "boolean") e.push(`${ruta}: debía ser verdadero/falso`);
  return e;
}

const conTiempo = async (url: string, init: RequestInit, ms = 120_000): Promise<Response> => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
};

async function viaOpenAI<T>(def: DefMotor, nombre: string, p: Pedido): Promise<Respuesta<T>> {
  const clave = def.claveEnv ? process.env[def.claveEnv] : undefined;
  const r = await conTiempo(`${def.url}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(clave ? { authorization: `Bearer ${clave}` } : {}) },
    body: JSON.stringify({
      model: p.modelo,
      messages: [
        { role: "system", content: `${p.system}\n\nResponde SOLO con un objeto JSON que cumpla este esquema:\n${JSON.stringify(p.schema)}` },
        { role: "user", content: p.prompt },
      ],
      response_format: { type: "json_schema", json_schema: { name: "respuesta", schema: p.schema } },
      temperature: 0,
    }),
  });
  if (!r.ok) throw new Error(`${nombre} respondió ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const data = extraerJson(j.choices?.[0]?.message?.content ?? "") as T;
  registrarUso({ tipo: "llamada", kind: p.kind, modelos: [`${nombre}:${p.modelo ?? ""}`], entrada: j.usage?.prompt_tokens ?? 0, salida: j.usage?.completion_tokens ?? 0, costo: 0 });
  return { data, costo: 0, modelo: p.modelo ?? "", motor: nombre };
}

async function viaAnthropic<T>(def: DefMotor, nombre: string, p: Pedido): Promise<Respuesta<T>> {
  const clave = process.env[def.claveEnv ?? "ANTHROPIC_API_KEY"];
  if (!clave) throw new Error(`falta ${def.claveEnv ?? "ANTHROPIC_API_KEY"} para usar ${nombre}`);
  const r = await conTiempo(`${def.url}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": clave, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: p.modelo || "claude-haiku-5-5",
      max_tokens: 4096,
      system: p.system,
      messages: [{ role: "user", content: p.prompt }],
      tools: [{ name: "responder", description: "Devuelve la respuesta estructurada.", input_schema: p.schema }],
      tool_choice: { type: "tool", name: "responder" },
    }),
  });
  if (!r.ok) throw new Error(`${nombre} respondió ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { content?: { type: string; input?: unknown }[]; usage?: { input_tokens?: number; output_tokens?: number }; model?: string };
  const uso = j.content?.find((c) => c.type === "tool_use");
  if (!uso) throw new Error(`${nombre} no devolvió la respuesta estructurada`);
  registrarUso({ tipo: "llamada", kind: p.kind, modelos: [j.model ?? p.modelo ?? ""], entrada: j.usage?.input_tokens ?? 0, salida: j.usage?.output_tokens ?? 0 });
  return { data: uso.input as T, costo: 0, modelo: j.model ?? p.modelo ?? "", motor: nombre };
}

/** OpenCode en modo no interactivo. Su salida es texto: se extrae el JSON. */
async function viaOpenCode<T>(nombre: string, p: Pedido): Promise<Respuesta<T>> {
  const prompt = `${p.system}\n\n${p.prompt}\n\nResponde SOLO con un objeto JSON (sin explicación) que cumpla este esquema:\n${JSON.stringify(p.schema)}`;
  const args = ["run", ...(p.modelo ? ["-m", p.modelo] : []), prompt];
  const salida = await new Promise<string>((res, rej) =>
    execFile(process.env.CAI_OPENCODE ?? "opencode", args, { cwd: p.cwd, maxBuffer: 16 * 1024 * 1024, timeout: 300_000 }, (err, stdout, stderr) =>
      err ? rej(new Error(`opencode falló: ${(stderr || err.message).slice(0, 300)}`)) : res(stdout),
    ),
  );
  registrarUso({ tipo: "llamada", kind: p.kind, modelos: [`opencode:${p.modelo ?? ""}`] });
  return { data: extraerJson(salida) as T, costo: 0, modelo: p.modelo ?? "", motor: nombre };
}

async function viaClaudeCode<T>(nombre: string, p: Pedido): Promise<Respuesta<T>> {
  const r = await ask<T>({ kind: p.kind, system: p.system, prompt: p.prompt, schema: p.schema, cwd: p.cwd, ...(p.modelo ? { model: p.modelo } : {}), sinHerramientas: p.sinHerramientas ?? true, ...(p.effort ? { effort: p.effort } : {}), ...(p.ref ? { ref: p.ref } : {}) });
  return { data: r.data, costo: r.costUsd, modelo: r.modelo ?? p.modelo ?? "", motor: nombre };
}

/** Consulta un motor y valida la respuesta contra el esquema (si no cumple, error explicativo). */
export async function consultarMotor<T>(nombre: string, def: DefMotor, p: Pedido): Promise<Respuesta<T>> {
  let r: Respuesta<T>;
  if (def.tipo === "claude-code") r = await viaClaudeCode<T>(nombre, p);
  else if (def.tipo === "opencode") r = await viaOpenCode<T>(nombre, p);
  else if (def.tipo === "anthropic") r = await viaAnthropic<T>(def, nombre, p);
  else if (def.tipo === "openai") r = await viaOpenAI<T>(def, nombre, p);
  else throw new Error(`${nombre} es un decisor (System One): úsalo con el rol "decidir", no para generar texto`);
  // claude-code ya valida con el SDK; el resto se valida aquí.
  if (def.tipo !== "claude-code") {
    const errores = validarContraEsquema(r.data, p.schema);
    if (errores.length) throw new Error(`${nombre} devolvió algo que no cumple el formato: ${errores.slice(0, 3).join("; ")}`);
  }
  return r;
}
