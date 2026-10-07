---
name: aicode-snippet
description: Úsala cuando el programador repita código o pida automatizar algo repetitivo en un proyecto con AICode. Lo repetitivo se resuelve con snippets propios del programador, no con código generado.
---

# Lo repetitivo con snippets propios

1. Si el programador ya escribió el patrón que repite: que lo seleccione y presione `Ctrl+Alt+S` (o `aicode snippet nuevo <nombre> --archivo <f> --lineas a-b`). Después lo guías para que marque los huecos con `${1:nombre}`.
2. Si aún no sabe escribirlo: guíalo con la escalera (aicode-guia) hasta que lo escriba una vez él mismo, y luego conviértelo en snippet.
3. Redactar tú el snippet solo es posible si `.aicode/config.json` → `snippets.modo` lo permite. El hook lo verifica: en modo `ganado`, solo para lenguajes que su perfil marca como experto.
