#!/bin/sh
# Instala AICode desde este repo: el comando global `aicode` y la extensión de VSCode.
# Uso: sh scripts/instalar.sh        (desde la raíz del repo clonado)
set -e
DIR=$(cd "$(dirname "$0")/.." && pwd)
PM=$(command -v pnpm >/dev/null 2>&1 && echo pnpm || echo npm)

echo "→ CLI (packages/aicode) con $PM"
cd "$DIR/packages/aicode"
$PM install
$PM run build
npm link >/dev/null 2>&1 || npm i -g .
echo "  ✓ $(command -v aicode)"

echo "→ Extensión de VSCode (packages/vscode-aicode)"
cd "$DIR/packages/vscode-aicode"
$PM install
$PM run build
npx --yes @vscode/vsce package --no-dependencies --allow-missing-repository -o aicode.vsix >/dev/null
if command -v code >/dev/null 2>&1; then
  code --install-extension aicode.vsix --force >/dev/null && echo "  ✓ instalada en VSCode"
else
  echo "  · no encontré el comando 'code': instala packages/vscode-aicode/aicode.vsix a mano (Extensiones → … → Install from VSIX)"
fi

echo "→ Verificación"
aicode selftest | tail -1
echo "Listo. En cada proyecto: cd mi-proyecto && aicode init . && aicode doctor"
