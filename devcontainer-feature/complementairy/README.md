# ComplementAIry en tus devcontainers

Feature de devcontainer: al construir el contenedor instala el comando `cai` y la extensión de VSCode.

## Desde GitHub (recomendado)
Al crear un tag en el repo (`git tag v0.3.0 && git push --tags`), el workflow `release` publica la feature en
`ghcr.io/<tu-usuario>/complementairy/complementairy`.

**En un proyecto**, en `.devcontainer/devcontainer.json`:
```jsonc
"features": {
  "ghcr.io/<tu-usuario>/complementairy/complementairy:0": {}
},
"customizations": { "vscode": { "extensions": ["anthropic.claude-code"] } }
```

**En TODOS tus devcontainers a la vez**, sin tocar cada proyecto: en la configuración de VSCode de tu computador
(`Ctrl+Shift+P` → "Preferences: Open User Settings (JSON)"):
```jsonc
"dev.containers.defaultFeatures": {
  "ghcr.io/<tu-usuario>/complementairy/complementairy:0": {}
},
"dev.containers.defaultExtensions": ["anthropic.claude-code"]
```

**Actualizaciones:** la extensión revisa tu último release y, si hay una versión nueva, te avisa con
"Reconstruir ahora". El tag `:0` siempre apunta a la última 0.x, así que reconstruir basta.
Manual: `Ctrl+Shift+P` → "ComplementAIry: buscar actualizaciones".

> El repo y el paquete de ghcr.io tienen que ser **públicos** (GitHub → tu perfil → Packages → complementairy →
> Package settings → Change visibility). Si son privados, el contenedor no puede descargar la feature sin
> `docker login ghcr.io`, y el aviso de actualización no puede consultar los releases.

## Sin GitHub (copiando la carpeta)
`sh scripts/feature.sh` arma `dist/complementairy/`. Cópiala en `mi-proyecto/.devcontainer/` y usa
`"features": { "./complementairy": {} }`. Para actualizar, repite y haz Rebuild.

Requisitos: imagen con Node 20+ (recomendado 22) y la extensión de Claude Code (`cai` usa tu sesión de Claude Code).
