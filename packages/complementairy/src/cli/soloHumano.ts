/**
 * Sin imports a propósito: lo carga el hook de Claude Code en CADA herramienta (tiene que ser liviano).
 */
/** Comandos v1 que solo puede correr el humano (el hook de Bash los rechaza si los intenta la IA). */
export const SOLO_HUMANO_V1: [RegExp, string][] = [
  [/^pedir\b/, "pedir: el pedido es del programador, con sus palabras"],
  [/^tarea\b.*--(responder|diseno|aprobar|ejecutar|descartar|rebatir|alcance|adjuntar|refactorizar|ejecutor|intencion)\b/, "responder la entrevista, diseñar, aprobar, ejecutar, descartar o cambiar el alcance"],
  [/^revisar\b.*--(explicacion|llamada|bordes|mutante|seguridad|captura)\b/, "dar evidencia de comprensión"],
  [/^decidir\b.*--(criterios|puntuar|elegir|nota|ev|porque)\b/, "puntuar o elegir en una decisión"],
  [/^pruebas\b.*--(resolver|escalar)\b/, "resolver un hallazgo o medir tu predicción"],
  [/^(volver|desconectar|paralelo|agente|kata|githook|merge-procedencia|juez|asentar|renombrar)\b/, "desconectar, volver, abrir worktrees, lanzar agentes, katas o hooks de git"],
  [/^repaso\b.*--item\b/, "responder un repaso"],
  [/^reconstruir\b.*--(empezar|terminar)\b/, "la reconstrucción semanal es sin IA"],
  [/^mapa\b.*--(hipotesis|diferencia)\b/, "tu hipótesis y tu diferencia del recorrido"],
  [/^hoy\b.*--(foco|cerrar)\b/, "fijar tu foco del día"],
  [/^git\b.*--ejecutar\b/, "ejecutar comandos git"],
  [/^migrar\b.*--aplicar\b/, "migrar el proyecto"],
  [/^reglas\b.*--compilar\b/, "compilar las reglas a .claude/"],
  [/^yo\b.*--(importar|exportar)\b/, "importar o exportar el expediente"],
  [/^pedido\b.*--(comun|asignar|descartar)\b/, "responder o reasignar un pedido"],
];
