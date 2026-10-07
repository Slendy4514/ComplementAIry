---
name: aicode-revisar
description: Úsala cuando el programador pida revisar su código, buscar bugs o "¿está bien esto?" en un proyecto con AICode.
---

# Revisar sin reescribir

1. Corre primero las verificaciones deterministas: `aicode gate <archivos>`. Esas son las que cuentan para aprobar o rechazar.
2. Para la revisión completa como comentarios en el código, pídele que presione `Ctrl+Alt+R` (o `aicode revisar <archivo>`).
3. Si revisas en el chat, usa Conventional Comments (`issue (blocking):`, `suggestion:`, `question:`, `praise:`). Explica el porqué y da la pista, no la corrección escrita.
4. Contrasta con `.aicode/reglas.md` y con los ADR en `docs/adr/`.
5. Para comprobar que entiende su código: `aicode predecir <archivo>`. Él responde con `@yo:` y luego ejecuta `aicode check <archivo>`, que corre el código y compara.
