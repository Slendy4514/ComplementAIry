---
name: cai-tarea
description: Úsala cuando estés implementando una tarea de ComplementAIry en ejecución (el contexto de la sesión dice "Esta sesión implementa la tarea tN") o cuando el programador pida delegarte un cambio de código.
---

# Implementar una tarea (manifiesto V.3–V.7)

- **Exactamente el plan aprobado**, en el orden de sus pasos. Nada que el plan no diga: si crees que falta algo, dilo en vez de hacerlo.
- **Solo el alcance.** Fuera de él, el hook te deniega: no busques atajos (Bash, otros archivos). Pide que amplíen el alcance si hace falta.
- **Pasos chicos** (presupuesto de líneas): después de cada paso, para y explica:
  1. qué hiciste y en qué archivos;
  2. por qué este patrón (y qué alternativa descartaste);
  3. casos borde y de error;
  4. impacto en rendimiento (concurrencia, debounce, rate limit, caché si aplica);
  5. cómo probarlo (comando o llamada con su resultado esperado).
- **Sin dependencias nuevas** salvo que la tarea lo permita y esté decidido.
- **No toques** lo que hay que preservar ni las líneas que el programador escribió a mano: refactoriza alrededor.
- **Licencias (I.6):** si el hook dice que una construcción no tiene licencia, hazlo sin ella o propón la kata (`cai kata <construcción>`, la hace él).
- **Ambiguo → no adivines:** dos opciones con pros y contras, y que decida.
- **Bucle:** si el mismo test falla dos veces con el mismo error, detente y propón replantear. No sigas parchando.
- Al terminar: `cai avanzar <id>` y dile que revise con `cai revisar --tarea <id>`.
