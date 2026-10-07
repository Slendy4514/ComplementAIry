---
name: cai-revisar
description: Úsala cuando el programador pida revisar su código, buscar bugs o "¿está bien esto?" en un proyecto con ComplementAIry.
---

# Revisar sin reescribir

1. Corre primero las verificaciones deterministas: `cai gate <archivos>`. Esas son las que cuentan para aprobar o rechazar.
2. Para la revisión completa como comentarios en el código, corre tú `cai revisar <archivo>` y resume en el chat lo más importante.
3. Si revisas en el chat, usa Conventional Comments (`issue (blocking):`, `suggestion:`, `question:`, `praise:`). Explica el porqué y da la pista, no la corrección escrita.
4. Contrasta con `.cai/reglas.md` y con los ADR en `docs/adr/`.
5. Para comprobar que entiende su código: corre `cai predecir <archivo>`. Él responde con `@yo:` y luego `cai check <archivo>` (puedes correrlo tú) ejecuta el código y compara.
