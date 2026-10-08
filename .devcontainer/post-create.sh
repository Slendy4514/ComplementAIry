#!/bin/sh
# Se ejecuta al crear el contenedor (postCreateCommand). Cada paso es independiente:
# si uno falla, se avisa y se sigue (antes, un fallo cortaba todo y el contenedor quedaba a medias).
paso() { echo "→ $1"; shift; "$@" || echo "  ⚠ falló: $*"; }

# Los volúmenes nuevos se crean con dueño root.
paso "permisos de los volúmenes" sudo chown -R node:node /home/node/.local/share/pnpm /home/node/.claude /home/node/.cai
paso "store de pnpm" pnpm config set store-dir /home/node/.local/share/pnpm/store

# Historial de Claude Code (chats, memoria, planes): si el volumen está vacío, restaurar el respaldo del repo.
if [ ! -d /home/node/.claude/projects ] && [ -d .claude-backup ]; then
  paso "restaurar historial de Claude" cp -r .claude-backup/. /home/node/.claude/
fi

# CLI de ComplementAIry desde el código de este repo (para desarrollarla). Si la feature ya instaló `cai`
# como root, `npm link` necesita sudo para reemplazarlo por el enlace al código.
if [ -f packages/complementairy/package.json ]; then
  (cd packages/complementairy && pnpm install && pnpm build) || echo "  ⚠ falló la compilación de la CLI"
  (cd packages/complementairy && (npm link >/dev/null 2>&1 || sudo npm link >/dev/null)) && echo "  ✓ cai → $(command -v cai)" || echo "  ⚠ no se pudo enlazar cai"
fi
if [ -f packages/vscode-complementairy/package.json ]; then
  (cd packages/vscode-complementairy && pnpm install && pnpm package) || echo "  ⚠ falló el empaquetado de la extensión"
fi
if [ -f examples/demo-ts/package.json ]; then (cd examples/demo-ts && pnpm install) || echo "  ⚠ falló pnpm install del demo"; fi
exit 0
