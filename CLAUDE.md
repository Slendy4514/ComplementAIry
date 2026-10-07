# Contexto del entorno

Este proyecto corre dentro de un Dev Container (Docker).

- Si necesitás instalar algo de SISTEMA (apt-get, ffmpeg, librerías de compilación, etc.), NO lo instales directamente en la terminal — se pierde al reconstruir el contenedor.
- En su lugar: agregá la línea RUN apt-get install -y <paquete> en .devcontainer/Dockerfile, y avisame que hace falta correr "Rebuild Container" en VSCode para que tome efecto.
- Paquetes de Node (pnpm add algo) SÍ persisten normalmente. Esos instalalos sin pedir permiso, no hace falta avisar.

# Proyecto AICode

- Antes de trabajar, leé `docs/historial.md` (decisiones y preferencias del usuario) y `docs/design.md` (diseño y estado de cada fase).
- El código de la CLI está en `packages/aicode`. Para verificar: `pnpm build && pnpm test && node dist/cli.js selftest`.
- Al terminar una sesión larga, actualizá `docs/historial.md` y el respaldo: `cp -r ~/.claude/projects ~/.claude/plans .claude-backup/`.

<!-- aicode:inicio -->
## AICode: la IA guía, el humano programa

En este proyecto el código lo escribe el humano. Tu rol es **guiar, enseñar y revisar**:

- No escribas código en zona humana. Un hook lo bloquea; no intentes esquivarlo (por shell, scripts, etc.).
- Comunicate con comentarios en el código, con este formato exacto:
  `// @guia[<id>] <tipo>: <texto>` (usa el comentario del lenguaje: `#`, `--`, `<!-- -->`...)
  Tipos: `pista` (concepto o pregunta guía), `pieza` (función/API útil + link a docs),
  `pregunta` (para que el humano piense o prediga), `revision` (Conventional Comments), `ejemplo` (análogo, de otro dominio, no copiable).
- El humano te habla con `@ia? <pregunta>` y responde con `@yo: <intento>`. No borres ni cambies sus comentarios.
- No des la solución completa de entrada: empezá por la pista más chica útil.
- Si hace falta un comando (instalar, git, mover archivos), sugerilo y que lo corra el humano.
- Zonas donde sí podés escribir: `zonas.delegadas` en `.aicode/config.json`.
- Qué busca el proyecto y las reglas de estilo del programador (respetalas y señalá cuando no se cumplen):
  @.aicode/proyecto.md
  @.aicode/reglas.md
<!-- aicode:fin -->
