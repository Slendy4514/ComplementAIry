# ComplementAIry en tus devcontainers

Esta carpeta es una *feature* de devcontainer: al reconstruir el contenedor instala el comando `cai` y la extensión de VSCode.

## Usarla en un proyecto
1. Copia esta carpeta (ya armada con `sh scripts/feature.sh`, queda en `dist/complementairy/`) dentro del `.devcontainer/` del proyecto:
   ```
   mi-proyecto/.devcontainer/complementairy/
   ```
2. En `mi-proyecto/.devcontainer/devcontainer.json` agrega:
   ```jsonc
   "features": {
     "./complementairy": {}
   }
   ```
3. VSCode → "Dev Containers: Rebuild Container".
4. Dentro del contenedor: `cai init .`

Requisitos: imagen con Node 20+ (recomendado 22) y la extensión de Claude Code (`"anthropic.claude-code"` en `customizations.vscode.extensions`), porque `cai` usa tu sesión de Claude Code.

## Actualizar
Cuando cambies ComplementAIry: vuelve a correr `sh scripts/feature.sh`, copia de nuevo la carpeta y haz Rebuild.
