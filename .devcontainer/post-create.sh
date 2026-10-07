#!/bin/sh
# Se ejecuta al crear el contenedor (postCreateCommand).
set -e
# Los volúmenes nuevos se crean con dueño root.
sudo chown -R node:node /home/node/.local/share/pnpm /home/node/.claude /home/node/.cai
pnpm config set store-dir /home/node/.local/share/pnpm/store
# Historial de Claude Code (chats, memoria, planes): si el volumen está vacío, restaurar el respaldo del repo.
if [ ! -d /home/node/.claude/projects ] && [ -d .claude-backup ]; then
  cp -r .claude-backup/. /home/node/.claude/
  echo "Historial de Claude restaurado desde .claude-backup/"
fi
if [ -f package.json ]; then pnpm install; fi
# CLI de ComplementAIry (comando global `cai`) y extensión de VSCode.
if [ -f packages/complementairy/package.json ]; then
  (cd packages/complementairy && pnpm install && pnpm build && npm link)
fi
if [ -f packages/vscode-complementairy/package.json ]; then
  (cd packages/vscode-complementairy && pnpm install && pnpm package)
fi
if [ -f examples/demo-ts/package.json ]; then (cd examples/demo-ts && pnpm install); fi
