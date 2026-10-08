import fs from "node:fs";
import path from "node:path";
import picomatch from "picomatch";

export interface Config {
  zonas: {
    /** Donde la IA puede escribir libremente (docs, scripts, snippets...). */
    delegadas: string[];
    /** Código crítico: más fricción en la guía y más gates. */
    criticas: string[];
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
  };
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
   * Quién escribió qué. "heredado": código del proyecto que no escribiste vos (la IA no te lo atribuye,
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
  };
}

/** Siempre protegido: ni comentarios. Son las reglas del juego; la IA no puede cambiarlas. */
export const ALWAYS_PROTECTED = [
  ".cai/**",
  ".aicode/**",
  ".claude/**",
  ".githooks/**",
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
  zonas: { delegadas: [], criticas: [] },
  bash: { permitir: [] },
  snapshot: { ignorar: [], maxBytes: 1024 * 1024 },
  snippets: { modo: "ganado", lenguajes: [] },
  acompanar: { nivel: "normal", intentos: 3, maxLlamadasHora: 20, revisar: true, porCarpeta: {} },
  practicas: { maxFuncionesArchivo: 12, maxLineasArchivo: 300, maxLineasFuncion: 40, maxAnidamiento: 3, maxParametros: 4 },
  autoria: { heredado: [], terceros: [], acompanarHeredado: false },
  tests: { carpeta: "tests", avisarSinTests: true },
  ia: { modelo: "", context7: false, modeloRapido: "", modelos: { chico: "claude-haiku-4-5", mediano: "claude-sonnet-5-5", grande: "claude-opus-5-5" } },
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

export function loadConfig(root: string): Config {
  const file = path.join(dataDir(root), "config.json");
  if (!fs.existsSync(file)) return DEFAULT_CONFIG;
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<Config>;
  return {
    zonas: { ...DEFAULT_CONFIG.zonas, ...raw.zonas },
    bash: { ...DEFAULT_CONFIG.bash, ...raw.bash },
    snapshot: { ...DEFAULT_CONFIG.snapshot, ...raw.snapshot },
    snippets: { ...DEFAULT_CONFIG.snippets, ...raw.snippets },
    acompanar: { ...DEFAULT_CONFIG.acompanar, ...raw.acompanar },
    ia: { ...DEFAULT_CONFIG.ia, ...raw.ia, modelos: { ...DEFAULT_CONFIG.ia.modelos, ...raw.ia?.modelos } },
    vista: raw.vista ?? (process.env.CAI_VISTA === "comentarios" || process.env.CAI_VISTA === "notas" ? process.env.CAI_VISTA : DEFAULT_CONFIG.vista),
    practicas: { ...DEFAULT_CONFIG.practicas, ...raw.practicas },
    tests: { ...DEFAULT_CONFIG.tests, ...raw.tests },
    autoria: { ...DEFAULT_CONFIG.autoria, ...raw.autoria },
  };
}

export type Zone = "protegida" | "snippets" | "delegada" | "humana" | "fuera";

export interface Zoner {
  root: string;
  config: Config;
  zoneOf(absFile: string): Zone;
  isCritical(absFile: string): boolean;
  isIgnored(relFile: string): boolean;
  rel(absFile: string): string;
}

export function makeZoner(root: string, config: Config = loadConfig(root)): Zoner {
  const opts = { dot: true };
  const protectedM = picomatch(ALWAYS_PROTECTED, opts);
  const delegated = config.zonas.delegadas.length ? picomatch(config.zonas.delegadas, opts) : () => false;
  const critical = config.zonas.criticas.length ? picomatch(config.zonas.criticas, opts) : () => false;
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
    isCritical: (abs) => critical(rel(abs)),
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
