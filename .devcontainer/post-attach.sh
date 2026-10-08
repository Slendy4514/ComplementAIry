#!/bin/sh
# Al conectar VSCode: instala la extensión compilada desde este repo (versión de desarrollo).
VSIX=packages/vscode-complementairy/complementairy.vsix
[ -f "$VSIX" ] || exit 0
command -v code >/dev/null 2>&1 && code --install-extension "$VSIX" --force >/dev/null 2>&1 && exit 0
for d in $(ls -dt /vscode/vscode-server/bin/*/*/ "$HOME"/.vscode-server/bin/*/ 2>/dev/null); do
  [ -x "${d}bin/code-server" ] && "${d}bin/code-server" --install-extension "$VSIX" --force >/dev/null 2>&1 && exit 0
done
exit 0
