---
name: cai
description: Úsala en cualquier proyecto con ComplementAIry (carpeta .cai/) cuando el programador pida ayuda, revisión, tests, un plan, la arquitectura, "cómo sigo", "qué opinas del proyecto", o hable de ComplementAIry o de sus comandos. Indica qué comando `cai` correr para cada pedido.
---

# ComplementAIry desde el chat

En este proyecto el programador escribe el código y tú lo acompañas. Desde el chat puedes usar los mismos comandos que los atajos de la extensión de VSCode. Ejecútalos con Bash, **un comando `cai` por llamada y sin encadenar nada** (si encadenas, los hooks revierten lo que escriba).

| Si pide… | Corre | Qué pasa |
|---|---|---|
| "¿qué hago ahora?", "¿por dónde sigo?" | `cai siguiente` | una sola cosa, elegida sin IA (respuestas pendientes, errores, tareas, notas) |
| ayuda sobre una línea o función | `cai responder <archivo> --linea N --texto "<pregunta>"` (o `--pedido pista\|piezas\|pseudo\|ejemplo\|tests\|explica`) | nota en esa línea (en modo notas el archivo no se toca) |
| seguir una nota | `cai responder <archivo> --nota <id> --texto "..."` | responde en el mismo hilo |
| "¿ya quedó?", "¿está lista esta función?" | `cai verificar <archivo> --funcion <nombre>` | 🟢 lista (cierra la nota) / 🟡 casi / 🔴 falta, con mejoras |
| ver notas / tareas | `cai notas [<archivo>]`, `cai tareas` | |
| responder sus `@ia?` escritos en el archivo | `cai guia <archivo>` | en notas (por defecto) o en comentarios `@guia`, según `vista` |
| plano de un archivo | `cai plano --archivo <archivo>` | resumen + nota por función + tareas por crear |
| sobre el archivo entero ("¿cómo organizo este archivo?") | `cai responder <archivo> --archivo-entero --texto "..."` | nota arriba del archivo |
| "¿cómo va el proyecto?", "¿qué falta?", preguntas generales | `cai chat --texto "…"` (o `cai indice`, `cai deuda`, `cai hoy`) | responde con estructura, índice, decisiones; deja decisiones y tareas con botones |
| entender el proyecto / sus objetivos | `cai entender --texto "…"` (estado: `cai entender estado`) | borrador de objetivos y criterios de terminado; **confirmar es suyo** (pregúntale con header `cai:obj`) |
| el objetivo de una función o archivo | `cai entender --funcion <archivo>:<f> --texto "…"` (o `--archivo <archivo>`) | objetivo + criterios en su nota; confirmar/terminar es suyo |
| "voy a implementar X", "ya terminé Y" | `cai tareas agregar "…"`, `cai tareas editar <id> --titulo "…"`, `cai tareas hecha\|reabrir <id>` | descartar una tarea es suyo (header `cai:-t<n>`) |
| "eso no es así" (corrige lo que entiendes del proyecto) | `cai memoria proponer --modulo <archivo> \| --estructura <archivo> \| --proyecto --texto "…"` | luego pregúntale con header `cai:<id>` y el texto exacto; si responde "Aplicar", queda |
| ideas para el proyecto | `cai ideas`, `cai ideas mas`, `cai ideas tarea <id>` | descartar una idea es suyo |
| una decisión que depende de él | `cai decisiones proponer "<pregunta>" --opcion "a" --opcion "b"` | y pregúntale con AskUserQuestion, header `cai:<id>`: su respuesta queda registrada |
| modo programar (si está activo) | `cai programar plan\|paso\|pr <archivo> --funcion <f> …` | propuestas; el código entra SOLO con su clic en VSCode; sus casos y el probador son suyos |
| "¿está listo el archivo?" | `cai revisar <archivo> --completo` | revisión + "¿quedó lista?" de cada función + tests + veredicto 🟢/🟡/🔴 |
| tests de una función | `cai tests <archivo> <función> --probar` | propone y EJECUTA casos (también sin export); guardarlos lo decide él |
| decisiones tomadas | `cai decisiones` | respétalas; decidir/retractar es suyo |
| preguntas que ComplementAIry le hizo | `cai memoria` | muéstraselas; **las responde él** (`cai memoria responder` es suyo, no lo corras tú) |
| revisión ("¿está bien?", "busca bugs") | `cai revisar <archivo>` | verificaciones deterministas + revisores, como notas o comentarios |
| tests de una función | `cai tests <archivo> <función>` | casos apagados en la carpeta de tests; él los activa con `[x]` |
| "¿cómo sigo?", "qué opinas del proyecto" | `cai panorama` | `.cai/panorama.md` (resúmelo en el chat) y preguntas en `.cai/conocimiento.md` |
| arquitectura / estructura del proyecto | `cai plano "<qué construye>"` | `docs/ESTRUCTURA.md` + archivos por crear como tareas + preguntas |
| una decisión puntual | `cai arquitectura "<tema>"` | ADR en `docs/adr/` con opciones; decide y escribe él |
| arrancar con un proyecto ya armado | `cai conocer --sin-preguntas` | borradores de proyecto.md y reglas.md + preguntas en la memoria |
| ¿pasan las verificaciones? | `cai gate <archivos>` | tipos, lint, tests, reglas |
| consumo de IA | `cai uso` | |
| qué falta instalar | `cai doctor` | |
| quién escribió qué | `cai origen` | |

**Los hace el humano (están bloqueados para ti; sugiérele el comando):** `cai memoria responder`, `cai init`, `cai expandir` (activar snippets), `cai snippet nuevo`, `cai perfil set`.

**Lo que solo decide él, desde este chat:** pregúntaselo con AskUserQuestion. En el `header` va `cai:<id>` (`cai:d1a2b3` decidir, `cai:-d1a2b3` retractar, `cai:-t12` descartar tarea, `cai:-i1a2b3` descartar idea, `cai:obj` confirmar objetivos, `cai:fin` dar el proyecto por terminado, `cai:p1a2b3` aplicar una corrección propuesta). Opciones EXACTAS: las de la decisión (para `cai:<id>`), "Retractar"/"Mantener" (`cai:-d…`), "Descartar"/"Mantener" (`cai:-t…`, `cai:-i…`), "Confirmar"/"Reabrir" (`cai:obj`), "Dar por terminado"/"Seguir" (`cai:fin`), "Aplicar"/"No" (`cai:p…`); una sola opción (sin multiSelect). La pregunta tiene que incluir el texto completo de lo que se registra. Nunca pongas respuestas tú: un hook registra la suya.

Además:
- Si un comando sale con código 3, la IA ya está trabajando en ese archivo (lo pidió el editor): espera y vuelve a intentarlo, no lo fuerces.
- **Vista notas** (`"vista"` en `.cai/config.json`, por defecto): no escribas comentarios `@guia` en sus archivos (el hook lo bloquea); usa los comandos de arriba y resume en el chat.
- Puedes responder en el chat o (vista comentarios) dejar comentarios `@guia[<id>] <tipo>: <texto>` en sus archivos (los hooks no te dejan cambiar código).
- Lee `.cai/proyecto.md`, `.cai/reglas.md` y `.cai/conocimiento.md` antes de aconsejar. Lo marcado como `heredado` en `.cai/config.json` no lo escribió él.
- Modo directo (plano, piezas, snippets sugeridos `snippet [ ]`); escalera de pistas solo en zonas críticas o si pide aprender.
- No te ancles a cómo está hecho; si hay algo mejor, propónlo con su porqué. Si te falta contexto, pregunta.
