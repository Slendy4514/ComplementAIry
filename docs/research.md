# Investigación: programar con IA sin dejar de pensar

Fecha: octubre 2026. Este documento resume la investigación que sustenta el diseño de AICode ([design.md](design.md)). Tiene dos partes:

1. **Lado IA:** qué herramientas hacen que una IA de programación (Claude Code) trabaje mejor y de forma más confiable.
2. **Lado humano:** qué dice la evidencia sobre aprender y mantener la habilidad cuando se programa con IA.

En cada punto se marca si la evidencia es **sólida**, **moderada** o **débil**.

---

## Conclusiones en una página

1. **Una instrucción a la IA no es una garantía.** Lo que no debe pasar nunca se hace cumplir con hooks deterministas, no con texto en CLAUDE.md. *(Documentación oficial de Anthropic; usuarios de Cursor y Claude reportan "modos aprendizaje" que igual editan código.)*
2. **Delegar la escritura del código reduce la comprensión.** En el ensayo de Anthropic de 2026, el grupo con IA sacó 50% de comprensión contra 67% sin IA, y no fue significativamente más rápido. *(Sólida: tres ensayos aleatorizados coinciden.)*
3. **No importa tanto si se usa IA, sino cómo.** Quienes hacían preguntas conceptuales, o pedían explicación junto al código, aprendieron. Quienes delegaban, no. *(Sólida.)*
4. **La guía tiene que adaptarse a quién la recibe.** La ayuda que sirve a un novato estorba a un experto (efecto de reversión de la pericia). *(Sólida, en ciencias del aprendizaje en general.)*
5. **Las pistas sin fricción se abusan.** La gente salta directo a la respuesta. *(Sólida en tutores inteligentes.)*
6. **La autoevaluación es poco confiable.** En un estudio, desarrolladores con IA fueron 19% más lentos y creían ser 20% más rápidos. *(Moderada.)*
7. **La verificación mecánica es lo único que escala.** Tipos, tests, mutation testing y reglas de arquitectura. Revisar pasivamente no escala, porque se puede no revisar. *(Consenso de práctica: "harness engineering", Böckeler 2026.)*

---

## Parte 1 — Lado IA: herramientas y prácticas

### 1.1 CLAUDE.md, reglas y memoria
- **CLAUDE.md corto (menos de ~200 líneas).** Los archivos largos se obedecen peor. Contenido recomendado: comandos de build/test/lint, estructura y convenciones. Los procedimientos largos van en *skills*, que se cargan solo al usarse. Las reglas de una sola parte del código van en `.claude/rules/*.md` con `paths:`. Fuente: https://code.claude.com/docs/en/memory
- **Instrucciones contradictorias.** Si dos instrucciones se contradicen, la IA elige cualquiera de las dos. `/doctor prompt-audit` las detecta.
- **Memoria.** Lo más confiable son las decisiones escritas en el repo: ADRs (*Architecture Decision Records*, plantilla Contexto/Decisión/Consecuencias), versionadas y revisables. La auto-memory de Claude sirve para preferencias personales. Los MCP de memoria tipo grafo de conocimiento aportan poco frente a esto (evaluación: valor bajo a medio).

### 1.2 Hooks: lo que más aumenta la confiabilidad
Fuente: https://code.claude.com/docs/en/hooks

- **Eventos:** `PreToolUse` (antes de usar una herramienta, puede bloquearla), `PostToolUse` (después), `Stop` (antes de que la IA diga "terminé"), `SessionStart` y `UserPromptSubmit`.
- **Bloqueo:** un hook bloquea con exit code 2, o devolviendo `{"hookSpecificOutput":{"permissionDecision":"deny", ...}}`. El motivo se le muestra a la IA para que corrija.
- **Usos típicos:**
  - proteger archivos;
  - bloquear comandos peligrosos;
  - correr lint/typecheck después de cada edición;
  - correr tests antes de terminar.
- Frase clave del blog de Anthropic sobre cómo dirigir a Claude: *"cuando algo absolutamente no debe pasar, una instrucción es la herramienta equivocada"*. https://www.claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more

### 1.3 Skills, subagentes, plugins
- **Skills** (`.claude/skills/<nombre>/SKILL.md`): procedimientos reutilizables. Solo la descripción ocupa contexto hasta que se usan.
- **Subagentes** (`.claude/agents/*.md`): trabajan en un contexto aislado y devuelven un resumen. Útiles como revisor de solo lectura o para correr tests.
- **Plugins LSP** (`typescript-lsp`, `pyright-lsp`, etc.): diagnósticos en vivo, ir a la definición y buscar referencias. Valor alto y costo bajo. https://code.claude.com/docs/en/plugins/code-intelligence
- **Superpowers** (obra/Jesse Vincent): paquete popular de skills de disciplina (TDD, debugging sistemático, verificar antes de terminar). Está pensado para que *la IA* programe mejor, no para que el humano aprenda.

### 1.4 MCPs (herramientas externas para la IA)
| MCP | Para qué | Evaluación |
|---|---|---|
| **Context7** | Documentación actualizada de librerías; evita APIs inventadas | **Alto.** `npx ctx7 setup` o `claude mcp add --transport http context7 https://mcp.context7.com/mcp` |
| **Serena** | Navegación semántica del código (LSP) | Medio-alto en repos grandes; se superpone con los plugins LSP |
| **Playwright** | Ver y probar interfaces web | Alto si hay UI; caro en tokens |
| **GitHub** | Issues, PRs | Medio; el CLI `gh` cubre casi todo |
| **Sequential Thinking** | "Pensar paso a paso" | Bajo; los modelos actuales ya lo hacen |
| **Memoria tipo grafo** | Memoria persistente | Bajo-medio; los archivos en el repo son más confiables |

Recomendación general: 3 a 6 MCPs bien elegidos. Hoy la carga diferida de herramientas reduce el costo de tener MCPs sin usar, pero no lo elimina. Fuente: https://parallel.ai/articles/best-mcp-servers-for-claude-code

### 1.5 Frameworks de "especificación primero"
- **GitHub Spec Kit** (https://github.com/github/spec-kit): constitución → especificación → plan → tareas → implementación.
- **Specs estilo Kiro:** `requirements.md` (formato EARS), `design.md`, `tasks.md`.
- **BMAD:** agentes con roles (analista, PM, arquitecto...). Proceso pesado.
- **Agent OS:** extrae las convenciones del código existente.

Evaluación: ordenan el proceso, pero **no hacen cumplir nada** y suponen que la IA implementa. AICode toma la idea de escribir la intención primero, no el framework.

### 1.6 Verificación mecánica ("harness engineering")
Böckeler (martinfowler.com, 2026) define al agente como **modelo + arnés**. El arnés tiene:
- **Guías**, que actúan antes de que el agente haga algo: contexto, instrucciones, LSP.
- **Sensores**, que actúan después: tests, linters, tipos, reglas de arquitectura, mutation testing.

Los sensores pueden ser **computacionales** (deterministas) o **inferenciales** (un LLM que juzga, no determinista). El punto débil es la corrección funcional: los tests escritos por la IA no alcanzan. https://martinfowler.com/articles/exploring-gen-ai/harness-engineering.html

Herramientas concretas (TS / Python):
- **Tipos estrictos:** `strict`, `noUncheckedIndexedAccess` / `mypy --strict`.
- **Lint estricto:** typescript-eslint `strictTypeChecked` / `ruff`.
- **Property-based testing:** fast-check / hypothesis. El humano define propiedades que son difíciles de "engañar".
- **Mutation testing:** StrykerJS / mutmut. Cambia el código a propósito; si los tests siguen pasando, no sirven. Es la defensa principal contra tests débiles.
- **Arquitectura:** dependency-cruiser / import-linter.
- **Código muerto y dependencias:** knip.
- **Duplicación:** jscpd.
- **Contratos en los bordes:** zod / pydantic.

### 1.7 Modos de falla de la IA y contramedidas
| Falla | Evidencia | Contramedida |
|---|---|---|
| Paquetes inventados (*slopsquatting*) | 19,7% de 2,23M muestras con paquetes que no existen; 43% se repiten (USENIX Security 2025) | La IA no instala dependencias (hook); lockfile congelado en CI |
| Tests debilitados o "hackeados" para pasar | Modelos que aprenden a hacer trampa con los tests (Anthropic, 2025) | Tests fuera del alcance de la IA; mutation testing |
| Código borrado en silencio | — | Diff determinista; snapshot y reversión |
| Duplicación, sobre-ingeniería | Bloques duplicados ×8 (GitClear) | jscpd, knip, cambios chicos |

---

## Parte 2 — Lado humano: aprender y no perder la habilidad

### 2.1 Ciencias del aprendizaje (sólida, en general fuera de la programación)
- **Andamiaje que se retira y reversión de la pericia.** Los ejemplos resueltos sirven a novatos y estorban a expertos; la ayuda tiene que ir bajando. Kalyuga propone dos chequeos rápidos de nivel: pedir "¿cuál sería el primer paso?" o pedir verificar rápido una solución. https://escholarship.org/content/qt0899206c/qt0899206c.pdf
- **Práctica de recuperación.** Recordar activamente, en vez de releer, mejora la retención (meta-análisis de 217 estudios, g ≈ 0,5–0,6).
- **Dificultades deseables y fracaso productivo.** Intentar antes de recibir la explicación mejora la comprensión conceptual (Sinha & Kapur 2021, 53 estudios). La cifra de "2–3 veces mejor" que circula en la prensa es exagerada.
- **Abuso de pistas.** En tutores de geometría, el 36% de las acciones eran saltar directo a la pista final. Usar demasiada ayuda se asocia con aprender menos. **Las escaleras de pistas necesitan fricción**: exigir un intento o una explicación antes de dar la siguiente. https://learnlab.org/research/wiki/index.php/Help_abuse

### 2.2 Estudios sobre IA y aprendizaje de programación
- **Anthropic, Shen & Tamkin 2026** (ensayo aleatorizado, N=52, aprendiendo la librería Trio):
  - Comprensión: 50% con IA contra 67% sin IA.
  - Velocidad: el grupo con IA no fue significativamente más rápido.
  - Lo más afectado fue depurar y leer código.
  - Quienes sacaron 65% o más hacían preguntas conceptuales, o pedían código *con explicación* y lo cuestionaban.
  - Quienes sacaron menos de 40% delegaban, o depuraban pidiéndole a la IA una y otra vez.
  - Fuentes: https://arxiv.org/abs/2601.20245 · https://www.anthropic.com/research/AI-assistance-coding-skills
- **Bastani et al., PNAS 2025** (~1.000 estudiantes de matemática):
  - Con GPT libre, la práctica mejoró un 48%, pero al retirar la IA rindieron un 17% peor.
  - Un "GPT tutor" que da pistas evitó ese daño.
  - Fuente: https://papers.ssrn.com/abstract=4895486
- **Kazemitabaar et al. 2025** (IUI) probó cómo lograr que el estudiante se involucre con el código. Funcionaron mejor:
  - **Lead-and-Reveal:** la IA pregunta cuál es el siguiente paso antes de mostrarlo.
  - **Trace-and-Predict:** predecir qué hace el código.
  - Fuente: https://arxiv.org/pdf/2410.08922
- **Prather et al. 2024, "The Widening Gap":**
  - Los estudiantes que ya sabían qué querían escribir aceleraron.
  - Los que tenían dificultades fueron desorientados por la IA y quedaron con una **ilusión de competencia**.
  - Fuente: https://arxiv.org/abs/2405.17739v1
- **CodeHelp / CodeAid** (miles de estudiantes): herramientas que dan pseudocódigo y comentan el código del estudiante en vez de darle la solución. Tuvieron buena adopción, pero hay poca medición de cuánto se aprende. https://arxiv.org/abs/2401.11314
- **CS50 duck, Khanmigo:**
  - CS50 tiene mucho uso y satisfacción, pero no midió aprendizaje.
  - Khanmigo tuvo un efecto similar a practicar sin IA.
  - No sirven como prueba de que los "modos tutor" enseñan.
- **METR 2025:** desarrolladores experimentados fueron 19% más lentos con IA y creían ser 20% más rápidos. https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/

**Límite de la evidencia:** los estudios son cortos (de minutos a una semana) y con estudiantes. No hay estudios largos con profesionales.

### 2.3 Herramientas existentes que mantienen al humano escribiendo
- **Estilo "Learning" de Claude Code:** deja marcas `TODO(human)` para que el humano escriba las partes con decisiones de diseño. Son instrucciones, no garantías. https://code.claude.com/docs/en/output-styles
- **Aider `--watch-files`:** el humano escribe comentarios `AI?` (pregunta) o `AI!` (pedido) en el código. Demuestra que los comentarios funcionan como canal en cualquier editor. https://aider.chat/docs/usage/watch.html
- **CodeTour (VSCode):** recorridos guardados en un archivo aparte, anclados con regex. Sufre que el anclaje queda desactualizado.
- **API de comentarios de VSCode:** hilos tipo revisión de código al costado del código, sin tocar el archivo.
- **Conventional Comments:** formato de comentario de revisión, `etiqueta (decoración): asunto` (issue, suggestion, question, praise...). https://conventionalcomments.org/

### 2.4 Comentarios en el archivo vs. archivo aparte
| | Comentarios en el archivo | Archivo aparte / panel del IDE |
|---|---|---|
| A favor | Cualquier editor; se ven donde se trabaja; se mueven con el código | No ensucian el código; se limpian fácil |
| En contra | Basura olvidada, desactualización, ruido en git | El anclaje se pierde; depende del editor |

Mitigaciones adoptadas en AICode:
- un prefijo único (`@guia`);
- un pre-commit que rechaza los comentarios pendientes;
- un comando de limpieza;
- una **verificación determinista** de que solo cambiaron comentarios: se compara el código sin comentarios, parseado con tree-sitter;
- la prohibición de comentarios "que son código": `@ts-ignore`, `# type:`, `eslint-disable`, doc-comments y directivas.

### 2.5 Modelar lo que sabe el usuario
- **Autodeclaración:** barata, pero mal calibrada. Sirve como punto de partida.
- **Señales observables útiles:**
  - resolvió sin pistas;
  - qué nivel de pista necesitó;
  - predijo bien qué hace el código;
  - corrigió solo sus errores;
  - lo recuerda después de unos días.
- **Modelo:** para un solo usuario con pocos datos, un puntaje por tema con decaimiento (tipo *Bayesian Knowledge Tracing*) es realista y explicable. Los modelos de aprendizaje profundo no aportan con tan pocos datos.

---

## Qué tomamos de todo esto (ver [design.md](design.md))
- La IA **habla con comentarios** y **no puede escribir código**. Eso lo garantizan hooks deterministas, no instrucciones.
- **Guía por niveles** según el perfil del usuario, con fricción en código crítico.
- **Lo repetitivo** se resuelve con snippets propios del usuario, que se reusan sin IA.
- **La verificación final** queda a cargo de sensores deterministas (tipos, tests, mutation testing), no de la opinión de una IA ni de una revisión humana que podría no hacerse.
