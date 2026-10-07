import path from "node:path";

/**
 * Cómo se escribe un comentario en cada lenguaje.
 * `grammar` es el nombre del .wasm de tree-sitter-wasms; null = lenguaje sin gramática
 * (se usa un analizador simple de línea, ver comments.ts).
 */
export interface LangSpec {
  id: string;
  grammar: string | null;
  /** Marcador de comentario de línea usado al insertar comentarios. */
  line: string | null;
  /** Comentario de bloque, para lenguajes sin comentario de línea (CSS, HTML). */
  block: [string, string] | null;
}

const C_LIKE = { line: "//", block: ["/*", "*/"] as [string, string] };
const HASH = { line: "#", block: null };

const BY_EXT: Record<string, LangSpec> = {};
function reg(exts: string[], spec: LangSpec): void {
  for (const e of exts) BY_EXT[e] = spec;
}

reg([".ts", ".mts", ".cts"], { id: "typescript", grammar: "typescript", ...C_LIKE });
reg([".tsx"], { id: "tsx", grammar: "tsx", ...C_LIKE });
reg([".js", ".mjs", ".cjs", ".jsx"], { id: "javascript", grammar: "javascript", ...C_LIKE });
reg([".py", ".pyi"], { id: "python", grammar: "python", ...HASH });
reg([".sh", ".bash", ".zsh"], { id: "bash", grammar: "bash", ...HASH });
reg([".yml", ".yaml"], { id: "yaml", grammar: "yaml", ...HASH });
reg([".toml"], { id: "toml", grammar: "toml", ...HASH });
reg([".rb"], { id: "ruby", grammar: "ruby", ...HASH });
reg([".go"], { id: "go", grammar: "go", ...C_LIKE });
reg([".rs"], { id: "rust", grammar: "rust", ...C_LIKE });
reg([".java"], { id: "java", grammar: "java", ...C_LIKE });
reg([".kt", ".kts"], { id: "kotlin", grammar: "kotlin", ...C_LIKE });
reg([".c", ".h"], { id: "c", grammar: "c", ...C_LIKE });
reg([".cpp", ".cc", ".hpp", ".hh"], { id: "cpp", grammar: "cpp", ...C_LIKE });
reg([".cs"], { id: "csharp", grammar: "c_sharp", ...C_LIKE });
reg([".php"], { id: "php", grammar: "php", ...C_LIKE });
reg([".swift"], { id: "swift", grammar: "swift", ...C_LIKE });
reg([".scala"], { id: "scala", grammar: "scala", ...C_LIKE });
reg([".dart"], { id: "dart", grammar: "dart", ...C_LIKE });
reg([".lua"], { id: "lua", grammar: "lua", line: "--", block: null });
reg([".css"], { id: "css", grammar: "css", line: null, block: ["/*", "*/"] });
reg([".html", ".htm"], { id: "html", grammar: "html", line: null, block: ["<!--", "-->"] });
reg([".vue"], { id: "vue", grammar: "vue", line: null, block: ["<!--", "-->"] });

// Sin gramática en tree-sitter-wasms: analizador de línea propio (comments.ts).
const DOCKERFILE: LangSpec = { id: "dockerfile", grammar: null, line: "#", block: null };
const SQL: LangSpec = { id: "sql", grammar: null, line: "--", block: null };
reg([".sql"], SQL);
reg([".dockerfile"], DOCKERFILE);
reg([".md", ".markdown"], { id: "markdown", grammar: null, line: null, block: ["<!--", "-->"] });

export function langFor(file: string): LangSpec | null {
  const base = path.basename(file);
  if (/^(Dockerfile|Containerfile)(\..*)?$/.test(base)) return DOCKERFILE;
  return BY_EXT[path.extname(base).toLowerCase()] ?? null;
}
