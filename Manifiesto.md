# Manifiesto y Guía Definitiva para Programar con Inteligencia Artificial (No Vibe Coding)

La programación asistida por Inteligencia Artificial ha dividido a los desarrolladores en dos grupos: quienes practican el **Vibe Coding** (dejarse llevar por "vibras", copiar código generado sin entenderlo y celebrar cuando pasa las pruebas visuales)[1] y los **ingenieros estratégicos** que utilizan la IA para amplificar su criterio técnico sin ceder el control[2][3].

---

### I. Principios Fundamentales del Manifiesto

- **Colaboración, no Delegación Ciega:** La relación con la IA debe ser de _pair programming_ o colaboración activa[4], jamás de delegación absoluta[5].
- **La IA es un Pasante Calificado:** Trata a la IA como un pasante brillante con enorme potencial pero sin contexto suficiente, que requiere dirección clara, límites definidos y revisión constante[6].
- **Entendimiento sobre Velocidad Superficial:** Aceptar código porque "funciona en desarrollo" sin comprender cada línea es una ilusión de productividad[1][7]. El tiempo ahorrado al generar código rápido se pierde con creces depurando fallos catastróficos en producción[7][8].
- **La Regla de Kernighan:** _"Depurar es el doble de difícil que escribir el código en primer lugar. Por lo tanto, si escribes el código al límite de tu capacidad de entendimiento, por definición no eres lo suficientemente inteligente como para depurarlo"_[9]. Si la IA genera código que va más allá de tu comprensión, te será imposible depurarlo cuando falle[9].
- **Aumentar el Criterio, no Reemplazarlo:** La IA está diseñada para eliminar el trabajo repetitivo y acelerar la exploración[3], no para pensar por ti ni tomar decisiones arquitectónicas críticas[3][6].
- **La Regla de Oro del Aprendiz:** _"Cualquier línea o algoritmo que le pidas a la IA que escriba, debes ser capaz de escribirlo tú mismo a mano primero"_[10].

---

### II. La Psicología del Programador y los Riesgos Cognitivos

1. **La Brecha Creciente (** **The Widening Gap** **):** El uso desmedido de IA amplía la brecha entre quienes poseen bases lógicas sólidas y quienes no[10]. En estos últimos, el uso de generadores automáticos incrementa la tasa de reprobación y dificulta la asimilación de conceptos fundamentales[10].
2. **La Ilusión de Competencia:** Generar código funcional crea la falsa percepción de entender el problema[11][12]. Sin embargo, al enfrentar preguntas conceptuales simples (como el comportamiento en escalabilidad o la elección de estructuras de datos), la comprensión se desmorona ("no saben lo que no saben")[11].
3. **Interrupción del Flujo Mental:** Las sugerencias automáticas constantes de la IA interrumpen la cadena de pensamiento del desarrollador[13]. Saltar las explicaciones teóricas para copiar código rápido genera confusión y atrofia el razonamiento[13][14].
4. **La Pérdida del Sentido de Propiedad y el Efecto "Meh":**

- Resolver un problema complejo por esfuerzo propio libera una descarga de dopamina y construye confianza personal contra el _síndrome del impostor_[15].
- Copiar soluciones generadas por IA destruye el sentido de autoría: cuando el código funciona, la satisfacción emocional es neutra o insípida ("meh"), desgastando la motivación genuina por programar[15].

5. **Diferencia entre Aprender y Simplemente Hacer:** Escribir código manualmente es mejor para la retención y la comprensión profunda[10][15]. Si utilizas IA en proyectos personales para ir más rápido, debes ser profundamente consciente de los atajos cognitivos que estás tomando y de cómo afectan tus habilidades a largo plazo[14][16].

---

### III. Configuración de Cimientos y Reglas de Entorno

Antes de escribir un solo prompt, se deben establecer las bases del entorno de desarrollo:

1. **Indexación del Contexto de la Base de Código:** Asegúrate de que la herramienta de IA indexe la base de código completa para poseer visibilidad estructural del proyecto[2].
2. **Reglas Globales (Global Rules):** Define estándares que apliquen a todos tus proyectos (por ejemplo, en _Warp Drive_)[2]. Incluye:

- Filosofía de pruebas automáticas[2].
- Librerías y paquetes preferidos[2].
- Estándares generales de estilo y comandos _bash_ comunes[2].

3. **Reglas Específicas de Proyecto (Project-Specific Rules):** Incluye en la raíz del repositorio un archivo (como `[enlace sospechoso eliminado]`, `[enlace sospechoso eliminado]` o `.cursorrules`)[17] con:

- _Stack_ tecnológico y versiones exactas de lenguajes y marcos de trabajo[17].
- Esquema de la base de datos y patrones de diseño de API[17].
- Convenciones para el nombrado de ramas en Git[17].
- Reglas por submódulo si ciertas áreas del proyecto requieren configuraciones distintas[17].

4. **Servidores MCP (Model Context Protocol):** Conecta tu entorno a servidores MCP para dotar al agente de IA de herramientas estandarizadas e interacción determinista con sistemas externos[18]:

- **MCP de Frameworks (ej. Svelte):** Ejecuta análisis estático y correcciones automáticas para evitar alucinaciones de código desactualizado[19].
- **MCP de Diseño (ej. Figma):** Extrae directamente especificaciones de interfaz y genera componentes UI (HTML, CSS, React, Tailwind)[19].
- **MCP de Monitoreo (ej. Sentry):** Consulta errores de tiempo de ejecución (_runtime_) e incidentes reales para pedirle a la IA que los solucione[20].
- **MCP de Integración de APIs (ej. Stripe):** Accede a la documentación exacta y actualizada de la versión de la API utilizada[20].
- **MCP de Gestión de Proyectos e Infraestructura (ej. GitHub, Jira, AWS, Cloudflare):** Extrae tickets de QA, gestiona _issues_ o aprovisiona recursos en la nube de forma controlada[21].

---

### IV. Reglas de Prompting y Selección de Modelos

1. **Especificidad Extrema (Prohibido pedir cosas vagas):**

- _Incorrecto:_ "Haz que el botón de editar alterne"[17].
- _Correcto:_ "Añade un campo booleano `editable` a la tabla `users`, exponlo en el endpoint `API/users/ID` y renderiza condicionalmente el componente `EditButton` según ese campo"[17].

2. **Inclusión Explícita de Contexto:** Referencia archivos o módulos específicos (`@context` o seleccionando fragmentos) en lugar de depender únicamente de la búsqueda global, lo que reduce alucinaciones y optimiza el consumo de tokens y costos[22].
3. **Prohibido Adivinar:** Si una instrucción es abierta o ambigua, exige a la IA que no asuma soluciones, sino que devuelva opciones con sus pros y contras (_trade-offs_)[23][24].
4. **Uso de Apoyo Visual:** Para errores de interfaz o maquetación, adjunta capturas de pantalla o imágenes descriptivas directamente en el prompt[23][25].
5. **Estrategia y Selección de Modelos:**

- Utiliza modelos de razonamiento profundo (como GPT-5 o modelos de razonamiento alto) para la fase de planificación[23][24].
- Emplea modelos optimizados para generación de código (como Claude Sonnet) para la implementación de las tareas[24].
- No cambies de modelo arbitrariamente a mitad de una conversación a menos que sea un flujo planificado, ya que se pierde la caché de contexto e incrementa el costo[23].

6. **Conversaciones Cortas y Enfocadas:** Mantén cada chat dedicado a una única tarea bien delimitada, reduciendo costos e historial acumulado que confunde al modelo[26].

---

### V. El Flujo de Trabajo Paso a Paso (Workflow de Ingeniería)

#### Paso 1: Comprensión y Diseño Previo Humano

Antes de acudir a la IA, analiza el problema, comprende la arquitectura y define la solución requerida por ti mismo[3][26].

#### Paso 2: Planificación Previa (sin código)

1. Pide a la IA en lenguaje natural que elabore un **plan de implementación detallado**[24][26].
2. Indícale que especifique: flujo de datos, clases/funciones clave, integración con componentes existentes y retos potenciales[24][26].
3. Incluye la instrucción explícita: _"No escribas código todavía; enfócate en los pasos prácticos"_[24].
4. Si algo en el plan resulta ambiguo, solicita que presente **dos opciones concretas con sus pros y contras** para elegir la mejor alternativa[24].

#### Paso 3: Ejecución con Restricciones

Una vez aprobado el plan, solicita la implementación aplicando límites estrictos:

- _"Implementa exactamente este plan con las siguientes restricciones: edita únicamente los archivos X e Y, no agregues nuevas dependencias, preserva los filtros existentes y provee el código junto con las instrucciones para probarlo"_[24].

#### Paso 4: Revisión de Código (Pair Programming)

Cuando la IA entregue la solución, no la integres ciegamente:

1. Realiza una revisión de código (_Code Review_) rigurosa[4].
2. Hazle preguntas críticas a la IA: _"¿Por qué elegiste este patrón?", "¿Cuáles son los casos de borde o error?", "¿Cómo impacta esto en el rendimiento?"_[4].
3. Inspecciona el código, edita manualmente lo que consideres necesario y pídele a la IA que refactorice alrededor de tus cambios[4].

#### Paso 5: Pruebas y Validación de Rendimiento

Verifica aspectos clave que la IA suele pasar por alto:

- Manejo de concurrencia y condiciones de carrera (_race conditions_)[8].
- Lógica de desacoplamiento de eventos (_debounce_), frecuencias de peticiones (_rate limiting_) y almacenamiento en caché (_caching_ / invalidez de caché)[7][8].
- Ejecución de pruebas unitarias y de integración[5][6].

#### Paso 6: Flujos Avanzados de Múltiples Agentes y Git

1. **Agentes Especializados:** En tareas complejas, asigna roles distintos a agentes independientes (por ejemplo: Agente 1 escribe el código, Agente 2 realiza la revisión, Agente 3 escribe las pruebas y Agente 4 refactoriza según el feedback)[5].
2. **Paralelismo con Git Worktrees:** Para ejecutar múltiples tareas en paralelo sin interferencias, crea ramas e instancias aisladas mediante _Git Worktrees_, supervisando y aprobando los cambios de cada agente de forma aislada[25].
3. **Operaciones Git en Lenguaje Natural:** Utiliza órdenes directas para gestionar ramas y correcciones (ejemplo: _"crea una rama de release y aplica cherry-pick de los arreglos"_)[25].

#### Paso 7: Cuándo Desconectar ("Pull the Plug")

Si la IA entra en un bucle de degradación de código (_prompt treadmill of hell_)[27], genera soluciones defectuosas o pierde el hilo del contexto:

- **Detén la interacción de inmediato**[6].
- Revierte los cambios al último punto de control (_commit_) estable y retoma el problema replanteando el enfoque o resolviéndolo manualmente[6].

---

### VI. Reglas de Oro Senior y Ejercicios Prácticos

1. **Líneas Rojas (Lo que NUNCA se delega a la IA):**

- Lógica central de negocio (_core logic_) que requiere comprensión profunda del sistema[3].
- Rutas críticas del sistema y arquitectura distribuida[3][28].
- Código relacionado con seguridad, autenticación y cifrado[3].

2. **Para qué SÍ usar la IA:**

- Código repetitivo (_boilerplate_) que entiendes perfectamente[3].
- Archivos de configuración y plantillas de pruebas[3].
- Exploración de múltiples alternativas ante un problema (_"muéstrame 3 enfoques distintos para resolver esto"_)[3].
- Exploración e incorporación (_onboarding_) en bases de código desconocidas (pedir diagramas de flujo, rastreo de datos o resúmenes de componentes)[29].

3. **El Ejercicio de Reconstrucción Semanal:**

- Elige una funcionalidad que hayas construido con ayuda de la IA durante la semana[30].
- Reconstrúyela completamente desde cero utilizando únicamente la documentación oficial y tu propio razonamiento[30].
- Este hábito garantiza que sigas desarrollando modelos mentales sólidos, evitando la atrofia de tus habilidades técnicas[9][30].
