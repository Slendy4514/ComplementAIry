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

# Que el usuario del contenedor pueda actualizar o enlazar `cai` sin sudo (si no, npm falla con EACCES).
USUARIO="${_REMOTE_USER:-}"
if [ -n "$USUARIO" ] && [ "$USUARIO" != "root" ] && id "$USUARIO" >/dev/null 2>&1; then
  RAIZ_NPM="$(npm root -g ${CAI_NPM_PREFIX:+--prefix "$CAI_NPM_PREFIX"})"
  BIN_NPM="$(dirname "$RAIZ_NPM")/../bin"
  [ -d "$RAIZ_NPM/complementairy" ] && chown -R "$USUARIO" "$RAIZ_NPM/complementairy"
  for b in cai complementairy aicode; do [ -L "$BIN_NPM/$b" ] && chown -h "$USUARIO" "$BIN_NPM/$b"; done
fi

mkdir -p "$DEST"

# Repertorio personal (entre proyectos): un volumen de Docker se monta aquí (ver devcontainer-feature.json).
# Un volumen nuevo copia el dueño de esta carpeta: queda escribible para el usuario del contenedor.
mkdir -p /usr/local/share/complementairy/repertorio 2>/dev/null || true
if [ -n "${USUARIO:-}" ] && [ "$USUARIO" != "root" ] && id "$USUARIO" >/dev/null 2>&1; then chown "$USUARIO" /usr/local/share/complementairy/repertorio 2>/dev/null || true; fi
if [ "$EXTENSION" = "true" ] && [ -f "$DIR/complementairy.vsix" ]; then
  cp "$DIR/complementairy.vsix" "$DEST/complementairy.vsix"
fi

cat > "$DEST/al-conectar.sh" <<'SH'
#!/bin/sh
# Se ejecuta al conectar VSCode (postAttachCommand): instala o actualiza la extensión.
# Desde los hooks, `code` no siempre puede hablar con la ventana; si falla, se usa el binario
# del servidor de VSCode (no necesita la ventana; la extensión aparece al recargar).
VSIX=/usr/local/share/complementairy/complementairy.vsix
[ -f "$VSIX" ] || exit 0
command -v code >/dev/null 2>&1 && code --install-extension "$VSIX" --force >/dev/null 2>&1 && exit 0
for d in $(ls -dt /vscode/vscode-server/bin/*/*/ "$HOME"/.vscode-server/bin/*/ "$HOME"/.vscode-server/cli/servers/*/server/ 2>/dev/null); do
  if [ -x "${d}bin/code-server" ] && "${d}bin/code-server" --install-extension "$VSIX" --force >/dev/null 2>&1; then
    echo "ComplementAIry: extensión instalada (si no la ves: Ctrl+Shift+P → Developer: Reload Window)"
    exit 0
  fi
done
echo "ComplementAIry: no pude instalar la extensión automáticamente; instálala desde $VSIX (Extensiones → … → Install from VSIX)" >&2
exit 0
SH
chmod +x "$DEST/al-conectar.sh"
echo "ComplementAIry: listo. En cada proyecto: cai init . && cai doctor"
