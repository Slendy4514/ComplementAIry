#!/bin/sh
# Instala ComplementAIry desde este repo: el comando global `cai` y la extensión de VSCode.
# Uso: sh scripts/instalar.sh        (desde la raíz del repo clonado)
set -e
DIR=$(cd "$(dirname "$0")/.." && pwd)
PM=$(command -v pnpm >/dev/null 2>&1 && echo pnpm || echo npm)

echo "→ CLI (packages/complementairy) con $PM"
cd "$DIR/packages/complementairy"
$PM install
$PM run build
npm link >/dev/null 2>&1 || npm i -g .
echo "  ✓ $(command -v cai)"

echo "→ Extensión de VSCode (packages/vscode-complementairy)"
cd "$DIR/packages/vscode-complementairy"
$PM install
$PM run build
npx --yes @vscode/vsce package --no-dependencies --allow-missing-repository -o complementairy.vsix >/dev/null
if command -v code >/dev/null 2>&1; then
  code --install-extension complementairy.vsix --force >/dev/null && echo "  ✓ instalada en VSCode"
else
  echo "  · no encontré el comando 'code': instala packages/vscode-complementairy/complementairy.vsix a mano (Extensiones → … → Install from VSIX)"
fi

echo "→ Verificación"
cai selftest | tail -1
echo "Listo. En cada proyecto: cd mi-proyecto && cai init . && cai doctor"
