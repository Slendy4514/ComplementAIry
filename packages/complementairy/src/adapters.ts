import fs from "node:fs";
import path from "node:path";

/**
 * Un adaptador por stack: qué herramientas deterministas verifican el código y cómo leer
 * su salida. Agregar un lenguaje = agregar una entrada acá (son datos, no lógica).
 * `{files}` se reemplaza por los archivos a revisar.
 */
export interface Tool {
  /** Comando; si el ejecutable no existe, la herramienta se marca "no instalada" y se sigue. */
  cmd: string;
  /** Regex con grupos nombrados file, line, msg (y opcional col, code) para cada diagnóstico. */
  parse: RegExp;
  /** Si es true, solo corre sobre archivos críticos (es lento). */
  soloCritico?: boolean;
  /** Salida estructurada en vez de regex. */
  formato?: "eslint-json";
  /** Archivos de config: si no existe ninguno, la herramienta no corre. */
  requiere?: string[];
}

export interface Adapter {
  id: string;
  /** Archivos que delatan el stack. */
  detect: string[];
  /** Extensiones que revisa. */
  exts: string[];
  tools: Record<string, Tool>;
  /** Para ejecutar una expresión del código del usuario (cai check). */
  runner?: string;
  /** Comando de instalación sugerido (lo corre el humano o `cai doctor --instalar`). */
  install: string;
  /** Paquetes de sistema necesarios (van en .devcontainer/Dockerfile). */
  sistema?: string[];
  /** Plugin LSP de Claude Code recomendado. */
  lsp?: string;
}

export const ADAPTERS: Adapter[] = [
  {
    id: "typescript",
    detect: ["tsconfig.json", "package.json"],
    exts: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
    tools: {
      tipos: { cmd: "npx --no-install tsc --noEmit --pretty false", parse: /^(?<file>[^\s(][^(]*)\((?<line>\d+),(?<col>\d+)\): error (?<code>TS\d+): (?<msg>.+)$/gm, requiere: ["tsconfig.json"] },
      lint: { cmd: "npx --no-install eslint --format json {files}", parse: /$^/gm, formato: "eslint-json" },
      tests: { cmd: "npx --no-install vitest related --run --reporter=dot {files}", parse: /^\s*(?:FAIL|×|✗)\s+(?<file>\S+\.[cm]?[jt]sx?)(?::(?<line>\d+))?\s*(?<msg>.*)$/gm },
      arquitectura: { cmd: "npx --no-install depcruise {files} --output-type err-long", parse: /^\s*(?:error|warn)\s+(?<msg>[^:]+:\s*(?<file>\S+)\s*→.*)$/gm, requiere: [".dependency-cruiser.cjs", ".dependency-cruiser.js", ".dependency-cruiser.json"] },
      mutacion: {
        cmd: "npx --no-install stryker run --mutate {files} --reporters json,clear-text",
        parse: /$^/gm,
        soloCritico: true,
        requiere: ["stryker.config.json", "stryker.config.mjs", "stryker.config.js", "stryker.conf.json", "stryker.conf.js"],
      },
    },
    runner: "npx --no-install tsx",
    install: "pnpm add -D typescript@^6 vitest eslint typescript-eslint @eslint/js tsx @stryker-mutator/core @stryker-mutator/vitest-runner dependency-cruiser",
    lsp: "typescript-lsp (requiere: npm i -g typescript-language-server typescript)",
  },
  {
    id: "python",
    detect: ["pyproject.toml", "requirements.txt", "setup.py"],
    exts: [".py"],
    tools: {
      tipos: { cmd: "mypy --strict --no-error-summary --show-column-numbers {files}", parse: /^(?<file>[^:\n]+):(?<line>\d+):(?:(?<col>\d+):)? error: (?<msg>.+)$/gm },
      lint: { cmd: "ruff check --output-format concise {files}", parse: /^(?<file>[^:\n]+):(?<line>\d+):(?<col>\d+): (?<code>[A-Z]+\d+) (?<msg>.+)$/gm },
      tests: { cmd: "pytest -q", parse: /^FAILED (?<file>[^:\s]+)::(?<msg>.+)$/gm },
      arquitectura: { cmd: "lint-imports", parse: /^(?<msg>.*(?<file>\S+\.py).*broken.*)$/gm, requiere: [".importlinter"] },
      mutacion: { cmd: "mutmut run --paths-to-mutate {files}", parse: /$^/gm, soloCritico: true },
    },
    runner: "python3",
    install: "pip install mypy ruff pytest hypothesis mutmut import-linter   # o: uv add --dev ...",
    sistema: ["python3", "python3-pip", "python3-venv"],
    lsp: "pyright-lsp (requiere: npm i -g pyright)",
  },
];

export function detectAdapters(root: string): Adapter[] {
  const found = ADAPTERS.filter((a) => a.detect.some((f) => fs.existsSync(path.join(root, f))));
  return found;
}

export function adapterFor(root: string, file: string): Adapter | undefined {
  const ext = path.extname(file).toLowerCase();
  return detectAdapters(root).find((a) => a.exts.includes(ext)) ?? ADAPTERS.find((a) => a.exts.includes(ext));
}
