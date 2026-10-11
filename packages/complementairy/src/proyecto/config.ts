import fs from "node:fs";
import path from "node:path";
import picomatch from "picomatch";
import { migrarModos } from "./modos.js";
import { esModo, type Modo } from "../nucleo/compartido.js";

export interface Config {
  /** 1 = ComplementAIry v1 (migrado). */
  version?: number;
  zonas: {
    /** Donde la IA puede escribir libremente (docs, scripts, snippets...). */
    delegadas: string[];
    /** Código crítico: más fricción en la guía y más gates. */
    criticas: string[];
    /**
     * Líneas rojas (manifiesto VI.1): lógica central, rutas críticas, seguridad/autenticación/cifrado.
     * La IA no escribe ahí NUNCA (ni en una tarea aprobada). Las reglas por carpeta solo pueden sumar.
     */
    rojas: string[];
  };
  bash: {
    /** Expresiones regulares de comandos que se permiten aunque una regla los bloquee. */
    permitir: string[];
  };
  snapshot: {
    ignorar: string[];
    maxBytes: number;
  };
  /**
   * Quién puede escribir los snippets (.vscode/*.code-snippets):
   * - "ganado": la IA solo los redacta en lenguajes que el programador ya domina (perfil experto).
   * - "por-lenguaje": la IA los redacta solo en los lenguajes listados.
   * - "libre-con-aviso": la IA los redacta siempre, avisando.
   * - "humano": solo el humano.
   */
  snippets: {
    modo: "ganado" | "por-lenguaje" | "libre-con-aviso" | "humano";
    lenguajes: string[];
  };
  /**
   * Acompañante (al guardar): "silencioso" solo responde tus @ia?; "normal" además propone planos
   * y ofrece ayuda cuando una función sigue con errores tras `intentos` guardados; "activo" ayuda antes.
   */
  acompanar: {
    nivel: "silencioso" | "normal" | "activo";
    intentos: number;
    maxLlamadasHora: number;
    /** Comentar correcciones y mejoras cuando terminás una parte (función, clase...). */
    revisar: boolean;
    /** Nivel por carpeta: { "src/legacy/**": "silencioso", "src/nuevo/**": "activo" } (gana el primero que coincide). */
    porCarpeta: Record<string, "silencioso" | "normal" | "activo">;
    /** "¿Quedó lista?" automático al guardar las funciones con nota que cambiaron (modelo chico). */
    verificar: boolean;
    /** Con autoguardado: segundos sin editar antes de que el acompañante actúe (en VSCode). */
    esperaAutoguardado: number;
  };
  /** Modo de trabajo del proyecto (sugerir, aprender, programar o programar-aprender); se puede cambiar por carpeta, archivo o función. */
  modo: Modo;
  /** porFuncion: "archivo:función" → modo (se guarda aquí, no en la nota: cambiar de modo no toca notas). */
  modos: { porCarpeta: Record<string, string>; porArchivo: Record<string, string>; porFuncion: Record<string, string> };
  /** Qué ayuda dar cuando preguntas sin pedir un escalón: "auto" (según tu nivel) o uno fijo. */
  ayuda: { porDefecto: "auto" | "pista" | "piezas" | "pseudo" | "ejemplo" };
  /** Sugerencias rápidas (texto gris al final de la línea, en VSCode). */
  /** Chat del proyecto: qué IA responde por defecto en una conversación nueva (cada una puede cambiarla). */
  chat: { modelo: "chico" | "mediano" | "grande" };
  /** Ideas del panorama: además de funcionalidades y mejoras, "qué aprender" (apagado por defecto; se activa con el modo aprender). */
  ideas: { aprender: boolean };
  /** Repertorio personal (entre proyectos): guardar tus funciones 🟢 y usarlas en modo programar. */
  repertorio: { guardar: boolean; usar: "siempre" | "preguntar" | "nunca" };
  /**
   * Modo programar: predecir antes de insertar es obligatorio; `modeloPedidos` = la IA que escribe tus
   * pedidos (el ida y vuelta: "chico" por defecto, rápido); `modeloAuditoria` = la que audita al final.
   */
  programar: { prediccionObligatoria: boolean; modeloPedidos: "chico" | "mediano" | "grande"; modeloAuditoria: "chico" | "mediano" | "grande" };
  /** soloConNota: guiar solo en funciones con nota · maxHora: tope de sugerencias por hora (~US$0,002 c/u). */
  rapidas: { activas: boolean; esperaMs: number; procesoAbierto: boolean; soloConNota: boolean; maxHora: number };
  /**
   * Dónde se muestra lo que dice la IA: "notas" (hilos de VSCode al costado del código; el archivo no
   * se toca) o "comentarios" (comentarios @guia dentro del archivo, para terminal y otros editores).
   */
  vista: "notas" | "comentarios";
  /**
   * Buenas prácticas medibles (sin IA). Al superar un umbral, el acompañante te propone un plano
   * para mejorar el diseño (una vez por problema). `null` desactiva una regla.
   * Las prácticas en palabras van en .cai/reglas.md.
   */
  practicas: {
    maxFuncionesArchivo: number | null;
    maxLineasArchivo: number | null;
    maxLineasFuncion: number | null;
    maxAnidamiento: number | null;
    maxParametros: number | null;
  };
  /**
   * Quién escribió qué. "heredado": código del proyecto que no escribiste tú (la IA no te lo atribuye,
   * no cuenta en tu perfil y el acompañante no comenta salvo que lo pidas). "terceros": librerías
   * copiadas, código generado (se ignora en revisiones y panorama). El resto es "propio".
   */
  autoria: {
    heredado: string[];
    terceros: string[];
    /** Que el acompañante también comente el código heredado. */
    acompanarHeredado: boolean;
  };
  tests: {
    /** Carpeta de tests (se replica la estructura de src). "" = junto al archivo. */
    carpeta: string;
    /** Avisar (sin IA) cuando terminás una función exportada que no tiene tests. */
    avisarSinTests: boolean;
    /** Al pedir 🧪 Tests, guardar los casos como tests de verdad en la carpeta de tests (nunca toca tu código). */
    crearConIa: boolean;
    /** Volver a probar los casos al guardar (Ctrl+S; con autoguardado, cuando dejas de editar). */
    alGuardar: boolean;
  };
  ia: {
    /** Modelo para la guía y la revisión; vacío = el predeterminado de Claude Code. */
    modelo: string;
    /** Documentación actualizada de librerías vía Context7 (MCP), para que no invente APIs. */
    context7: boolean;
    /** (Compatibilidad) modelo para tareas simples; ahora se usa ia.modelos.chico. */
    modeloRapido: string;
    /**
     * Modelo por tamaño de tarea, todos vía Claude Code (tu sesión): chico = una función,
     * mediano = un archivo, grande = el proyecto. "" = el modelo por defecto de Claude Code.
     */
    modelos: { chico: string; mediano: string; grande: string };
    /** Motor y modelo por rol ("motor:modelo"): planificar, implementar, revisar, clasificar… (ver ia/roles.ts). */
    roles: Partial<Record<string, string>>;
    /** Motores extra o redefinidos: { "groq": { "tipo": "openai", "url": "…", "claveEnv": "GROQ_API_KEY" } }. */
    motores: Record<string, { tipo: "claude-code" | "opencode" | "anthropic" | "openai" | "systemone"; url?: string; claveEnv?: string; local?: boolean }>;
    /** Respaldo si el motor de un rol falla o no está disponible. */
    respaldo: string[];
    /** Decisor de lo subjetivo (System One): cadena de escalada y umbral de confianza. */
    decisor: { cadena: string[]; umbral: number };
    /** "normal" | "solo-local" (nada sale de tu máquina) | "solo-anthropic". */
    privacidad: "normal" | "solo-local" | "solo-anthropic";
    /** Motores externos (no Anthropic, no locales) habilitados explícitamente: tu código les llega. */
    optIn: string[];
    /** Tope de gasto en IA por semana (US$); 0 = sin tope. */
    presupuestoSemanaUsd?: number;
  };
  /** Umbrales del flujo de tareas (v1). */
  flujo: {
    /** Líneas máximas que la IA escribe por paso (tramos chicos se revisan mejor). */
    presupuestoLineas: number;
    /** Turnos máximos de una conversación antes de pedir traspaso (IV.6). */
    maxTurnos: number;
    /** Días sin reconstrucción semanal antes de bloquear tareas con IA (VI.3), más la gracia. */
    reconstruccionDias: number;
    graciaDias: number;
    /** Señales del detector de bucle para desconectar (V.7). */
    umbralBucle: number;
    /** Regex que deben cumplir los nombres de rama (III.3); "" = sin regla. */
    ramas: string;
  };
}

/** Siempre protegido: ni comentarios. Son las reglas del juego; la IA no puede cambiarlas. */
export const ALWAYS_PROTECTED = [
  ".cai/**",
  ".aicode/**",
  ".claude/**",
  ".githooks/**",
  ".mcp.json",
  ".git/**",
  "**/.git/**",
  "**/pnpm-lock.yaml",
  "**/package-lock.json",
  "**/yarn.lock",
  "**/bun.lockb",
  "**/poetry.lock",
  "**/uv.lock",
  "**/Cargo.lock",
  "**/go.sum",
];

export const DEFAULT_IGNORE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.next/**",
  "**/.cache/**",
  "**/__pycache__/**",
  "**/.pytest_cache/**",
  "**/.mypy_cache/**",
  "**/.ruff_cache/**",
  "**/.venv/**",
  "**/venv/**",
  "**/target/**",
  "**/.turbo/**",
  "**/*.log",
  ".cai/cache/**",
  ".aicode/cache/**",
];

export const DEFAULT_CONFIG: Config = {
  zonas: { delegadas: [], criticas: [], rojas: [] },
  bash: { permitir: [] },
  snapshot: { ignorar: [], maxBytes: 1024 * 1024 },
  snippets: { modo: "ganado", lenguajes: [] },
  acompanar: { nivel: "normal", intentos: 3, maxLlamadasHora: 20, revisar: true, porCarpeta: {}, verificar: true, esperaAutoguardado: 45 },
  modo: "sugerir",
  modos: { porCarpeta: {}, porArchivo: {}, porFuncion: {} },
  chat: { modelo: "mediano" },
  ideas: { aprender: false },
  repertorio: { guardar: true, usar: "preguntar" },
  programar: { prediccionObligatoria: true, modeloPedidos: "chico", modeloAuditoria: "mediano" },
  ayuda: { porDefecto: "auto" },
  // II.3 (interrupción del flujo): nada aparece mientras tecleas; la sugerencia rápida es solo a pedido (Ctrl+Alt+Espacio).
  rapidas: { activas: false, esperaMs: 1200, procesoAbierto: true, soloConNota: false, maxHora: 240 },
  practicas: { maxFuncionesArchivo: 12, maxLineasArchivo: 300, maxLineasFuncion: 40, maxAnidamiento: 3, maxParametros: 4 },
  autoria: { heredado: [], terceros: [], acompanarHeredado: false },
  tests: { carpeta: "tests", avisarSinTests: true, crearConIa: true, alGuardar: true },
  ia: {
    modelo: "",
    context7: false,
    modeloRapido: "",
    modelos: { chico: "claude-haiku-5-5", mediano: "claude-sonnet-5-5", grande: "claude-opus-5-5" },
    roles: {},
    motores: {},
    respaldo: [],
    decisor: { cadena: [], umbral: 0.75 },
    privacidad: "normal",
    optIn: [],
  },
  flujo: { presupuestoLineas: 150, maxTurnos: 40, reconstruccionDias: 7, graciaDias: 2, umbralBucle: 3, ramas: "" },
  vista: "notas",
};

/**
 * Carpeta de datos del proyecto: `.cai/`. Los proyectos creados antes del cambio de nombre
 * (con `.aicode/`) siguen funcionando: si solo existe la vieja, se usa esa.
 */
export function dataDir(root: string): string {
  const nueva = path.join(root, ".cai");
  const vieja = path.join(root, ".aicode");
  return !fs.existsSync(nueva) && fs.existsSync(vieja) ? vieja : nueva;
}

/**
 * II.5 (aprender vs. hacer): la intención de cada tarea activa decide la ayuda en los archivos de su alcance.
 * Tarea de "aprender" → modo aprender (escalera, sin código); ejecutor "pasos" → construir juntos. Lo que
 * configuraste a mano por función o por archivo manda sobre esto. Se lee directo (sin importar tareas).
 */
function modosDeTareas(root: string, c: Config): Config {
  const dir = path.join(dataDir(root), "tareas");
  if (!fs.existsSync(dir)) return c;
  const porCarpeta = { ...c.modos.porCarpeta };
  const porArchivo = { ...c.modos.porArchivo };
  for (const d of fs.readdirSync(dir)) {
    let t: { estado?: string; intencion?: string; ejecutor?: string; restricciones?: { alcance?: string[] } };
    try {
      t = JSON.parse(fs.readFileSync(path.join(dir, d, "tarea.json"), "utf8"));
    } catch {
      continue;
    }
    if (!t.estado || ["cerrada", "descartada", "borrador"].includes(t.estado)) continue;
    const modo = t.intencion === "aprender" ? (t.ejecutor === "pasos" ? "programar-aprender" : "aprender") : t.ejecutor === "pasos" ? "programar" : "";
    if (!modo) continue;
    for (const g of t.restricciones?.alcance ?? []) {
      if (/[*?[]/.test(g)) porCarpeta[g.replace(/\/?\*\*.*$/, "").replace(/\/\*$/, "")] ??= modo;
      else porArchivo[g] ??= modo;
    }
  }
  return { ...c, modos: { ...c.modos, porCarpeta, porArchivo } };
}

export function loadConfig(root: string): Config {
  return modosDeTareas(root, cargarConfig(root));
}

function cargarConfig(root: string): Config {
  const file = path.join(dataDir(root), "config.json");
  if (!fs.existsSync(file)) return DEFAULT_CONFIG;
  const raw = migrarModos(JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>) as Partial<Config>;
  return {
    ...(raw.version ? { version: raw.version } : {}),
    zonas: { ...DEFAULT_CONFIG.zonas, ...raw.zonas, rojas: [...(raw.zonas?.rojas ?? [])] },
    bash: { ...DEFAULT_CONFIG.bash, ...raw.bash },
    snapshot: { ...DEFAULT_CONFIG.snapshot, ...raw.snapshot },
    snippets: { ...DEFAULT_CONFIG.snippets, ...raw.snippets },
    acompanar: { ...DEFAULT_CONFIG.acompanar, ...raw.acompanar },
    modo: esModo(raw.modo) ? raw.modo : "sugerir",
    modos: { porCarpeta: { ...raw.modos?.porCarpeta }, porArchivo: { ...raw.modos?.porArchivo }, porFuncion: { ...raw.modos?.porFuncion } },
    ayuda: { ...DEFAULT_CONFIG.ayuda, ...raw.ayuda },
    chat: { ...DEFAULT_CONFIG.chat, ...raw.chat },
    ideas: { ...DEFAULT_CONFIG.ideas, ...raw.ideas },
    repertorio: { ...DEFAULT_CONFIG.repertorio, ...raw.repertorio },
    programar: { ...DEFAULT_CONFIG.programar, ...raw.programar },
    rapidas: { ...DEFAULT_CONFIG.rapidas, ...raw.rapidas },
    ia: {
      ...DEFAULT_CONFIG.ia,
      ...raw.ia,
      modelos: { ...DEFAULT_CONFIG.ia.modelos, ...raw.ia?.modelos },
      roles: { ...raw.ia?.roles },
      motores: { ...raw.ia?.motores },
      decisor: { ...DEFAULT_CONFIG.ia.decisor, ...raw.ia?.decisor },
    },
    flujo: { ...DEFAULT_CONFIG.flujo, ...raw.flujo },
    vista: raw.vista ?? (process.env.CAI_VISTA === "comentarios" || process.env.CAI_VISTA === "notas" ? process.env.CAI_VISTA : DEFAULT_CONFIG.vista),
    practicas: { ...DEFAULT_CONFIG.practicas, ...raw.practicas },
    tests: { ...DEFAULT_CONFIG.tests, ...raw.tests },
    autoria: { ...DEFAULT_CONFIG.autoria, ...raw.autoria },
  };
}

/** Rutas de las reglas por carpeta marcadas `roja: true` (.cai/reglas/*.md): las líneas rojas solo se suman. */
export function rojasDeCarpetas(root: string): string[] {
  const d = path.join(dataDir(root), "reglas");
  if (!fs.existsSync(d)) return [];
  const out: string[] = [];
  for (const f of fs.readdirSync(d).filter((x) => x.endsWith(".md"))) {
    const fm = /^---\n([\s\S]*?)\n---/.exec(fs.readFileSync(path.join(d, f), "utf8"));
    if (!fm || !/^roja:\s*true\s*$/m.test(fm[1]!)) continue;
    out.push(...[...fm[1]!.matchAll(/^\s*-\s*["']?([^"'\n]+)["']?\s*$/gm)].map((x) => x[1]!.trim()));
    const inline = /^paths:\s*\[(.*)\]\s*$/m.exec(fm[1]!);
    if (inline) out.push(...inline[1]!.split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean));
  }
  return out;
}

export type Zone = "protegida" | "snippets" | "delegada" | "humana" | "fuera";

export interface Zoner {
  root: string;
  config: Config;
  zoneOf(absFile: string): Zone;
  isCritical(absFile: string): boolean;
  /** Línea roja (VI.1): la IA nunca escribe código aquí. */
  isRoja(absFile: string): boolean;
  isIgnored(relFile: string): boolean;
  rel(absFile: string): string;
}

export function makeZoner(root: string, config: Config = loadConfig(root)): Zoner {
  const opts = { dot: true };
  const protectedM = picomatch(ALWAYS_PROTECTED, opts);
  const delegated = config.zonas.delegadas.length ? picomatch(config.zonas.delegadas, opts) : () => false;
  const critical = config.zonas.criticas.length ? picomatch(config.zonas.criticas, opts) : () => false;
  const todasRojas = [...config.zonas.rojas, ...rojasDeCarpetas(root)];
  const rojas = todasRojas.length ? picomatch(todasRojas, opts) : () => false;
  const ignored = picomatch([...DEFAULT_IGNORE, ...config.snapshot.ignorar], opts);
  const rel = (abs: string) => path.relative(root, path.resolve(root, abs)).split(path.sep).join("/");
  return {
    root,
    config,
    rel,
    zoneOf(abs) {
      const r = rel(abs);
      if (r.startsWith("..") || path.isAbsolute(r)) return "fuera";
      if (protectedM(r)) return "protegida";
      if (/^\.vscode\/[^/]+\.code-snippets$/.test(r)) return "snippets";
      if (delegated(r)) return "delegada";
      return "humana";
    },
    isCritical: (abs) => critical(rel(abs)) || rojas(rel(abs)),
    isRoja: (abs) => rojas(rel(abs)),
    isIgnored: (r) => ignored(r),
  };
}

export type Origen = "propio" | "heredado" | "terceros";

/** De quién es un archivo según `autoria` en .cai/config.json. */
export function origenDe(config: Config, rel: string): Origen {
  const m = (globs: string[]) => globs.length > 0 && picomatch(globs, { dot: true })(rel);
  if (m(config.autoria.terceros)) return "terceros";
  if (m(config.autoria.heredado)) return "heredado";
  return "propio";
}

/** Frase para los prompts cuando el código no es del programador. */
export function notaOrigen(o: Origen): string {
  if (o === "heredado") return "IMPORTANTE: este archivo es código HEREDADO (no lo escribió el programador). No le atribuyas sus problemas; explícale cómo funciona, qué riesgos tiene y qué convendría mejorar si lo toca.";
  if (o === "terceros") return "Este archivo es de terceros (librería copiada o código generado): no lo critiques; solo explica cómo usarlo.";
  return "";
}
