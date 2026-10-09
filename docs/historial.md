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
