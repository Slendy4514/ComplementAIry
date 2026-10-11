/**
 * Reglas para comandos Bash que ejecuta la IA. Son una primera barrera, con mensajes claros;
 * la garantía final es el snapshot (snapshot.ts), que revierte cualquier cambio de código
 * hecho por shell aunque el comando haya esquivado estas reglas.
 */
interface Rule {
  re: RegExp;
  why: string;
}

const RULES: Rule[] = [
  // Dependencias: los paquetes inventados por IA (slopsquatting) son un riesgo real.
  { re: /\b(npm|pnpm|yarn|bun)\s+(add|i|install)\s+(?!-)[^\s;&|]+/, why: "instalar dependencias lo decide el humano (riesgo de paquetes inventados)" },
  { re: /\b(npx|bunx|uvx|pnpx)\s|\b(pnpm|yarn|npm)\s+(dlx|exec\s+--package)\b/, why: "ejecutar paquetes descargados al vuelo lo decide el humano" },
  { re: /\b(pip3?|uv\s+pip|pipx)\s+install\b|\b(uv|poetry|cargo)\s+add\b|\bcargo\s+install\b|\bgo\s+(get|install)\b|\bgem\s+install\b/, why: "instalar dependencias lo decide el humano" },
  { re: /\b(apt|apt-get|brew|apk|dnf|yum)\s+install\b/, why: "paquetes de sistema van en .devcontainer/Dockerfile y los agrega el humano" },
  // Saltarse controles.
  { re: /--no-verify\b/, why: "no se pueden saltar los hooks de git" },
  { re: /\bgit\s+push\b.*(\s-f\b|--force)/, why: "push forzado lo decide el humano" },
  { re: /\bgit\s+(reset\s+--hard|clean\s+-\w*f|checkout\s+--\s|restore\s+(?!--staged))/, why: "descarta trabajo del humano" },
  { re: /\bgit\s+(commit|merge|rebase|cherry-pick|am)\b/, why: "los commits los hace el humano" },
  { re: /\bgit\s+config\b/, why: "la configuración de git la cambia el humano" },
  // Comandos de ComplementAIry que son decisiones del humano.
  { re: /\b(cai|complementairy|aicode)\s+(init|expandir)\b/, why: "instalar ComplementAIry y activar snippets lo hace el humano" },
  { re: /\b(cai|complementairy|aicode)\s+(snippet\s+nuevo|perfil\s+set)\b/, why: "crear snippets y declarar el perfil lo hace el humano" },
  // Escritura de archivos por shell: se bloquea lo obvio para dar un mensaje claro.
  { re: /\b(sed|perl)\s+(-\w*\s+)*-\w*i/, why: "editar archivos por shell no está permitido; la IA solo agrega comentarios @guia" },
  { re: /\btee\b|\btruncate\b|\bdd\s/, why: "escribir archivos por shell no está permitido" },
  { re: /(^|[^<>&0-9=-])>{1,2}\s*(?!&|\/dev\/null|\/tmp\/)[^\s;&|)]+/, why: "redirigir salida a archivos no está permitido (salvo /dev/null y /tmp)" },
  { re: /\b(mv|cp|rm|ln|chmod|chown|rsync)\s/, why: "mover, copiar o borrar archivos lo hace el humano" },
  { re: /\bwriteFile|\bopen\([^)]*['"][wa]['"]/, why: "escribir archivos desde scripts no está permitido" },
];

export interface BashVerdict {
  ok: boolean;
  why?: string;
}

export function checkBash(command: string, allow: string[] = []): BashVerdict {
  if (allow.some((a) => new RegExp(a).test(command))) return { ok: true };
  // Se analiza el comando tal cual: un falso positivo cuesta poco, un falso negativo lo cubre el snapshot.
  for (const r of RULES) if (r.re.test(command)) return { ok: false, why: r.why };
  return { ok: true };
}
