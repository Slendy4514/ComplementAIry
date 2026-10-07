---
name: cai
description: Úsala en cualquier proyecto con ComplementAIry (carpeta .cai/) cuando el programador pida ayuda, revisión, tests, un plan, la arquitectura, "cómo sigo", "qué opinas del proyecto", o hable de ComplementAIry o de sus comandos. Indica qué comando `cai` correr para cada pedido.
---

# ComplementAIry desde el chat

En este proyecto el programador escribe el código y tú lo acompañas. Desde el chat puedes usar los mismos comandos que los atajos de la extensión de VSCode. Ejecútalos con Bash, **un comando `cai` por llamada y sin encadenar nada** (si encadenas, los hooks revierten lo que escriba).

| Si pide… | Corre | Qué pasa |
|---|---|---|
| ayuda con un archivo / responder sus `@ia?` | `cai guia <archivo>` | responde en el archivo con comentarios `@guia` |
| revisión ("¿está bien?", "busca bugs") | `cai revisar <archivo>` | verificaciones deterministas + revisores, como comentarios |
| tests de una función | `cai tests <archivo> <función>` | casos apagados en la carpeta de tests; él los activa con `[x]` |
| "¿cómo sigo?", "qué opinas del proyecto" | `cai panorama` | `.cai/panorama.md` (resúmelo en el chat) y preguntas en `.cai/conocimiento.md` |
| arquitectura del proyecto | `cai plano "<qué construye>"` | `docs/ESTRUCTURA.md` |
| una decisión puntual | `cai arquitectura "<tema>"` | ADR en `docs/adr/` con opciones; decide y escribe él |
| arrancar con un proyecto ya armado | `cai conocer --sin-preguntas` | borradores de proyecto.md y reglas.md + preguntas en la memoria |
| ¿pasan las verificaciones? | `cai gate <archivos>` | tipos, lint, tests, reglas |
| consumo de IA | `cai uso` | |
| qué falta instalar | `cai doctor` | |
| quién escribió qué | `cai origen` | |

**Los hace el humano (están bloqueados para ti; sugiérele el comando):** `cai init`, `cai expandir` (activar snippets), `cai snippet nuevo`, `cai perfil set`.

Además:
- Puedes responder en el chat o dejar comentarios `@guia[<id>] <tipo>: <texto>` en sus archivos (los hooks no te dejan cambiar código).
- Lee `.cai/proyecto.md`, `.cai/reglas.md` y `.cai/conocimiento.md` antes de aconsejar. Lo marcado como `heredado` en `.cai/config.json` no lo escribió él.
- Modo directo (plano, piezas, snippets sugeridos `snippet [ ]`); escalera de pistas solo en zonas críticas o si pide aprender.
- No te ancles a cómo está hecho; si hay algo mejor, propónlo con su porqué. Si te falta contexto, pregunta.
