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
  ia: {
    /** Modelo para la guía y la revisión; vacío = el predeterminado de Claude Code. */
    modelo: string;
    /** Documentación actualizada de librerías vía Context7 (MCP), para que no invente APIs. */
    context7: boolean;
    /** Modelo para tareas simples (consolidar revisiones, decidir duplicados). Vacío = el principal. */
    modeloRapido: string;
  };
}

/** Siempre protegido: ni comentarios. Son las reglas del juego; la IA no puede cambiarlas. */
export const ALWAYS_PROTECTED = [
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
  ".aicode/cache/**",
];

export const DEFAULT_CONFIG: Config = {
  zonas: { delegadas: [], criticas: [] },
  bash: { permitir: [] },
  snapshot: { ignorar: [], maxBytes: 1024 * 1024 },
  snippets: { modo: "ganado", lenguajes: [] },
  acompanar: { nivel: "normal", intentos: 3, maxLlamadasHora: 20, revisar: true, porCarpeta: {} },
  ia: { modelo: "", context7: false, modeloRapido: "claude-haiku-4-5" },
};

export function loadConfig(root: string): Config {
  const file = path.join(root, ".aicode", "config.json");
  if (!fs.existsSync(file)) return DEFAULT_CONFIG;
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<Config>;
  return {
    zonas: { ...DEFAULT_CONFIG.zonas, ...raw.zonas },
    bash: { ...DEFAULT_CONFIG.bash, ...raw.bash },
    snapshot: { ...DEFAULT_CONFIG.snapshot, ...raw.snapshot },
    snippets: { ...DEFAULT_CONFIG.snippets, ...raw.snippets },
    acompanar: { ...DEFAULT_CONFIG.acompanar, ...raw.acompanar },
    ia: { ...DEFAULT_CONFIG.ia, ...raw.ia },
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
