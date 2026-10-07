#!/bin/sh
# Feature de ComplementAIry: instala la CLI (`cai`) y deja lista la extensión de VSCode.
# Los paquetes (complementairy.tgz y complementairy.vsix) viajan dentro de la feature.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
DEST="${CAI_FEATURE_DEST:-/usr/local/share/complementairy}"
EXTENSION="${EXTENSION:-true}"

if ! command -v npm >/dev/null 2>&1; then
  echo "ComplementAIry necesita Node.js 22+ en el contenedor." >&2
  echo "Usa una imagen con Node (p. ej. mcr.microsoft.com/devcontainers/javascript-node:22) o agrega la feature ghcr.io/devcontainers/features/node:1." >&2
  exit 1
fi
MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$MAJOR" -ge 20 ] || echo "Aviso: Node $MAJOR detectado; se recomienda 22+ (mutation testing con Stryker lo requiere)." >&2

echo "ComplementAIry: instalando la CLI…"
npm install -g --no-audit --no-fund ${CAI_NPM_PREFIX:+--prefix "$CAI_NPM_PREFIX"} "$DIR/complementairy.tgz"

mkdir -p "$DEST"
if [ "$EXTENSION" = "true" ] && [ -f "$DIR/complementairy.vsix" ]; then
  cp "$DIR/complementairy.vsix" "$DEST/complementairy.vsix"
fi

cat > "$DEST/al-conectar.sh" <<'SH'
#!/bin/sh
# Se ejecuta al conectar VSCode (postAttachCommand): instala o actualiza la extensión.
VSIX=/usr/local/share/complementairy/complementairy.vsix
[ -f "$VSIX" ] || exit 0
command -v code >/dev/null 2>&1 || exit 0
code --install-extension "$VSIX" --force >/dev/null 2>&1 || true
SH
chmod +x "$DEST/al-conectar.sh"
echo "ComplementAIry: listo. En cada proyecto: cai init . && cai doctor"
