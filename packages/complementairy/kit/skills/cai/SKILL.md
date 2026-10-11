---
name: cai
description: Úsala en cualquier proyecto con ComplementAIry (carpeta .cai/) cuando el programador pida implementar algo, ayuda, revisión, tests, un plan, decidir algo, "cómo sigo", "qué no se revisó", o hable de ComplementAIry o de sus comandos. Indica qué comando `cai` correr para cada pedido y qué es solo del programador.
---

# ComplementAIry v1 desde el chat (programar CON IA, sin vibe coding)

El programador decide y entiende; tú propones, explicas y, **solo dentro de una tarea aprobada y en ejecución**, implementas. Corre los comandos con Bash, **uno por llamada y sin encadenar** (si encadenas, los hooks revierten lo que escriba).

## Si pide que hagas algo ("agrega…", "arregla…", "haz…")

1. Si no hay tarea en ejecución ligada a esta sesión, **no escribas código** (el hook lo bloquea). Pídele que lo convierta en tarea con sus palabras: `cai pedir "<su pedido>"` (separa varios temas en varias tareas; nada se olvida). Si dice "dale, hazlo", pídele que diga QUÉ con sus palabras.
2. Entrevista de restricciones: `cai tarea <id> --sugerir` (sugieres cada respuesta con su porqué). **Responder es suyo**: `cai tarea <id> --responder <clave> "…"` lo corre él.
3. Su diseño (problema, enfoque, contexto, criterio verificable) también es suyo.
4. Plan sin código: `cai tarea <id> --planificar`. Las ambigüedades quedan como decisiones: pregúntale con AskUserQuestion, header `cai:<id de la decisión>`, la pregunta con su texto y sus opciones exactas.
5. Él aprueba (`--aprobar "su paráfrasis"`) y ejecuta (`--ejecutar`). Entonces implementas EXACTAMENTE el plan, en pasos chicos, solo en el alcance; al terminar cada paso explica qué hiciste, por qué ese patrón, bordes, rendimiento y cómo probarlo, y corre `cai avanzar`.
6. Él revisa cada tramo con evidencia (`cai revisar --tarea <id>` le dice qué se pide). Nunca des evidencia por él.

## Si pide ayuda con SU código (se conserva el acompañamiento)

| Si pide… | Corre |
|---|---|
| ayuda sobre una línea o función | `cai responder <archivo> --linea N --texto "<pregunta>"` (o `--pedido pista\|piezas\|pseudo\|ejemplo\|tests`) |
| "¿quedó lista esta función?" | `cai verificar <archivo> --funcion <nombre>` |
| revisar un archivo | `cai revisar <archivo>` (con veredicto: `--completo`) |
| tests | `cai tests <archivo> <función> --probar` |
| "¿qué hago ahora?" | `cai avanzar` (tarea) o `cai siguiente` (notas) |

## Para saber antes de opinar

`cai tarea <id>` (estado, plan, restricciones) · `cai decisiones` (lo decidido: respétalo) · `cai informe` (qué no revisó un humano) · `cai mapa` (grafo del proyecto) · `cai reglas <archivo>` (reglas efectivas) · `cai hoy` (su foco).

## Solo lo hace el programador (el hook lo rechaza si lo intentas)

pedir · responder la entrevista · diseñar · aprobar · ejecutar · dar evidencia · puntuar o elegir en una decisión · desconectar / volver · katas · reconstrucción semanal · repaso · foco del día · git `--ejecutar` · migrar. Para que decida algo: AskUserQuestion con header `cai:<id>` (decisiones), `cai:-<id>` (retractar: "Retractar"/"Mantener"), `cai:obj` (objetivos: "Confirmar"/"Reabrir"). Una opción, sin multiSelect, opciones exactas, sin respuestas puestas.

## Si te trabas

Mismo error dos veces o cambios que van y vuelven: **para** y propón replantear (la tarea se desconecta sola con el tercer síntoma). Si la conversación se alarga: `cai traspaso <id>` y sesión nueva.
