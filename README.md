# AICode

**Tú programas, la IA te acompaña.** Mientras escribes, AICode te deja en comentarios:
- el plano de lo que vas a construir;
- qué funciones o APIs te sirven;
- correcciones y mejoras cuando terminas una parte;
- ayuda cuando ve que te trabas.

La IA **no puede escribir tu código**: lo impiden hooks deterministas. El código rápido entra solo como **snippets que tú activas**.

- [docs/design.md](docs/design.md): cómo funciona, con ejemplos.
- [docs/research.md](docs/research.md): la investigación detrás.
- [docs/historial.md](docs/historial.md): las decisiones y por qué se tomaron.

## Requisitos
- Node 22+ y git.
- **Claude Code con tu sesión iniciada.** AICode usa tu misma sesión, sin API key. Si defines `ANTHROPIC_API_KEY`, pasará a cobrarse por la API.

## Instalar

### Opción A: clonar (para desarrollar AICode o probar lo último)
```bash
git clone https://github.com/<tu-usuario>/AICode.git
cd AICode && sh scripts/instalar.sh
```
Deja el comando `aicode` global (enlazado al repo: cada `pnpm build` se aplica al instante) e instala la extensión de VSCode.

### Opción B: en el devcontainer de otro proyecto (versión publicada)
Crea un release con `git tag v0.2.0 && git push --tags`. El workflow `release` publica `aicode.tgz` y `aicode.vsix`. Después, en el `.devcontainer/Dockerfile` del otro proyecto:
```dockerfile
RUN npm i -g https://github.com/<tu-usuario>/AICode/releases/latest/download/aicode.tgz
```
Para la extensión, agrega a `devcontainer.json` → `"postAttachCommand"`:
```bash
curl -sL -o /tmp/aicode.vsix https://github.com/<tu-usuario>/AICode/releases/latest/download/aicode.vsix && code --install-extension /tmp/aicode.vsix --force
```
> Si el repo es **privado**, esas URLs piden autenticación. En ese caso usa la opción A dentro del contenedor, o descarga los archivos con `gh release download`.

### En cada proyecto
```bash
cd mi-proyecto
git init                                  # si todavía no es repo
aicode init .                             # hooks, configuración, snippets base, tareas de VSCode, skills, CI
aicode doctor --instalar                  # herramientas del lenguaje (tsc, eslint, vitest, stryker / mypy, ruff, pytest...)
aicode perfil set javascript intermedio   # tu nivel por tema
```
Después escribe con tus palabras `.aicode/proyecto.md` (qué buscas) y `.aicode/reglas.md` (cómo escribes). Al guardar el primer archivo, el acompañante propone la arquitectura del proyecto.

## Uso diario

| | VSCode | Terminal |
|---|---|---|
| Preguntar en el código (`// @ia? ...`) | `Ctrl+Alt+G` | `aicode guia <archivo>` |
| Expandir o elegir un snippet | `Ctrl+Alt+E` | `aicode expandir <archivo>` |
| Crear un snippet tuyo | `Ctrl+Alt+S` (con selección) | `aicode snippet nuevo <nombre> --archivo f --lineas a-b` |
| Revisión completa | `Ctrl+Alt+R` | `aicode revisar <archivo>` |
| Acompañante (plano, ayuda, comentarios) | automático al guardar | `aicode watch` |
| Preguntas sueltas, comandos, errores | — | `aicode pregunta "..."`, `aicode explica -- <cmd>`, `aicode corre -- <cmd>` + `aicode error` |
| Consumo de IA | — | `aicode uso` |

## Qué IA usa y cómo ahorra tokens
**Modelo:**
- Usa el que tengas por defecto en Claude Code. Para cambiarlo, edita `.aicode/config.json` → `"ia": { "modelo": "claude-sonnet-5-5" }`.
- Las tareas simples (consolidar revisiones) usan `ia.modeloRapido` (por defecto `claude-haiku-4-5`).

**Cómo ahorra:**
- **Las decisiones no las toma la IA:** cuándo ayudar, si cambió algo o si hay errores lo resuelven contadores, hashes y compiladores. Solo se llama a la IA cuando hay algo que redactar.
- **Solo lo que cambió:**
  - `revisar` no vuelve a enviar un archivo sin cambios.
  - Si cambió una parte, envía esa parte completa y del resto solo las firmas.
  - El acompañante comenta solo la parte que terminaste.
- **Una consulta por pregunta,** con el contexto justo: la región, tus reglas y tu perfil.
- **Caché de prompts:** las instrucciones de sistema son fijas, así que se reaprovechan entre llamadas.
- **Límites:** `acompanar.maxLlamadasHora` (20 por defecto); 60 s de pausa entre comentarios automáticos en un mismo archivo.

`aicode uso` muestra llamadas, tokens, % de caché, costo estimado por comando y cuántas veces **se evitó** llamar a la IA.

Costo de referencia, medido: pregunta o plano US$0,02–0,06; comentario al terminar una función US$0,04; revisión completa US$0,25.

## Desarrollo
```bash
cd packages/aicode && pnpm build && pnpm test && node dist/cli.js selftest
```
En este repo los hooks de AICode están desactivados (`.claude/off-settings.json`), porque aquí se construye la herramienta.
