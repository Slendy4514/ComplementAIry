# AICode para VSCode

Atajos y resaltado para AICode (ver docs/design.md en el repo). La lógica está en la CLI `aicode`, que tiene que estar instalada.

| Atajo | Qué hace |
|---|---|
| `Ctrl+Alt+G` | responde tus `@ia?` / `@yo:` del archivo abierto con comentarios `@guia` |
| `Ctrl+Alt+R` | revisa el archivo: primero verificaciones deterministas, después revisores enfocados |
| `Ctrl+Alt+E` | expande el snippet de la línea (`// @snippet: fn nombre=x` o una sugerencia de la IA); sin pedido, elegís de tu biblioteca |
| `Ctrl+Alt+S` | crea un snippet propio con el código seleccionado |

Otros comandos (`Ctrl+Shift+P` → "AICode"): predicciones, comprobar predicciones, limpiar comentarios, explicar un comando y ver tu perfil.
