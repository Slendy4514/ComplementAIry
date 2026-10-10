# Comparación: Plan A vs. Plan B

> Ver también: [plan-A-con-proyecto.md](plan-A-con-proyecto.md) · [plan-B-desde-cero.md](plan-B-desde-cero.md) · [comparacion.md](comparacion.md) · [plan-C-mezclado.md](plan-C-mezclado.md).


| Tema | A (vio) | B (a ciegas) | En C |
|---|---|---|---|
| Base | Reutiliza el núcleo probado (209 escenarios) | Todo nuevo | **A**: reescribir el núcleo probado es riesgo sin ganancia |
| Dónde vive la procedencia | `.cai/procedencia/` versionada + merge driver | git notes + blame | **A** (sobrevive al squash). De B, solo `git blame -C -M` para `adoptar` |
| Velocidad del hook | Proceso que ya está (~85 ms) | Daemon `caid` | **A**; el daemon solo si se mide > 100 ms |
| Flujo | Estados + guardas | Estados + `cai avanzar` | Estados de A + **`cai avanzar`** de B |
| Prompting | Guardas en el diseño | Linter en UserPromptSubmit + imagen por léxico | **Los dos**: guardas en diseño y órdenes, linter en el chat |
| Modelo por fase | Roles + una sesión por fase | Leído del transcript, cambio solo en la transición | **Los dos** |
| Revisión | Niveles 2–4, interrogatorio "decidir antes", Kernighan | Polimórfica, habituación medida, WIP 2, mutación | **Todo**: niveles de A + polimorfismo, señales y WIP de B |
| Agentes | Roles con permisos en el hook | + el tester no lee la implementación | **B** sobre A |
| Modelo mental | Mapa, recorrido, "entender antes de modificar", repaso | Tarjetas que caducan, traza real, tour | **Los dos** |
| Interfaz para la IA | CLAUDE.md ≤ 40 líneas + skills | `cai-mcp` con esquemas | **Los dos** (MCP en una fase tardía) |
| Superficie | ~14 comandos, 2 paneles | 10 comandos | ~12 comandos con `avanzar` al centro |
| Comprobación | Puerta con 2–3 personas tras F6 | Estudio de eficacia | **Los dos** |
| Lo que **ninguno** cubrió | I.6, II.1–5 (sección nueva) | ídem | **Nuevo en C** (sección 5) |

**Lo que se ve al comparar:**
1. Los dos llegaron por separado al mismo esqueleto: **tarea con estados + procedencia por línea + reglas en capas + compuertas deterministas + evidencia generativa**. Que coincidan sin haberse visto es una buena señal de que el diseño es correcto.
2. B, al no ver el código, propuso cosas que el proyecto no tiene y valen la pena: el linter de prompts, el tester ciego, las tarjetas que caducan, el MCP propio y las señales de habituación.
3. A vio lo que B no podía: tres riesgos concretos. La guía gris actual choca con el manifiesto (II.3), `construir.ts` escribe hoy en zonas críticas (VI.1), y las git notes se pierden con squash.
