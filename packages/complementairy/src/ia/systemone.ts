/**
 * Modelos System One para el decisor (estado + preguntas tipadas → valores con probabilidad, sin texto).
 * Todos hablan el formato /v1/systemone de Jev; lo que cambia es DÓNDE corren:
 *  - en Ollama 0.35+ (nimble, tev1, tev1:0.8b): se detectan solos, el motor `ollama-systemone` sin modelo
 *    usa el de mejor acierto que tengas instalado;
 *  - en un servidor local propio (laya-serve, kev.serve, von, OneJev/OpenJev en vLLM): un motor con su url,
 *    que agregas con `cai ia systemone --agregar` (solo direcciones locales);
 *  - hospedados (Jev en TypeSafe o por OpenRouter): tu texto sale de tu máquina, así que solo con tu opt-in
 *    (la configuración la pegas tú; aquí solo se muestra).
 * Las cifras de acierto son las publicadas (Ollama las midió en 13 conjuntos etiquetados, 3.880 decisiones);
 * las tuyas las mide `cai ia evaluar` en lo que el decisor juzga de verdad.
 */
import type { DefMotor } from "./motores.js";

export type Donde = "ollama" | "local" | "hospedado";

export interface ModeloSystemOne {
  id: string;
  quien: string;
  donde: Donde;
  tamano: string;
  licencia: string;
  /** Acierto medio publicado (0..1) y quién lo midió. */
  acierto?: { valor: number; fuente: string };
  /** Cómo tenerlo funcionando. */
  instalar: string;
  /** Ref para la cadena del decisor (motor:modelo), cuando ya viene definido. */
  ref?: string;
  /** Motor a agregar en ia.motores (servidores locales y hospedados). */
  motor?: DefMotor;
  notas?: string;
}

export const CATALOGO_SYSTEMONE: ModeloSystemOne[] = [
  { id: "nimble", quien: "Bespoke Labs", donde: "ollama", tamano: "9B", licencia: "ver la ficha del modelo", acierto: { valor: 0.757, fuente: "Ollama" }, instalar: "ollama pull nimble", ref: "ollama-systemone:nimble" },
  { id: "tev1", quien: "Together AI", donde: "ollama", tamano: "4B (Qwen3.5)", licencia: "pesos: por definir · código: MIT", acierto: { valor: 0.733, fuente: "Ollama" }, instalar: "ollama pull tev1", ref: "ollama-systemone:tev1", notas: "entrenado para choice; noul y score los arma Ollama puntuando candidatos" },
  { id: "tev1:0.8b", quien: "Together AI", donde: "ollama", tamano: "0.8B", licencia: "pesos: por definir · código: MIT", acierto: { valor: 0.635, fuente: "Ollama" }, instalar: "ollama pull tev1:0.8b", ref: "ollama-systemone:tev1:0.8b", notas: "el más liviano: ~800 MB" },
  { id: "laya", quien: "Convai Innovations", donde: "local", tamano: "322M–421M", licencia: "Apache-2.0", instalar: 'pip install "laya[serve]" && laya-serve', motor: { tipo: "systemone", url: "http://localhost:8000/v1/systemone", local: true }, notas: "muy bueno en clasificaciones claras, flojo en las difusas (¿es vago?): mídelo antes de confiar" },
  { id: "kev", quien: "Jared Palmer", donde: "local", tamano: "0.8B–27B (Qwen3.5)", licencia: "Apache-2.0", instalar: "pesos jaredpalmer/kev-9b (Hugging Face), servidor kev.serve", motor: { tipo: "systemone", url: "http://localhost:8000/v1/systemone", local: true } },
  { id: "von", quien: "wfzyx", donde: "local", tamano: "395M (ModernBERT-large)", licencia: "Apache-2.0", instalar: "pip install von-sdk", motor: { tipo: "systemone", url: "http://localhost:8000/v1/systemone", local: true } },
  { id: "onejev", quien: "OmniJev", donde: "local", tamano: "0.8B–27B", licencia: "Apache-2.0", instalar: "pesos OmniJev/OneJev-4B (Hugging Face) en vLLM con su servidor /v1/systemone", motor: { tipo: "systemone", url: "http://localhost:8000/v1/systemone", local: true } },
  { id: "openjev", quien: "razorback16", donde: "local", tamano: "26B-A4B", licencia: "Apache-2.0", instalar: "vLLM o MLX con su servidor compatible con Jev", motor: { tipo: "systemone", url: "http://localhost:8000/v1/systemone", local: true } },
  { id: "jev", quien: "TypeSafe AI", donde: "hospedado", tamano: "no publicado", licencia: "servicio cerrado", acierto: { valor: 0.76, fuente: "Bespoke Labs" }, instalar: "clave TYPESAFE_API_KEY", ref: "jev:jev-latest" },
  { id: "jev-openrouter", quien: "TypeSafe AI vía OpenRouter", donde: "hospedado", tamano: "no publicado", licencia: "servicio cerrado", acierto: { valor: 0.76, fuente: "Bespoke Labs" }, instalar: "clave OPENROUTER_API_KEY (sin lista de espera)", ref: "jev-openrouter:~typesafe/jev-latest", motor: { tipo: "systemone", url: "https://openrouter.ai/api/v1/systemone", claveEnv: "OPENROUTER_API_KEY" } },
];

/** ¿La url apunta a tu propia máquina? (localhost, 127.x, ::1, o el anfitrión de un contenedor). */
export function urlLocal(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const h = new URL(url).hostname.replace(/^\[|\]$/g, "");
    return h === "localhost" || h === "::1" || /^127\./.test(h) || h === "host.docker.internal" || h.endsWith(".localhost");
  } catch {
    return false;
  }
}

/** Un motor cuenta como local solo si lo dice Y su url es local (un "local: true" con url externa no engaña a la privacidad). */
export function esLocal(def: DefMotor): boolean {
  return !!def.local && (def.url === undefined || urlLocal(def.url));
}

/** Los modelos de Ollama del catálogo, del mejor acierto al peor. */
export const PREFERENCIA_OLLAMA = CATALOGO_SYSTEMONE.filter((m) => m.donde === "ollama").sort((a, b) => (b.acierto?.valor ?? 0) - (a.acierto?.valor ?? 0));

/** Base de Ollama a partir de la url del motor (…/v1/systemone → …). */
const baseOllama = (url: string) => url.replace(/\/v1\/systemone\/?$/, "");

/** Qué modelos tiene instalados un Ollama (sin ":latest"). Vacío si no responde. */
export async function modelosOllama(urlMotor: string, ms = 1500): Promise<string[]> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(`${baseOllama(urlMotor)}/api/tags`, { signal: ctl.signal });
    if (!r.ok) return [];
    const j = (await r.json()) as { models?: { name?: string; model?: string }[] };
    return (j.models ?? []).map((m) => (m.name ?? m.model ?? "").replace(/:latest$/, "")).filter(Boolean);
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

/** El mejor modelo de decisión instalado (por acierto publicado), o null. */
export function mejorInstalado(instalados: string[]): string | null {
  const set = new Set(instalados);
  return PREFERENCIA_OLLAMA.find((m) => set.has(m.id))?.id ?? null;
}

const autodetectado = new Map<string, Promise<string | null>>();
/** Para `ollama-systemone:` sin modelo: el mejor instalado (se pregunta una vez por proceso). */
export function modeloAuto(urlMotor: string): Promise<string | null> {
  if (!autodetectado.has(urlMotor)) autodetectado.set(urlMotor, modelosOllama(urlMotor).then(mejorInstalado));
  return autodetectado.get(urlMotor)!;
}
/** Para pruebas: olvida lo detectado. */
export function olvidarDeteccion(): void {
  autodetectado.clear();
}
