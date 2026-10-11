# Historial del proyecto (para retomar después de un rebuild)

Este es un resumen de la conversación del 2026-10-07 que dio origen a AICode. El chat completo está respaldado en `.claude-backup/` y `.devcontainer/post-create.sh` lo restaura en `~/.claude` al reconstruir el contenedor.

## Pedido original
Mejorar al máximo la forma de programar con IA **sin vibecoding**: que el usuario sea consciente de cómo queda el programa. El objetivo es un sistema **Humano + IA** con dos metas:
- poder programar cosas críticas sin miedo a errores de la IA;
- ahorrar tiempo en lo trivial.

## Cómo evolucionó el diseño (y por qué)
1. **Primera propuesta:** la IA programa y una cadena de controles la verifica (specs, mutation testing, recibos de comprensión).
   - **Rechazada:** "no podemos depender de que el humano revise; podría no revisar".
2. **Segunda propuesta:** zonas en las que la IA no edita y snippets que la IA rellena.
   - **Rechazada:** "veo que la IA está programando todo". Los snippets rellenados por la IA siguen siendo la IA escribiendo el código.
3. **Investigación del lado humano**, a pedido del usuario. Lo central:
   - delegar el código baja la comprensión (estudio de Anthropic: 50% vs 67%);
   - la guía debe adaptarse al nivel de la persona;
   - las pistas necesitan fricción.

   Ver [research.md](research.md).
4. **Idea del usuario, adoptada:** la IA se comunica con **comentarios** en el código, un script los ubica en el lugar correcto y verifica que sean solo comentarios. La IA da las piezas y el humano arma el código. La guía se adapta al nivel y tiene buena memoria; Honcho queda como opción.
5. **Refinamientos del usuario:**
   - Activar todo con un **atajo de teclado**, no con comandos `/guia`.
   - **Separar cada pedido** en una consulta propia, para no perder calidad de razonamiento.
   - Al terminar, hacer una **revisión** de bugs, recomendaciones, etc.
   - Que sirva para **todo** lo que se programa (Docker, terminal, arquitectura), no solo para código.
   - Lo repetitivo: **snippets propios del usuario**. La IA lo guía para crearlos y después los reutiliza sin IA.
   - El modo de delegación es configurable.
6. **Principio pedido explícitamente:** todo lo importante debe ser **determinista**, no depender de que la IA "se dé cuenta".

## Preferencias del usuario
- Español, con explicaciones simples y ejemplos desde su perspectiva.
- **Cuestionar sus ideas con evidencia**, no aceptarlas sin más.

## Documentos
- Plan aprobado: `.claude-backup/plans/el-proyecto-es-lograr-typed-lark.md`
- Diseño y estado de cada fase: [design.md](design.md)
- Investigación: [research.md](research.md)

## Cómo retomar
Después del rebuild, abrí Claude Code. Para recuperar el chat completo, usá `/resume`. Si no, alcanza con pedirle que lea `docs/historial.md` y `docs/design.md`.

## Sesión 2026-10-07 (continuación): fases 3 a 7
- **Persistencia:** el chat y la memoria de Claude se respaldan en `.claude-backup/` y se restauran solos. Hay volúmenes para `~/.claude` y `~/.aicode`; este último guarda tu perfil, que se comparte entre proyectos.
- **Pedido del usuario a mitad de sesión:** un lugar para decir con palabras qué busca el proyecto y cuál es su "código de conducta". Se resolvió con:
  - `.aicode/proyecto.md` y `.aicode/reglas.md`, más reglas por carpeta;
  - `.aicode/reglas.json` para las reglas mecánicas;
  - la memoria de errores frecuentes (`~/.aicode/patrones.json`), que la guía usa para insistir donde más fallás.
- **Decisiones técnicas:**
  - Se usa el Claude Agent SDK, que reutiliza la sesión de Claude Code (sin API key), con herramientas solo de lectura y salida JSON.
  - typescript-eslint todavía no soporta TS 7, así que se usa TS 6.
  - Stryker necesita Node 22, así que el Dockerfile pasó a Node 22. **Hace falta un rebuild.**
- **Ajustes después de las pruebas reales:**
  - La revisión generaba comentarios duplicados; se agregó una consolidación con un máximo de 8.
  - Las predicciones revelaban la respuesta; ahora se filtran de forma determinista.
  - `corre` perdía las comillas de los argumentos; corregido.
  - La IA ahora tutea, igual que el usuario.
- Honcho queda pendiente y es opcional: necesita una cuenta propia y envía datos a un tercero.
- **Revisiones:** 23 hallazgos de dos revisores (seguridad y corrección), todos corregidos y con prueba de regresión (`aicode selftest`: 71/71).

## Sesión 2026-10-07 (tarde): de "tutor" a "acompañante"
**Feedback del usuario después de probarlo:** "pierdes todo el beneficio de la IA". Lo que quedó claro, en sus palabras:
- La IA **no programa sin supervisión**, pero tampoco debe ser solo "programa tú, yo te digo dónde".
- La IA **nunca escribe código en los archivos**. Solo deja comentarios con ideas, el plano (qué funciones, qué hace cada una) y **snippets**.
- **Los snippets son la vía rápida.** Los crea el humano, o vienen de una base de estructuras muy conocidas. La IA los sugiere, y **se activan solo por acción humana**: marcando `[x]` o con Ctrl+Alt+E. La IA no puede activarlos, y eso se garantiza con scripts antes de escribir.
- **La escalera solo en lo crítico.** En el resto, ideas directas. Se pueden pedir escalones concretos (`!pseudo`, `!ejemplo`...). Una pregunta nueva no sube de nivel.
- **Dinamismo:** que acompañe en cada paso, con arquitectura desde el inicio; si vas bien no interrumpe, y si te trabas te ayuda.

**Implementado:**
- Modo directo y escalera solo en lo crítico.
- Pedidos explícitos (`!pista`, `!piezas`, `!pseudo`, `!ejemplo`, `!plano`, `!snippet`, `!arquitectura`).
- Biblioteca de snippets (tuyos + base) con `@snippet:` y sugerencias `snippet [ ]` que se activan con `[x]`.
- `aicode expandir`, con Ctrl+Alt+E en VSCode.
- El acompañante, que corre al guardar: expande lo activado, responde, propone el plano del proyecto y del archivo, y ayuda si detecta que te trabas (por contadores deterministas).
- `aicode plano` para la arquitectura del proyecto.
- La plantilla de `CLAUDE.md` refleja todo esto, y `aicode init` la refresca.
- Selftest: 88/88.

**Pendiente (el usuario dijo "luego"):** configurar por carpeta dónde sí y dónde no, y que "lo ya conocido" (perfil) habilite más.

## Cierre del objetivo: comentarios mientras avanzas, ahorro de tokens, publicar en git
- **Comentarios mientras avanzas:** el acompañante detecta cuándo terminaste una parte (cambió, compila y pasaste a otra) y la comenta con correcciones y mejoras. Solo esa parte viaja a la IA, con un máximo de 2 comentarios. Se probó con IA real: corrigió la validación de un porcentaje y sugirió un nombre mejor, por US$0,04.
- **Ahorro de tokens:**
  - huellas por función o clase: `revisar` no reenvía lo que no cambió; si cambió una parte, manda esa parte y del resto solo las firmas;
  - modelo rápido (Haiku) para consolidar;
  - límites por hora;
  - registro en `~/.aicode/uso.jsonl` con el comando `aicode uso`, que muestra tokens, caché, costo y llamadas evitadas.
- **Nivel por carpeta:** `acompanar.porCarpeta`.
- **Publicación:**
  - `.gitignore`: no se suben las transcripciones de chats (`.claude-backup/`);
  - `scripts/instalar.sh`;
  - CI que compila y prueba;
  - un release por tag que publica `aicode.tgz` y `aicode.vsix`;
  - el README con la instalación para otros proyectos.
  - La instalación desde el `.tgz` en un entorno limpio se verificó: 93/93.

## Cambio de nombre: AICode → ComplementAIry
- El usuario eligió **ComplementAIry**: la IA *complementa* al humano. Se le advirtió que el nombre es largo para la terminal y que el juego de palabras se pierde en minúsculas, así que se acordó un comando corto.
- **Comando:** `cai` (también `complementairy`).
- **Carpetas:** `.cai/` en el proyecto y `~/.cai` para el perfil.
- **Paquetes:** `packages/complementairy` y `packages/vscode-complementairy`.
- **Extensión:** `complementairy.complementairy`, con los comandos `cai.*`.
- **Compatibilidad:**
  - el comando `aicode` sigue disponible;
  - los proyectos con `.aicode/` se leen y quedan protegidos;
  - `cai init` migra hooks, la sección de CLAUDE.md, las skills y los snippets base sin duplicar nada;
  - el volumen del perfil conserva su nombre (`aicode-perfil`) y se monta en `~/.cai`, así que no se pierden datos.
- Selftest: 95/95.

## Prácticas, tests, panorama y memoria del proyecto
**Pedido del usuario:**
- prácticas por defecto pero modificables;
- acompañar mirando todo el proyecto, con un comando y un resumen de lo que pasa;
- tests en otra carpeta;
- que la IA pregunte cuando le falta contexto y vaya entendiendo el proyecto;
- que no se ancle a cómo el usuario hizo las cosas.

**Implementado:**
- **Prácticas medibles** (`.cai/config.json` → `practicas`), medidas con el parser sin IA. Al superar un umbral, se pide un plano de diseño, una vez por problema.
- **Tests:**
  - aviso sin IA cuando una función exportada terminada no tiene tests;
  - `!tests` y `cai tests` proponen casos apagados en `tests/`, con imports calculados por el script;
  - los valores esperados se basan en la intención, y si hay duda la IA pregunta;
  - los decimales usan `toBeCloseTo`;
  - las descripciones se limpian de código.
  - Prueba real: de 3 casos activados, 2 pasan y 1 falla (el bug pendiente).
- **`cai panorama`:**
  - estado, sugerencias, alternativas, riesgos y preguntas;
  - las mediciones sin IA;
  - código completo si el proyecto es chico (antes, sin él, la IA se equivocaba).
- **Memoria** (`.cai/conocimiento.md`):
  - resúmenes por módulo, actualizando solo lo que cambió, con el modelo rápido;
  - las respuestas del usuario pasan a la memoria;
  - como mucho 6 preguntas abiertas, sin repetir;
  - todo se usa como contexto en cada consulta.
- **Criterio en todos los prompts:** no anclarse y preguntar si falta contexto.
- **Extensión:** Ctrl+Alt+P (panorama), proponer tests y abrir la memoria.
- Selftest: 103/103.

## Publicado en GitHub (2026-10-07)
- Repositorio público: https://github.com/Slendy4514/ComplementAIry (licencia MIT). Los commits usan el correo privado `noreply` de GitHub.
- v0.3.0 publicada:
  - el CI y el release pasaron en GitHub Actions;
  - el release incluye `complementairy.tgz` y `complementairy.vsix`;
  - la feature está en `ghcr.io/slendy4514/complementairy/complementairy` (tags `0`, `0.3`, `0.3.0` y `latest`), con acceso público.
- **Próximas versiones:** `git tag vX.Y.Z && git push origin vX.Y.Z`. La extensión avisa en los contenedores y se actualiza con Rebuild.

## Proyectos ya armados: autoría y `cai conocer` (v0.4.0)
- **Pedido:** indicar qué código hizo el usuario y cuál no, y que el `init` de un proyecto existente lo ayude con preguntas, sin abrumarlo con pensar todo de cero.
- **Autoría** (`autoria.heredado` / `autoria.terceros`):
  - se sugiere sin IA, a partir del historial de git;
  - el código heredado no se le atribuye al usuario ni cuenta en su perfil, y el acompañante no lo comenta salvo que se active;
  - el código de terceros se ignora.
- **`cai conocer`** (lo ofrece `init` si ya hay código):
  - redacta borradores de proyecto.md y reglas.md;
  - hace hasta 5 preguntas, cada una con su respuesta sugerida;
  - pide confirmación antes de marcar la autoría;
  - no pisa lo que el usuario ya escribió.
  - Prueba real: buen borrador, 9 convenciones correctas y 5 preguntas útiles, por US$0,13.
- Selftest: 109/109.

## Usar ComplementAIry desde el chat de Claude Code (v0.4.1)
- **Bug encontrado al revisarlo:** si el chat corría `cai panorama`, `cai plano`, `cai arquitectura` o `cai conocer`, los hooks revertían lo que escribían, porque `.cai/` y `docs/` están protegidos.
- **Arreglo determinista:** si el comando es una sola llamada a `cai`, sin encadenar nada, se permiten solo los archivos que ese comando genera. `proyecto.md` y `reglas.md` se permiten únicamente si estaban vacíos.
- **Siguen siendo del humano:** `cai init`, `cai expandir`, `cai snippet nuevo` y `cai perfil set` quedan bloqueados para la IA.
- **Skill nueva `cai`:** indica qué comando corresponde a cada pedido. Las otras skills ahora corren los comandos en vez de pedirle al humano que apriete el atajo.
- Selftest: 114/114.

## Error al reconstruir el devcontainer (v0.4.2)
- **Síntoma:** error en la terminal o en la creación del contenedor, y la extensión no aparecía.
- **Causa 1:** la feature (aplicada por `dev.containers.defaultFeatures`) instalaba `cai` como root. Después, `post-create.sh` hacía `npm link`, fallaba con EACCES y, con `set -e`, se cortaba todo lo que seguía.
- **Causa 2:** en los hooks del devcontainer, `code --install-extension` no siempre puede hablar con la ventana, y fallaba en silencio.
- **Arreglos:**
  - la feature deja el paquete a nombre del usuario del contenedor (`_REMOTE_USER`);
  - para la extensión, si `code` falla, se usa el binario del servidor de VSCode (`code-server`), que no necesita la ventana;
  - `post-create.sh` ahora tiene pasos independientes (avisa y sigue), y `npm link` reintenta con sudo;
  - `post-attach.sh` instala la extensión de la misma forma robusta.
- **El chat no se pierde en un rebuild:** `~/.claude` es un volumen que se conserva entre reconstrucciones, y además está el respaldo en `.claude-backup/`, que se restaura solo si el volumen está vacío.

## v0.5: experiencia de uso (2026-10-08)
- **Lo que reportó el usuario al probarlo en `Files.js`:** el autoguardado chocaba con los comentarios que escribía la IA; demasiado texto y listas `1) 2)` pegadas; restos de un snippet ya expandido; no se sabía si la IA estaba pensando y se podían lanzar revisiones encima; lo de una función no quedaba junto a ella; no quedaba claro por dónde seguir; quería modelos por tamaño; snippets insertados dentro de la función.
- **Decisiones del usuario:** vista **Notas** por defecto en VSCode; modelos **Haiku / Sonnet / Opus**, todos a través de Claude Code; notas **clicables** (pedir pseudocódigo y demás con un botón), escribir en la nota y que la IA responda, y seleccionar código para preguntar.
- **Hecho:**
  - notas fuera del archivo, re-anclaje sin IA y salida única notas/comentarios;
  - `cai responder`, `cai notas`, `cai siguiente`, `cai tareas`, `cai plano --archivo`, `cai snippet cuerpo` y `revisar --ediciones --json`;
  - bloqueo por archivo con un pedido en espera;
  - plano de archivo estructurado con tareas que se marcan solas;
  - listas en líneas separadas y arreglo del resto huérfano al expandir;
  - modelos por tamaño (`ia.modelos`).
- **Extensión:**
  - notas como hilos con botones y caja de respuesta;
  - panel "Siguiente paso" con tareas y notas;
  - barra de estado con cancelar y silenciar;
  - "pensando…" en la línea;
  - CodeLens, hover y Problemas;
  - "Insertar aquí" para snippets;
  - preguntar sobre la selección.
- Selftest: 127/127.

## v0.6: proyecto, archivo y función (2026-10-08)
- **Lo que notó el usuario:** no había ayuda para el archivo entero, y el botón "Plano" aparecía en cada función aunque habla del archivo. La estructura, el panorama y las preguntas eran documentos sueltos, incómodos de usar.
- **Decisiones del usuario:** el panorama se ve en el panel (no en una página aparte), y se hace el cambio completo.
- **Hecho:**
  - **Botones arriba del archivo** (Plano, Ayuda con el archivo, Revisar, notas); las notas de archivo van arriba (`--archivo-entero`). "Plano" ya no está en las funciones.
  - **`docs/ESTRUCTURA.md` en markdown limpio,** más `.cai/estructura.json`. Los archivos que faltan pasan a ser tareas ordenadas, que se marcan solas al crear el archivo.
  - **Las sugerencias del panorama pasan a ser tareas.**
  - **Preguntas con su sugerencia aparte,** que se responden desde el panel (`cai memoria`).
  - **Panel → Proyecto:** estado, árbol de estructura con "Crear archivo" (clic humano, archivo vacío) y preguntas para ti.
  - **Prueba real** de `cai plano` en una copia de demo-ts: estructura clara, 10 archivos por crear como tareas y 4 preguntas útiles, por US$0,15. Con esa prueba se corrigieron la numeración doble y el orden de las tareas, y las preguntas se separaron de la sugerencia.
- La revisión independiente encontró 18 problemas, todos corregidos. Los más importantes: una respuesta con saltos de línea podía pisar las notas de la memoria; el panorama podía pisar una respuesta dada mientras la IA pensaba; las tareas y las preguntas se repetían en cada propuesta; y desde el chat, `cai plano` podía cambiar lo que respondiste (ahora solo puede agregar preguntas).
- Selftest: 135/135.

## v0.6.1: `cai panorama` se caía (2026-10-08)
- **Síntoma:** `cai: Cannot read properties of undefined (reading 'apply')` al pedir el panorama.
- **Causa:** la gramática de Bash de `tree-sitter-wasms` se cae con `[ a != b ]` (había uno en `install.sh`), y un solo archivo que no se podía analizar tumbaba todo el panorama.
- **Arreglo:**
  - `web-tree-sitter` pasa de 0.20.8 a 0.25.10, con las gramáticas oficiales de Bash (`tree-sitter-bash`) y de YAML (`@tree-sitter-grammars/tree-sitter-yaml`), que traen binarios ya compilados;
  - las demás gramáticas siguen saliendo de `tree-sitter-wasms`; probé que las 23 cargan;
  - si un archivo no se puede analizar, el panorama lo salta con un aviso en vez de caerse.
- Selftest: 135/135, incluidas las garantías de seguridad, que dependen de este analizador.

## v0.7: una nota por función, panel "Nota", "¿quedó lista?" (2026-10-08)
- **Feedback del usuario:**
  - las notas duplicaban y comentaban otras funciones;
  - estorbaban entre la firma y el cuerpo, y robaban el foco al escribir;
  - quería pedir "¿quedó lista?";
  - la tarea "Crear TaskRule.js (y JournalRule.ts)" quedaba rota;
  - faltaba dinamismo y sugerencias rápidas;
  - el texto de las tareas aparecía cortado, las tareas nunca se archivaban y "Después" repetía "Tareas";
  - quería conversar sobre las preguntas, y que la IA no preguntara lo que se ve en el código;
  - en modo notas, el chat debía usar notas;
  - cuidado con el autoguardado;
  - quería un lugar donde configurar todo.
- **Decisiones del usuario:** panel lateral "Nota" que sigue al cursor; sugerencias como texto gris al final de la línea; "¿quedó lista?" con botón y también al guardar.
- **Hecho:**
  - **Una nota por función:** lo nuevo se agrega a su hilo, y las duplicadas viejas se fusionan al leerlas. `responder` solo ve la función de la nota. Los métodos con el mismo nombre se distinguen (`render#2`).
  - **Panel "Nota":**
    - muestra estado, "Qué hacer", botones, historial y una caja para conversar;
    - también el detalle completo de tareas y preguntas;
    - en el código ya no se abre nada: solo un ícono en el margen y CodeLens (los hilos en línea quedan como opción).
  - **`cai verificar`:** primero sin IA; después lista (cierra la nota), casi o falta, sin repetir si la función no cambió. Corre al guardar con Ctrl+S, o con autoguardado cuando dejas de editar (45 s).
  - **Tareas:** rutas normalizadas, archivo creado en otra carpeta (si el nombre es único), archivado al día siguiente y "descartar" (solo el humano).
  - **Panel:** Ahora / Pendientes / Proyecto / Hechas / IA, con aviso de panorama desactualizado y archivos fuera de la estructura.
  - **Preguntas:** filtro sin IA de lo que se ve en el código y `cai memoria conversar`.
  - **Sugerencias rápidas:** tardan ~20 s y cuestan ~US$0,016 cada una, sobre todo por arrancar Claude Code en cada llamada.
  - **Configuración:** pantalla que escribe solo lo que cambias en `.cai/config.json`.
  - **Chat en vista notas:** el hook rechaza agregar o reescribir `@guia` y le indica `cai responder`.
- **Revisión independiente:** encontró 21 problemas, todos corregidos con tests `[rev]`. Los principales:
  - métodos homónimos compartían nota;
  - la fusión perdía el estado de los `@ia?`, que se volvían a responder;
  - el bloqueo del archivo se soltaba a mitad del acompañante;
  - el panel aceptaba HTML de la IA (ahora se sanea);
  - la configuración podía borrar claves del usuario.
- **Prueba real:** nota → 🔴 falta (validación) → el usuario la agrega → 🟡 casi (falta validar monto y tasa). La conversación sobre una pregunta explicó por qué importaba, con un ejemplo.
- Selftest: 151/151.

## v0.8: rápido, sin sesgo y con modos (2026-10-09)
- **Pedidos del usuario:**
  - no volver a ofrecer lo que ya se dio;
  - que los snippets vayan donde corresponde y se vea dónde antes de insertarlos;
  - más dinamismo y respuestas rápidas;
  - quitar el sesgo hacia lo ya hecho;
  - control con velocidad: avanzar rápido sin perder de vista qué pasa.
- **Decisiones del usuario:**
  - revisión a ciegas siempre, y "otra mirada" en "Revisar" y en "¿quedó lista?" con el botón;
  - **modos** programar/aprender que se eligen por proyecto, carpeta, archivo o función, sin romper lo ya hecho (la explicación con tus palabras vive en el modo aprender);
  - proceso de Claude Code abierto, activado por defecto, con respaldo.
- **Investigación:** Agent SDK en modo de entrada continua; Cross-Context Review (arXiv 2603.12123); encuadre en la revisión de código (arXiv 2603.18740); anclaje en LLMs (arXiv 2412.06593); Kazemitabaar (IUI'25); Anthropic (2026) sobre la formación de habilidades; Bastani (PNAS 2025); METR (2025).
- **Hecho:**
  - modos con precedencia función > archivo > carpeta (la más específica) > proyecto, guardados en la configuración;
  - escalones ya dados y "➕ Más ayuda";
  - snippets ubicados dentro de la función, con vista previa, elección del lugar y registro en la nota;
  - **proceso abierto** (`cai servir`): medido en **~1 s y ~US$0,002** por sugerencia (antes ~20 s y ~US$0,016). La clave fue desactivar el razonamiento extendido: con él, el modelo chico "pensaba" más de 15 s;
  - texto en vivo (solo el título y el "qué hacer", hasta pasar el filtro);
  - revisión a ciegas y "otra mirada". En la prueba real, la otra mirada encontró que con una tasa diminuta `factor − 1 = 0` daba NaN;
  - "Qué hizo la IA", metadatos por respuesta, líneas sin revisar, comprensión medida en el panorama, modo y siguiente paso en la barra de estado.
- **Revisión independiente:** encontró 20 problemas, todos corregidos con tests `[rev8]`. Los principales:
  - tras un tiempo agotado, el proceso abierto podía cruzar respuestas entre pedidos;
  - una sugerencia podía cobrarse hasta tres veces;
  - con comillas se podía esquivar el bloqueo del chat;
  - el texto en vivo mostraba respuestas que el filtro iba a descartar;
  - cambiar el modo de una función tocaba notas.
- Selftest: 161/161.

## v0.8.1: dónde salen las sugerencias rápidas (2026-10-09)
- **Reporte del usuario:** no veía las sugerencias rápidas.
- **Causa:** la extensión solo las pedía con el archivo guardado (la CLI leía el disco). Sin autoguardado, mientras escribes nunca se pedían, y al guardar tampoco se disparaban.
- **Arreglo:**
  - el proceso abierto recibe el **texto del editor** (sirve sin guardar);
  - se piden también al guardar;
  - **Ctrl+Alt+Espacio** pide una ya y, si no hay, dice por qué.
- Selftest: 162/162.

## v0.8.2: guía línea a línea y tests que se prueban solos (2026-10-09)
- **Pedido del usuario:** que las sugerencias vayan guiando línea por línea mientras se escribe la función. Que 🧪 Tests cree los tests (con IA) y que se prueben al guardar con Ctrl+S, a salvo del autoguardado, mostrando el resultado.
- **Guía:**
  - en cualquier función, en cada pausa (~1 s): el próximo paso según los pasos de la nota, o qué está mal en la línea;
  - la anterior queda tenue mientras escribes;
  - sin código (si lo trae, se pide de nuevo solo con palabras) y con tuteo.
  - Prueba real: avisó "compara en vez de asignar" apenas se escribió `if (destino = "")`.
- **Tests:**
  - propone casos y los prueba ya;
  - los guarda como tests (`tests.crearConIa`), con los dudosos apagados;
  - al guardar con Ctrl+S se vuelven a probar sin IA (`tests.alGuardar`), y el resultado aparece en el panel Nota.
  - Prueba real: 8 casos (7 ✅, 1 ❓), el archivo creado pasa en vitest (7/7), y al meter un bug se detectó al guardar (6 ✅ · 1 ❌).
  - Un resultado con decimales usa `toBeCloseTo`, para que no falle por la imprecisión de los decimales.
- Selftest: 164/164.

## v0.9.0: todo se conoce, decisiones con botones y chat del proyecto (2026-10-09)
- **Pedido del usuario:**
  - que las funciones se conozcan entre ellas (y su estado) y que la IA conozca el plan general sin pensar de cero ni repagar;
  - un chat fuera de los archivos, y que Claude Code funcione con el plugin (pedía comentarios `@guia` en modo notas);
  - que la guía gris no se corte; botones para decidir;
  - varias revisiones a la vez, revisar al salir de un archivo y que "Revisar archivo" diga si quedó listo, función por función;
  - tests para código que no puede exportar.
- **Decisiones del usuario:**
  - chat: los dos (vista propia y Claude Code integrado);
  - revisión al salir: apagada por defecto; ligera al activarla, configurable a completa;
  - el registro de decisiones tiene que poder **retractarse**;
  - **nada específico de una aplicación** (Obsidian fue solo un ejemplo): los tests sin export son un mecanismo genérico.
- **Hecho:**
  - índice vivo (`cai indice`), contexto común para toda la IA, avisos de impacto;
  - decisiones con botones (pendiente → vigente → retractada, con historial; solo las toma el humano);
  - chat "Proyecto" (`cai chat`, solo lectura);
  - revisión completa con veredicto del archivo (`cai revisar --completo`) y revisión al salir (`revisar.alSalir`);
  - guía gris ≤ 70 caracteres, cortada en una palabra, con hover y "Guía actual" en el panel;
  - tests sin export: el archivo se carga tal cual en `node:vm`, con dobles del entorno propuestos como datos;
  - `cai hoy`, `cai deuda`, `cai sesion` (resumen y commit sugerido);
  - `CLAUDE.md` con instrucciones v0.9 (`cai init --solo-claude`); la extensión avisa si están viejas.
- **Prueba real** (copia de demo-ts):
  - el chat respondió con el índice y propuso 2 decisiones y 3 tareas;
  - decidir "lanzar error con negativos/NaN" hizo que la revisión completa lo exigiera (🔴 0/1 listas, US$0,16); retractarla la sacó del contexto;
  - cambiar `calcularCuota` avisó en `resumenPrestamo` (que no tenía nota: ahora se crea);
  - el resumen de sesión ahora cuenta los archivos nuevos sin commit.
- **Revisión independiente:** encontró 10 problemas, todos corregidos con tests `[rev9]`. Los principales:
  - **una expresión de prueba de la IA podía salir del aislamiento** (`console.log.constructor(...)` llegaba al `Function` de Node). Ahora los argumentos se validan con un parser de **lista blanca** de literales (`literales.ts`) en un único punto (`ejecutar`), también para los casos en caché. El contexto no recibe objetos de Node, y el proceso corre con `node --permission` (solo lee su programa y tu archivo). El mismo agujero existía desde antes en `predecir`;
  - el valor esperado se pegaba tal cual en el archivo de tests: si no es literal, queda "?";
  - el snapshot aceptaba cualquier cambio en `decisiones.json`: ahora un comando de la IA solo puede agregar pendientes;
  - en el sandbox, `setTimeout`, `URL` y CommonJS fallaban como si fuera un bug del código;
  - el índice perdía llamadas a funciones creadas después, y dos guardados juntos se pisaban (candado `conCandado`);
  - una función sin verificar podía dejar el archivo 🟢; la guía revisaba código solo en el texto recortado; el chat no veía las decisiones de cada archivo.
- **Pendiente (opcional):**
  - decisiones también desde el plano de archivo, el plano y el panorama;
  - preguntas de la memoria con opciones → decisiones;
  - completar el "?" de un test al decidir;
  - cobertura de casos por función en la guía;
  - cola de revisiones visible en el panel.
- Selftest: 178/178.

## v0.10.0: entender, chat completo (y Claude Code igual), modo programar (2026-10-10)
- **Pedido del usuario:**
  - ideas en el panel a partir del panorama;
  - que el chat cambie tareas según lo que planea, guarde varias conversaciones y deje elegir la IA;
  - poder corregir lo que ComplementAIry entiende del proyecto;
  - decisiones con vuelta atrás y "otra opción" en el chat, y feedback al agregar una tarea;
  - que Claude Code haga lo mismo que el chat del plugin;
  - que la guía no sugiera lo que ya está escrito más abajo;
  - notas más ligeras (qué se pidió y cuándo), y que cada nota hable solo de su función;
  - una etapa de entendimiento de objetivos, reabrible, en la que la IA dice cuándo cree que entendió y cuándo cree que el trabajo terminó;
  - renombrar "programar" a "sugerir" y crear un modo "programar" en el que la IA ofrezca la solución sin que el usuario delegue a ciegas.
- **Decisiones del usuario:**
  - entendimiento en tres niveles (principal: proyecto); "terminó" = terminó de entender y terminó el trabajo;
  - Claude Code confirma lo que es del humano con **sus botones** (AskUserQuestion) y un hook que registra la respuesta;
  - varias conversaciones; ideas de funcionalidades y mejoras ("qué aprender", opcional y apagado);
  - notas: **resumen arriba + historial**;
  - modo programar **sin que parezca un juego** (rechazó las preguntas de opción múltiple): "tú diriges, la IA escribe" + "como un pull request", siempre en **porciones manejables**;
  - plan de 3 a 5 pasos por idea; más de 5 → auxiliar trabajada **aparte, en su propia nota**;
  - los pasos crecen con **lo ya hecho**, guardado en un repertorio personal tipo git entre proyectos, configurable;
  - proponer **su versión** de una función ya armada, como diff. Todo entra al archivo solo con su clic.
- **Investigación (modo programar):**
  - Anthropic 2026: quien delegaba todo sacó menos de 40% en comprensión; quien pedía código con explicación y preguntaba, 65% o más;
  - Bastani (PNAS 2025): +48% en práctica, −17% en examen sin salvaguardas;
  - Kazemitabaar (IUI'25): Lead-and-Reveal (~1,8x tiempo) y Trace-and-Predict (~2,7x);
  - Buçinca 2021 y Gajos 2022: pensar antes de ver la respuesta;
  - habituación (Vance 2017/18): la gente aprende a hacer clic sin leer.
  - Ninguna técnica tiene aún efecto significativo a largo plazo: por eso se mide (`cai programar estado`).
- **Verificado con un hook real:** en PostToolUse, `tool_response.answers` trae la respuesta del humano (incluido el texto libre); en PreToolUse no hay respuestas.
- **Prueba real** (copia de demo-ts, con IA):
  - entender en 4 turnos: preguntó con opciones, aceptó la corrección "no hay bug", dijo "creo que entendí" y se confirmó;
  - chat con la IA chica: propuso una corrección y ediciones de tareas con sus ids; la corrección sobrevivió al panorama (que además dio 5 ideas y evaluó 7 criterios de terminado);
  - modo programar en TypeScript:
    - plan de 5 pasos con la auxiliar separada;
    - un paso dirigido que avisó "tu paso no dice cómo importar";
    - un PR en 2 porciones, ya probado contra los casos (3/3);
    - el probador rechazó una entrada que no recorría la porción y explicó un resultado distinto;
    - al quedar 🟢, se guardó en el repertorio con su commit.
  - El prompt del chat se ajustó porque la IA pedía permiso en vez de proponer las tareas.
- **Revisión independiente:** encontró 12 problemas, corregidos con tests `[rev10]`. Los principales:
  - **la IA podía aprobar porciones del probador** (las propuestas estaban en `.cai/cache`, que no vigilaba el snapshot). Ahora se vigilan, y lo que solo hace el humano se **rechaza antes de correr**;
  - la forma de la pregunta podía cambiar lo que se registraba ("¿Mantienes…?" con "Sí" retractaba). Ahora: opciones exactas, sin multiSelect, texto completo, sin "sí";
  - el modo programar no funcionaba en Python;
  - las marcas cambiaban código sin `;`;
  - un error con otro mensaje contaba como acierto;
  - se podía insertar una propuesta distinta de la que viste;
  - las posiciones de los mensajes del chat se corrían.
- **Pendiente:**
  - reescribir una función entera ya existente en modo programar (hoy son funciones nuevas o pasos);
  - en JS, una entrada que solo evalúa la condición de un `else if` cuenta como que recorre la porción;
  - cola de revisiones visible en el panel;
  - completar el "?" de un test al decidir.
- Selftest: 193/193.

## v0.10.1: la extensión no arrancaba; iniciar desde VSCode (2026-10-10)
- **Reporte del usuario:** la extensión no iniciaba. También quería empezar de cero en un proyecto, y que la extensión lo guiara ("que si está vacío permita crearlo y las preguntas").
- **Causa:** `notaView` armaba, al cargar el módulo, una tabla a partir de `BOTONES` de `notasView`. Como se importan entre sí, en ese momento `BOTONES` era `undefined`, y la activación entera fallaba. Se arregló armándola al usarla.
- **Para que no se repita:** prueba de humo (`scripts/humo.cjs`), que carga la extensión con un `vscode` simulado y llama a `activate`. Corre en `pnpm package`, en el CI (job `extension`) y en el release. Sin el arreglo, la prueba falla.
- **Iniciar desde VSCode:**
  - si el proyecto no tiene `.cai/config.json`, se ofrece **🚀 Iniciar** (aviso, panel y chat);
  - el recorrido: `cai init` → conocer el código, si hay (`cai conocer --sin-preguntas`) → **🎯 Entender el proyecto** en el chat, con la primera pregunta → al confirmar los objetivos, proponer la estructura (`cai plano`, que ahora recibe los objetivos y las correcciones);
  - **Empezar de cero:** mueve `.cai` a `.cai.viejo-<fecha>` e inicia de nuevo;
  - sin iniciar, nada automático (acompañante, guía, revisión al salir, panel) corre ni gasta IA.
- Mensajes de `cai init` con tuteo (tenían voseo).
- Selftest: 193/193.

## v0.11: seguridad, IAs integradas, modos en dos ejes y construir juntos (2026-10-10)
- **Pedido del usuario:** "investiga el proyecto y propón mejoras". Eligió: **seguridad y datos, mantenibilidad, higiene y docs**; que la IA implemente (código delegado); Files.js a `examples/`. Además reportó dos problemas:
  - las IAs no se integran entre funciones: en `exists` pedía manejar errores en línea en vez de "usa `normalize`" y, en la nota de `normalize`, "mejórala";
  - el modo programar confunde: pedía casos en la barra de arriba (hasta 16 cajas) antes de dar nada; "parece un modo peor que sugerir". ¿Y si pongo casos sin sentido?
- **Decisiones del usuario:**
  - **modos en dos ejes** (idea suya): quién escribe (tú / la IA) × cuánta ayuda (sugerir / aprender);
  - programar = **construir juntos**, porción a porción, **sin un botón "Aceptar" pelado** ("caemos en aceptar y no entender; investiga");
  - **una predicción por función** antes de insertar;
  - casos raros: "revisa lo que dije antes" → la IA avisa, no fuerza y pregunta (lo que ya había decidido: "si hay duda, pregunta", "respeta mis decisiones", "lo importante es determinista").
- **Investigación:** auto-explicación (Bisra et al. 2018, 64 estudios, g = 0,55: el efecto viene de generarla, no de un juez); verificación activa (Qiao et al. 2025: revisar/probar lo generado predijo la comprensión, r = 0,96, N=15); decidir antes de ver (Buçinca 2021: reduce la sobreconfianza pero gusta menos); habituación y reversión de la pericia (no pedir lo mismo siempre).
- **Hecho:**
  - **Seguridad y datos:** la extensión corre la CLI sin shell y `cai.comando` es solo de máquina (un repo clonado podía ejecutar cualquier comando); sin carpetas no confiables; pedidos con tope y cancelables; "Silenciar" apaga también los tests al guardar; sin doble cobro de sugerencias. `almacen.ts`: un JSON dañado ya no se trata como vacío (antes el siguiente guardado pisaba decisiones, tareas o notas). Candados con pid del dueño.
  - **Mantenibilidad:** `cli.ts` mínimo (el hook cargaba el SDK de la IA en cada herramienta: **~210 → ~85 ms**); `args.ts` (código 64 para errores de uso, "¿quisiste decir…?"); `cai selftest <filtro>` y un test de vitest por escenario con mensajes de por qué falló; `prompts.ts`; `compartido.ts` (modos, una sola fuente para CLI y extensión); tuteo en todos los mensajes.
  - **Las funciones se conocen:** mapa del archivo (firma, propósito, ⬜ vacía o prevista) con reserva en el contexto; regla de reutilizar; lo que le toca a otra función va a **su** nota. Prueba real con Files.js: "reutiliza normalize, pero normalize está vacía (⬜)", y en la nota de `normalize`: "Desde `exists`: implementa normalize…" (US$0,05).
  - **Construir juntos:** ver `docs/design.md` (v0.11). Prueba real con `slugNota` (5 porciones, US$0,13): las entradas sugeridas recorrían cada porción; "✎ cámbiala así" conservó las 4 explicadas; los casos según la intención detectaron solos que "el comentario y el plan se contradicen"; la predicción coincidió.
  - **Ajustes tras la prueba real:** una explicación sin sentido ("responde la Constitución…") se incluía con un 🤔 → ahora no se incluye si no coincide (salvo "Incluir igual", que queda como deuda); la IA no veía el comentario encima de la función (su especificación) → ahora sí.
  - **Higiene:** Files.js en `examples/obsidian-files/`; design.md y README al día (vista notas por defecto, 8 atajos, TS por paquete, tuteo); `.dockerignore` sin `.claude-backup`.
- **No hecho (anotado):** dividir `comandos.ts` en archivos por área (hoy es el mismo switch, con parser común y carga perezosa); lo de otra función en **otro archivo** sigue yendo a la nota del archivo; detectar porciones "ya en tu repertorio" para no pedir explicarlas.
- **Recomendación pendiente (no elegida esta vez):** simplificar la superficie (≈55 comandos de VSCode, ≈50 conceptos en CLAUDE.md) y probar con 2–3 personas antes de más funcionalidades, sobre todo pensando en usuarios no técnicos.
- **Para el usuario:** marcar las carpetas delegadas en `.cai/config.json`; correr `cai init --solo-claude` (CLAUDE.md v0.11 y la skill `cai` que faltaba) en la raíz y en `examples/demo-ts`; descartar la tarea de Files.js (`cai tareas descartar t1`).
- Selftest: 207/207 al cerrar la primera parte; 208/208 al final de la sesión.

### v0.11 (misma sesión): notas de una sola función y "construir juntos" con tu orden
- **Pedido del usuario:**
  - que la nota de una función no traiga correcciones de otras ni se repitan; a lo más "ve a mirar la nota de X, aún no está lista";
  - ¿las propuestas de la IA son sin sesgo? (respuesta: arma la función sola desde objetivo, plan y comentario; los casos salen de la intención; se ancla si la función ya tenía código, y el juez de la explicación veía el porqué de la propia IA — ese juez ya no existe con el flujo nuevo);
  - en vez de aceptar una idea, que la IA diga "puedo hacerlo así" y, para que lo haga, que tú le des la orden ("haz…"), filtrando "dale, haz eso que dijiste" o "haz la función y lo demás también".
- **Decisiones del usuario:** de otra función, **solo el aviso** (nada se anota en su nota); **idea primero → tu orden → código**; la orden **con tus palabras** (lo copiado de la propuesta se rechaza).
- **Hecho:**
  - `dependenciasPendientes` → `nota.dependencias` (sin IA, se reemplaza): "⏳ Usa normalize: aún no está lista · Ver su nota". `repartir` descarta lo de otras funciones; lo general del archivo no se repite (`yaDicho`).
  - `construir.ts` rehecho: `ofrecer` (en palabras; si trae expresiones se pide de nuevo), `ideaPaso` (aprender), `ordenar` (filtro `ordenValida` sin IA; la IA escribe solo las líneas del paso, al final de lo hecho; `falta` honesto; `--rehacer`), `deshacer`, ajuste por orden (`repartirAjuste`). Ya no hay "explicar para incluir".
  - Seguridad: `orden`, `idea`, `deshacer`, `predecir`, `caso` son solo del humano; en construir, ningún comando de la IA puede agregar un paso escrito (ni sin orden).
- **Prueba real** (`slugNota`): la oferta en palabras con 2 alternativas; "dale, haz eso que dijiste" y "haz el paso 1 y lo demás también" rechazadas; la copia de la oferta rechazada; "si no me pasan un texto, que tire un TypeError diciendo qué llegó" escribió solo el paso 1 y avisó lo que la orden no decía; el paso 2 salió en una línea. Ajustes tras la prueba: el "si" condicional se tomaba como "sí" (falso positivo), el `\b` no funciona tras una "á", la oferta traía expresiones de código, y "quedó fuera" se llenaba sin que la orden pidiera otros pasos.

### v0.11 (misma sesión): tu código previo, varios pasos a la vez y un verificador chico
- **Pedido del usuario:** que la IA pueda mejorar o cuestionar el código que ya escribió el usuario (no anclarse; si prefiere dejarlo, bien); ir agregando pasos hasta la función completa sin que se sienta línea por línea; una IA más chica que verifique lo que se hace en programar.
- **Decisiones del usuario:** **varios pasos en un formulario** (una orden tuya por paso; en aprender sigue de a uno); el verificador **solo avisa** (Quitarlo / Dejarlo); tu código previo se revisa **al empezar**.
- **Hecho:** `ofrecer` para todos los pasos que faltan + revisión del código previo (`previo`); `ordenarPasos` (de corrido, una llamada); `verificarFiel` (Haiku); `resolverAgregado`, `dejarSugerencia`, `quitarPrevio`; panel con formulario de pasos, sugerencias sobre tu código y avisos del verificador. `quitar` y `dejar` son solo del humano.
- **Prueba real** (`slugNota` con un `return` ya escrito): la revisión del código previo dio 3 preguntas útiles sin anclarse; las ofertas de 5 pasos llegaron en palabras; tres órdenes en un formulario escribieron tres pasos en una llamada. Ajustes tras la prueba: los pasos se agregaban después del `return` previo (nunca se ejecutarían) → control sin IA + 🗑 reemplazar; "Sobre tu idea" aparecía sin idea; el verificador daba falsos positivos (marcaba como agregado lo que la orden pedía con otras palabras, y como falta lo que ya hacía un paso anterior) → ve lo escrito antes y solo cuenta comportamientos nuevos.

### v0.11 (misma sesión): el panel de programar, por páginas
- **Pedido del usuario:** el panel mostraba propuestas, plan y órdenes todo junto (había que subir y bajar); que sea por pasos. Probar escribiendo `nombre(…)` a mano "es raro".
- **Hecho:** "construir juntos" como asistente: chips arriba (Plan · 1 · 2 · 3 · Casos, con ✓ / ⚠ / ○), una página a la vez, la propuesta de cada paso junto a su caja de orden, ◀ / ▶, "✍ Escribir los pasos 2–3" (de corrido hasta donde llegaste), y se abre solo lo recién escrito para revisarlo. Probar y agregar casos con un campo por parámetro (la llamada la arma el panel; texto sin comillas = texto). La prueba de humo revisa además la sintaxis del script del panel y las funciones que arman la llamada.


## Plan v1.0: reestructurar según el Manifiesto (2026-10-10)
- **Pedido del usuario:** reestructurar todo ComplementAIry para que implemente y haga cumplir cada punto de `Manifiesto.md` ("No Vibe Coding"). Que puedas bajar a tocar código o pedirle a la IA, con el máximo determinismo, y que diga qué código no revisó un humano y ayude a construir el modelo mental (en proyectos propios y heredados). Pidió tres planes: uno viendo el proyecto, otro desde cero y uno mezclado, más la comparación. A mitad de la sesión actualizó el manifiesto: agregó I.6 (Regla de Oro del Aprendiz) y la sección II (psicología) y renumeró el resto.
- **Decisiones del usuario:**
  - "tev/jev" = las dos cosas: proveedores de IA intercambiables y baratos (también locales) + marcos de decisión estructurados;
  - exigencia **siempre estricta**;
  - **romper compatibilidad**, con migrador (`cai migrar`);
  - la IA **sigue sugiriendo y ayudando** (también cuando escribes algo mal o se te pasa algo), pero como alguien que sigue el manifiesto.
- **Cómo se hizo:** dos agentes independientes; A leyó el código y B solo el manifiesto. Los dos llegaron al mismo esqueleto: tarea con estados, procedencia por línea, reglas en capas, compuertas deterministas y evidencia generativa. C toma el núcleo probado de A y las ideas nuevas de B (linter de prompts, tester ciego, tarjetas que caducan, MCP propio, señales de habituación), y agrega I.6 y II: licencias por construcción + kata a mano, calibración, guía solo a pedido, bitácora de logros propios e intención aprender/producir.
- **Documentos:** [planes/plan-C-mezclado.md](planes/plan-C-mezclado.md) (incluye la tabla de cada punto: qué te pide, cómo sugiere la IA y cómo se hace cumplir; casos límite; ejemplos de uso; por qué es más rápido sin deteriorarte), [planes/plan-A-con-proyecto.md](planes/plan-A-con-proyecto.md), [planes/plan-B-desde-cero.md](planes/plan-B-desde-cero.md) y [planes/comparacion.md](planes/comparacion.md).
- **Crítica dejada por escrito:** abrir la escritura a la IA va contra la investigación del propio proyecto (delegar baja la comprensión). La sostienen las licencias (I.6) y la evidencia por tramo. Hay una puerta dura tras F5: probar con 2–3 personas antes de seguir.
- **Siguiente paso:** F0 (rama `v1`, selftest partido en vitest por módulo, test de arquitectura).

## v1.0 implementada (2026-10-10/11)
- **Pedido del usuario:** implementar todo el Plan C y dejar la versión nueva completa. A mitad de camino propuso tres cosas, que se adoptaron:
  - lo subjetivo (¿es vago?, ¿es demasiado amplio?) no lo deciden regex sino un **modelo chico de decisión**, que puede frenar el pedido antes de que llegue a la IA que delega;
  - modelos **System One** (Jev de TypeSafe; Ollama `/v1/systemone`), o Haiku si no hay API key;
  - **OpenCode** configurable, junto a Claude Code.
- **Diseño resultante, "doble llave":** reglas fijas solo para lo objetivo, y un decisor que escala por incertidumbre (Jev → Ollama → Haiku → Sonnet). El decisor solo puede subir la exigencia, se puede rebatir y se mide con `cai ia evaluar` (acierto y calibración). Evidencia investigada: los números de Jev son del fabricante; un clasificador especializado le ganó en un benchmark; la práctica recomendada es escalar por incertidumbre y medir la calibración aparte.
- **Hecho:** todo el Plan C. El estado detallado, con los desvíos y lo pendiente, está en `docs/planes/plan-C-mezclado.md` §12. Lo principal:
  - capas impuestas por test;
  - tareas, pedidos y entrevista;
  - procedencia por línea;
  - evidencia polimórfica;
  - licencias y katas;
  - decisiones con matriz, valor esperado y ADR;
  - pull the plug;
  - worktrees y agentes con roles;
  - modelo mental (con traza real);
  - práctica sin IA y expediente;
  - MCP propio;
  - git hooks y CI con SARIF;
  - paneles Tarea y Comprensión;
  - migrador.
- **Prueba real con IA** (copia de demo-ts):
  - el decisor real escaló de Haiku a Sonnet ante un pedido vago;
  - Opus planificó sin código y detectó una contradicción del alcance (el test no cabía);
  - el hook real denegó línea roja, dependencia nueva y `fetch` sin licencia;
  - una explicación falsa fue rechazada;
  - commit con `Cai-IA: 13 líneas (13 revisadas)`;
  - `--no-verify` detectado por `cai ci`.
- **Defectos que destapó la prueba real (corregidos):**
  - el alcance extraído por regex incluía lo excluido ("cuota.ts no se toca") → ahora lo extrae la IA chica, validado literal;
  - "tal cual" daba falso positivo;
  - la IA veía el título recortado;
  - "preservar la firma" protegía el cuerpo;
  - el post-commit anunciaba cierres repetidos;
  - el código de la IA fuera de tareas no tenía cómo recibir evidencia → `cai revisar --archivo`.
- **Segunda tanda (terminar el plan):**
  - **agentes por rol probados con IA real** (tester, implementador, revisor). La prueba destapó que `allowedTools` se salta `canUseTool`: el implementador llegó a editar el test. Ahora cada rol tiene `tools` explícitas y `allowedTools: []`, así que todo pasa por los permisos. Además los agentes reciben el texto de las decisiones vigentes (no solo sus ids) y los archivos que crean quedan atribuidos a la IA;
  - **los supuestos del plan se agrupan en una sola decisión**: muchas decisiones chicas acostumbran a contestar sin leer (habituación);
  - **prueba automática de los paneles** (`scripts/paneles.cjs`, también en el CI): VSCode simulado + la CLI real, sin IA. Destapó que lo que la IA chica extraía de una respuesta («solo src/users.ts, el resto no se toca») metía «el resto» como archivo de contexto. Ahora cada nombre se valida sin IA: aparece literal y es una ruta, un identificador, algo que existe o una función del índice;
  - verificación: 278 pruebas de vitest + 209 escenarios + humo + paneles, en verde.
- **Incidente durante la reestructuración:** un script de movimiento vació los archivos de test nuevos (abría para escribir antes de leer) y reescribió un string de `selftest.ts` que parecía un import. Los tests se reconstruyeron desde la sesión, se verificaron los strings contra git, y la herramienta de refactor se rehízo para leer todo antes de escribir y tocar solo imports reales.
- **Para el usuario:**
  - recorrer los paneles a mano en VSCode (la prueba automática cubre lo que dibujan y sus botones, no cómo se ven);
  - probar Jev cuando tenga acceso a su API;
  - la prueba con 2–3 personas antes de seguir (puerta tras F5);
  - `cai init --solo-claude` en este repo y en sus proyectos;
  - `cai migrar --aplicar` en los proyectos v0.11;
  - conseguir acceso a Jev si quiere el decisor System One en la nube.
- Pruebas: 278 de vitest + 209 escenarios + humo + paneles.
- Commit `95790be` en la rama `v1` (el usuario lo pidió; sin push). Jev con API real, recorrer los paneles a mano y la prueba con personas quedan anotados como tareas del usuario (lo eligió él).
