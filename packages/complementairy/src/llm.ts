import fs from "node:fs";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { home } from "./profile.js";

/**
 * Única puerta hacia la IA. Cada llamada es independiente (sin historial compartido),
 * con herramientas SOLO de lectura y salida JSON validada contra un esquema.
 * La IA nunca recibe Edit, Write ni Bash: aunque quisiera, no puede tocar archivos.
 */

export interface AskOptions {
  /** Etiqueta para logs y para el modo de prueba ("guia", "revisar:bugs", ...). */
  kind: string;
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  cwd: string;
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** Habilita Context7 (documentación actualizada de librerías) como herramienta de solo lectura. */
  context7?: boolean;
  /** Todo el contexto ya va en el prompt: sin herramientas (más rápido y barato, sin exploración). */
  sinHerramientas?: boolean;
}

export interface AskResult<T> {
  data: T;
  costUsd: number;
}

export type LLM = <T>(opts: AskOptions) => Promise<AskResult<T>>;

export const READ_ONLY_TOOLS = ["Read", "Grep", "Glob"];

const realLLM: LLM = async <T>(o: AskOptions): Promise<AskResult<T>> => {
  const q = query({
    prompt: o.prompt,
    options: {
      cwd: o.cwd,
      tools: o.sinHerramientas ? [] : READ_ONLY_TOOLS,
      allowedTools: o.sinHerramientas ? [] : o.context7 ? [...READ_ONLY_TOOLS, "mcp__context7"] : READ_ONLY_TOOLS,
      ...(o.context7
        ? {
            mcpServers: {
              context7: {
                type: "http" as const,
                url: "https://mcp.context7.com/mcp",
                ...(process.env.CONTEXT7_API_KEY ? { headers: { CONTEXT7_API_KEY: process.env.CONTEXT7_API_KEY } } : {}),
              },
            },
          }
        : {}),
      disallowedTools: ["Edit", "Write", "MultiEdit", "NotebookEdit", "Bash", "WebFetch", "WebSearch", "Task"],
      settingSources: [],
      persistSession: false,
      maxTurns: o.sinHerramientas ? 4 : 16,
      systemPrompt: o.system,
      ...(o.model ? { model: o.model } : {}),
      ...(o.effort ? { effort: o.effort } : {}),
      outputFormat: { type: "json_schema", schema: o.schema },
      env: { ...process.env, ENABLE_CLAUDEAI_MCP_SERVERS: "false", CLAUDE_AGENT_SDK_CLIENT_APP: "cai/0.1" },
    },
  });
  for await (const m of q) {
    if (m.type !== "result") continue;
    if (m.subtype !== "success" || m.is_error) {
      throw new Error(`la IA no pudo responder (${m.subtype}${"result" in m && m.result ? `: ${String(m.result).slice(0, 200)}` : ""})`);
    }
    if (m.structured_output === undefined) throw new Error("la IA no devolvió JSON estructurado");
    const mu = Object.entries(m.modelUsage ?? {});
    registrarUso({
      tipo: "llamada",
      kind: o.kind,
      proyecto: path.basename(o.cwd),
      modelos: mu.map(([k]) => k),
      entrada: mu.reduce((a, [, u]) => a + u.inputTokens, 0),
      salida: mu.reduce((a, [, u]) => a + u.outputTokens, 0),
      cacheLeida: mu.reduce((a, [, u]) => a + u.cacheReadInputTokens, 0),
      cacheCreada: mu.reduce((a, [, u]) => a + u.cacheCreationInputTokens, 0),
      costo: m.total_cost_usd,
      ms: m.duration_ms,
    });
    return { data: m.structured_output as T, costUsd: m.total_cost_usd };
  }
  throw new Error("la IA terminó sin resultado");
};

let current: LLM = realLLM;

/** Para pruebas: reemplaza la IA por una función determinista. */
export function setLLM(fn: LLM | null): void {
  current = fn ?? realLLM;
}

export function ask<T>(opts: AskOptions): Promise<AskResult<T>> {
  return current<T>(opts);
}

// --- Registro de consumo (~/.cai/uso.jsonl) ------------------------------------

export interface Uso {
  tipo: "llamada" | "evitada";
  kind: string;
  proyecto?: string;
  modelos?: string[];
  entrada?: number;
  salida?: number;
  cacheLeida?: number;
  cacheCreada?: number;
  costo?: number;
  ms?: number;
  /** Para "evitada": por qué no hizo falta llamar a la IA. */
  motivo?: string;
}

export function registrarUso(u: Uso): void {
  try {
    fs.mkdirSync(home(), { recursive: true });
    fs.appendFileSync(path.join(home(), "uso.jsonl"), JSON.stringify({ fecha: new Date().toISOString(), ...u }) + "\n");
  } catch {
    /* el registro nunca debe romper el flujo */
  }
}

/** Una llamada que no se hizo porque no hacía falta (sin cambios, ya revisado...). */
export const evitada = (kind: string, motivo: string) => registrarUso({ tipo: "evitada", kind, motivo });

export function leerUso(dias = 30): (Uso & { fecha: string })[] {
  try {
    const desde = Date.now() - dias * 86400_000;
    return fs
      .readFileSync(path.join(home(), "uso.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Uso & { fecha: string })
      .filter((u) => Date.parse(u.fecha) >= desde);
  } catch {
    return [];
  }
}
