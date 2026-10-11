import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import path from "node:path";
import { registrarUso, sdk, type AskOptions, type LLM } from "./llm.js";

/**
 * Proceso de Claude Code ABIERTO para respuestas cortas (sugerencias rápidas): el arranque se paga
 * una vez y cada pedido tarda solo lo del modelo. Se reinicia cada N usos o tras un rato sin uso
 * (para no acumular historial), y si algo falla se vuelve a la llamada normal. No tiene herramientas:
 * no puede leer ni escribir archivos.
 */

const dbg = (t: string) => process.env.CAI_DEBUG && process.stderr.write(`cai sesion: ${t}\n`);

interface Trabajo {
  id: number;
  texto: string;
  resolver: (r: { texto: string; costo: number; ms: number }) => void;
  rechazar: (e: Error) => void;
  inicio: number;
}

/** Lo mínimo que se usa de `query()` (para poder probarlo con uno falso). */
export type Fabrica = (
  prompt: AsyncIterable<SDKUserMessage>,
  modelo: string | undefined,
  abortar: AbortController,
) => AsyncIterable<{ type: string; subtype?: string; result?: string; total_cost_usd?: number; is_error?: boolean }>;

const fabricaReal: Fabrica = async function* (prompt, modelo, abortar) {
  const { query } = await sdk();
  yield* query({
    prompt,
    options: {
      ...(modelo ? { model: modelo } : {}),
      systemPrompt: "Respondes SOLO con un objeto JSON válido, exactamente con los campos que se piden. Sin texto antes ni después.",
      tools: [],
      settingSources: [],
      strictMcpConfig: true,
      persistSession: false,
      effort: "low",
      thinking: { type: "disabled" }, // respuestas de una línea: sin razonamiento largo (si no, tarda 15 s o más)
      maxTurns: 1,
      abortController: abortar,
      env: { ...process.env, ENABLE_CLAUDEAI_MCP_SERVERS: "false", CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1", CLAUDE_AGENT_SDK_CLIENT_APP: "cai/servir" },
    },
  }) as AsyncIterable<{ type: string; subtype?: string; result?: string; total_cost_usd?: number; is_error?: boolean }>;
};

/**
 * Una "generación" del proceso: su propia cola, lo enviado y el costo acumulado. Al reiniciar, la
 * generación vieja se cierra y aborta, y lo que tenía pendiente se rechaza: una respuesta tardía de
 * un proceso viejo nunca puede caerle a otro pedido.
 */
interface Generacion {
  pendientes: Trabajo[];
  enviados: Trabajo[];
  terminar: boolean;
  despertar: (() => void) | null;
  costo: number;
  abortar: AbortController;
}

export class Sesion {
  private gen: Generacion | null = null;
  private usos = 0;
  private ultimoUso = 0;
  private sig = 0;

  constructor(
    private readonly modelo: string | undefined,
    private readonly fabrica: Fabrica = fabricaReal,
    private readonly maxUsos = 20,
    private readonly maxQuietoMs = 10 * 60_000,
  ) {}

  private iniciar(): Generacion {
    dbg("iniciar proceso");
    this.cerrar();
    const g: Generacion = { pendientes: [], enviados: [], terminar: false, despertar: null, costo: 0, abortar: new AbortController() };
    this.gen = g;
    this.usos = 0;
    async function* entrada(): AsyncGenerator<SDKUserMessage> {
      while (!g.terminar) {
        while (!g.pendientes.length && !g.terminar) await new Promise<void>((r) => (g.despertar = r));
        if (g.terminar) return;
        const t = g.pendientes.shift()!;
        g.enviados.push(t);
        dbg(`enviado #${t.id} (${t.texto.length} caracteres)`);
        yield { type: "user", message: { role: "user", content: t.texto }, parent_tool_use_id: null } as SDKUserMessage;
      }
    }
    const q = this.fabrica(entrada(), this.modelo, g.abortar);
    void (async () => {
      try {
        for await (const m of q) {
          dbg(`mensaje ${m.type}${m.subtype ? `/${m.subtype}` : ""}`);
          if (m.type !== "result") continue;
          const t = g.enviados.shift();
          // total_cost_usd es acumulado en ESTE proceso: el costo del pedido es la diferencia.
          const total = m.total_cost_usd ?? g.costo;
          const costo = Math.max(0, total - g.costo);
          g.costo = total;
          if (!t) continue;
          if (m.subtype === "success" && !m.is_error) t.resolver({ texto: m.result ?? "", costo, ms: Date.now() - t.inicio });
          else t.rechazar(new Error(`el proceso abierto no pudo responder (${m.subtype})`));
        }
      } catch (e) {
        for (const t of g.enviados.splice(0)) t.rechazar(e instanceof Error ? e : new Error(String(e)));
      } finally {
        g.terminar = true;
        g.despertar?.();
        for (const t of [...g.enviados.splice(0), ...g.pendientes.splice(0)]) t.rechazar(new Error("el proceso abierto terminó"));
        if (this.gen === g) this.gen = null;
      }
    })();
    return g;
  }

  /** Un pedido. Si tarda más de `timeoutMs`, se rechaza y el proceso se reinicia (nada queda cruzado). */
  preguntar(texto: string, timeoutMs = 15_000): Promise<{ texto: string; costo: number; ms: number }> {
    let g = this.gen;
    if (!g || g.terminar || this.usos >= this.maxUsos || (this.ultimoUso && Date.now() - this.ultimoUso > this.maxQuietoMs)) g = this.iniciar();
    this.usos++;
    this.ultimoUso = Date.now();
    const gen = g;
    return new Promise((resolver, rechazar) => {
      const t: Trabajo = {
        id: ++this.sig,
        texto,
        inicio: Date.now(),
        resolver: (r) => {
          clearTimeout(timer);
          resolver(r);
        },
        rechazar: (e) => {
          clearTimeout(timer);
          rechazar(e);
        },
      };
      const timer = setTimeout(() => {
        // Se saca de la cola (si no se envió) y se descarta la generación: su respuesta tardía no le cae a nadie.
        gen.pendientes = gen.pendientes.filter((x) => x !== t);
        rechazar(new Error("el proceso abierto tardó demasiado"));
        if (this.gen === gen) this.cerrar();
      }, Math.max(500, timeoutMs));
      gen.pendientes.push(t);
      gen.despertar?.();
      gen.despertar = null;
    });
  }

  /** Arranca el proceso ya (para que el primer pedido no pague el arranque). */
  precalentar(): void {
    if (!this.gen || this.gen.terminar) this.iniciar();
  }

  cerrar(): void {
    const g = this.gen;
    if (!g) return;
    this.gen = null;
    g.terminar = true;
    g.despertar?.();
    g.despertar = null;
    g.abortar.abort();
    for (const t of [...g.enviados.splice(0), ...g.pendientes.splice(0)]) t.rechazar(new Error("el proceso abierto se reinició"));
  }
}

/** Extrae y valida el JSON de una respuesta de texto (sin IA). */
export function jsonDe<T>(texto: string, schema: { required?: string[]; properties?: Record<string, { type?: string }> }): T {
  const m = /\{[\s\S]*\}/.exec(texto);
  if (!m) throw new Error("la respuesta no trae JSON");
  const d = JSON.parse(m[0]) as Record<string, unknown>;
  for (const k of schema.required ?? []) if (!(k in d)) throw new Error(`al JSON le falta "${k}"`);
  // Cada campo con su tipo (un "texto" que no es texto haría fallar a quien lo usa).
  for (const [k, p] of Object.entries(schema.properties ?? {})) {
    if (!(k in d) || !p.type) continue;
    const tipo = Array.isArray(d[k]) ? "array" : d[k] === null ? "null" : typeof d[k];
    if (tipo !== (p.type === "integer" ? "number" : p.type)) throw new Error(`"${k}" debería ser ${p.type} y es ${tipo}`);
  }
  return d as T;
}

/** Plazo del pedido en curso (lo fija `cai servir` según cuánto espera la extensión). */
let plazoMs = 15_000;
export function fijarPlazo(ms: number): void {
  plazoMs = ms;
}

/**
 * Envuelve la IA: los pedidos de los tipos indicados van al proceso abierto (uno por modelo); si
 * fallan o tardan, se usa la llamada normal. El resto va siempre por la llamada normal.
 */
export function conSesion(base: LLM, tipos: string[], fabrica?: Fabrica, o: { respaldo?: boolean } = {}): LLM & { sesiones: Map<string, Sesion> } {
  const respaldo = o.respaldo !== false;
  const sesiones = new Map<string, Sesion>();
  const llm = (async <T>(o: AskOptions) => {
    if (!tipos.includes(o.kind)) return base<T>(o);
    const clave = o.model ?? "";
    let s = sesiones.get(clave);
    if (!s) sesiones.set(clave, (s = new Sesion(o.model, fabrica)));
    try {
      const r = await s.preguntar(`${o.system}\n\n${o.prompt}\n\nResponde SOLO un JSON con estos campos: ${JSON.stringify(o.schema)}`, plazoMs);
      const data = jsonDe<T>(r.texto, o.schema as { required?: string[] });
      registrarUso({ tipo: "llamada", kind: `${o.kind}:abierto`, proyecto: path.basename(o.cwd), costo: r.costo, ms: r.ms, ...(o.model ? { modelos: [o.model] } : {}), ...(o.ref?.archivo ? { archivo: o.ref.archivo } : {}), ...(o.ref?.funcion ? { funcion: o.ref.funcion } : {}) });
      return { data, costUsd: r.costo, ...(o.model ? { modelo: o.model } : {}) };
    } catch (e) {
      if (process.env.CAI_DEBUG) process.stderr.write(`cai servir: ${respaldo ? "respaldo" : "sin respaldo"} por ${e instanceof Error ? e.message : String(e)}\n`);
      // Un solo respaldo: si quien llama ya tiene el suyo (la extensión), aquí no se paga otra llamada.
      if (!respaldo) throw e;
      return base<T>(o);
    }
  }) as LLM & { sesiones: Map<string, Sesion> };
  llm.sesiones = sesiones;
  return llm;
}
