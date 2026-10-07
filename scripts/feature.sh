#!/bin/sh
# Arma dist/complementairy/: la carpeta que se copia en el .devcontainer de cada proyecto.
# Contiene la feature (install.sh + devcontainer-feature.json) con la CLI y la extensión adentro.
set -e
RAIZ=$(cd "$(dirname "$0")/.." && pwd)
SALIDA="$RAIZ/dist/complementairy"
mkdir -p "$SALIDA"
cp "$RAIZ/devcontainer-feature/complementairy/"* "$SALIDA/"

(cd "$RAIZ/packages/complementairy" && pnpm install >/dev/null && pnpm build >/dev/null && pnpm pack --pack-destination "$SALIDA" >/dev/null)
mv "$SALIDA"/complementairy-*.tgz "$SALIDA/complementairy.tgz"
(cd "$RAIZ/packages/vscode-complementairy" && pnpm install >/dev/null && pnpm package >/dev/null)
cp "$RAIZ/packages/vscode-complementairy/complementairy.vsix" "$SALIDA/"

echo "Listo: $SALIDA"
ls -la "$SALIDA"
