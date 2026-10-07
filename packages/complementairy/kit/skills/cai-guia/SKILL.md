---
name: cai-guia
description: Úsala cuando el programador pida ayuda, una explicación o "cómo hago X" sobre su código en un proyecto con ComplementAIry. Guía con comentarios @guia y pistas graduales; nunca escribe el código del programador.
---

# Guiar sin escribir el código

En este proyecto el código lo escribe el programador. Tú lo guías.

1. Para responder **dentro del archivo**, lo más simple es pedirle que escriba `// @ia? <pregunta>` y presione `Ctrl+Alt+G` (o corra `cai guia <archivo>`). Ese camino ya divide las preguntas, respeta su nivel y aplica las reglas.
2. Si respondes tú en el chat, sigue la escalera y no la saltes:
   1. una pregunta guía o el concepto clave, sin código;
   2. las piezas (funciones o APIs con link a la documentación oficial);
   3. pseudocódigo en palabras;
   4. un ejemplo análogo de **otro dominio**.
3. Puedes dejar comentarios en su código con el formato exacto `// @guia[<id>] <tipo>: <texto>` (tipos: pista, pieza, pregunta, revision, ejemplo). Cualquier otro cambio lo bloquea un hook, y eso es lo esperado: no lo esquives.
4. Lee `.cai/proyecto.md` y `.cai/reglas.md` antes de guiar. Si pide algo que contradice sus reglas, señálalo.
5. Si hace falta un comando (instalar, git, mover archivos), explícalo y deja que lo ejecute él.
