/**
 * La TAREA y su máquina de estados (manifiesto V, pasos 1 a 7). Todo aquí es puro: tipos, la tabla de
 * transiciones y las guardas. Quien llama junta los "hechos" (decisiones pendientes, licencias que faltan,
 * tramos sin evidencia, gate…) y la guarda dice exactamente qué falta. `cai avanzar` lo muestra.
 *
 *   borrador ─(entrevista + diseño humano)→ diseñada ─(plan sin código)→ planificada
 *    ─(decisiones + restricciones + paráfrasis + licencias)→ aprobada ─(ejecutar)→ ejecutando
 *    ─(Stop / humano)→ en-revision ─(evidencia por tramo de IA)→ revisada ─(gate + detectores V.5)→ probada
 *    ─(commit verificado)→ cerrada
 *   ejecutando / en-revision ─(detector de bucle o humano)→ desconectada ─(volver a verde)→ diseñada
 *
 * Una tarea con ejecutor "humano" salta el plan y la ejecución de la IA: la escribes tú, y para cerrarla
 * basta el gate (lo tuyo no necesita evidencia).
 */
import { pedidoEspecifico, respuestaValida, copiado } from "./especificidad.js";

export type Estado = "borrador" | "diseñada" | "planificada" | "aprobada" | "ejecutando" | "en-revision" | "revisada" | "probada" | "cerrada" | "desconectada" | "descartada";
export type TipoTarea = "funcionalidad" | "bug" | "ui" | "refactor" | "express";
export type Intencion = "aprender" | "producir";
export type Ejecutor = "humano" | "pasos" | "agente";

export const ESTADOS: Estado[] = ["borrador", "diseñada", "planificada", "aprobada", "ejecutando", "en-revision", "revisada", "probada", "cerrada", "desconectada", "descartada"];
export const TIPOS: TipoTarea[] = ["funcionalidad", "bug", "ui", "refactor", "express"];

export interface PreguntaEntrevista {
  clave: string;
  pregunta: string;
  /** Sugerencia de la IA (con su porqué): nunca cuenta como respuesta. */
  sugerencia?: string;
  porque?: string;
  /** Tu respuesta, con tus palabras (validada sin IA y, si hay, con la segunda llave). */
  respuesta?: string;
  cuando?: string;
  /** Viene de las restricciones comunes del pedido (se preguntó una vez para todas). */
  comun?: boolean;
  /** Si la segunda llave (IA chica) rechazó tu respuesta y la rebatiste: tu argumento. */
  rebate?: string;
}

export interface Opcion {
  opcion: string;
  pros: string;
  contras: string;
}

export interface Ambiguedad {
  pregunta: string;
  opciones: Opcion[];
  /** Id de la decisión que se abrió para resolverla. */
  decision?: string;
}

export interface Plan {
  flujoDeDatos: string;
  funcionesClave: { nombre: string; que: string }[];
  integracion: string[];
  retos: string[];
  supuestos: string[];
  ambiguedades: Ambiguedad[];
  archivos: string[];
  comoProbar: string[];
  fuentes: string[];
  /** Pasos de implementación, en palabras (para el ejecutor por pasos y para presupuestar). */
  pasos: string[];
  modelo?: string;
  creado: string;
}

export interface Restricciones {
  /** Globs de archivos que la IA puede tocar en esta tarea. */
  alcance: string[];
  sinDependencias: boolean;
  /** Símbolos ("archivo#funcion") cuyo cuerpo no puede cambiar (verificado por huella). */
  preservar: string[];
  /** Tope de líneas que la IA puede escribir en un paso (tramos chicos se revisan mejor). */
  presupuestoLineas: number;
}

export interface Diseno {
  problema: string;
  enfoque: string;
  /** Archivos o símbolos de contexto (IV.2: contexto explícito). */
  contexto: string[];
  /** Criterios verificables: una llamada con su resultado esperado, o un comando. */
  criterios: string[];
}

export interface Dialogo {
  quien: "tu" | "ia";
  fase: string;
  texto: string;
  cuando: string;
}

export interface Transicion {
  de: Estado;
  a: Estado;
  cuando: string;
  motivo?: string;
}

export interface Tarea {
  version: 1;
  id: string;
  titulo: string;
  tipo: TipoTarea;
  intencion: Intencion;
  ejecutor: Ejecutor;
  estado: Estado;
  creada: string;
  actualizada: string;
  /** Pedido del que salió y el fragmento EXACTO del texto original que la originó. */
  pedido?: { id: string; fragmento: string };
  /** Objetivo del proyecto al que apunta. */
  objetivo?: string;
  entrevista: PreguntaEntrevista[];
  diseno?: Diseno;
  plan?: Plan;
  restricciones: Restricciones;
  parafrasis?: string;
  planHash?: string;
  adjuntos: string[];
  dialogo: Dialogo[];
  historial: Transicion[];
  sesion?: string;
  worktree?: string;
  rama?: string;
  checkpoints: string[];
  /** Señales de piloto automático: la revisión de esta tarea exige más (nivel 3). */
  endurecida?: string;
  /** Archivos que la tarea tocó (los registra la procedencia). */
  tocados: string[];
  /** Por qué se descartó (con tus palabras). */
  descarte?: string;
  /** Replanteo escrito al desconectar. */
  replanteo?: string;
  /** Hallazgos de los detectores V.5 / II.2 / VI.1 y cómo los resolviste. */
  hallazgos?: HallazgoTarea[];
  /** Construcciones que el plan dice que usará (para pedir licencias antes de aprobar). */
  construcciones?: string[];
  /** Base de git al empezar a ejecutar (para el diff de la tarea y para volver). */
  base?: string;
  /** Señales del detector de bucle. */
  bucle?: { senales: string[]; puntaje: number; actualizado: string };
}

export interface HallazgoTarea {
  clave: string;
  tipo: string;
  archivo: string;
  linea: number;
  texto: string;
  resuelto?: { como: "test" | "no-aplica" | "prediccion" | "explicacion" | "decision" | "corregido"; nota: string; cuando: string };
}

export const RESTRICCIONES_VACIAS: Restricciones = { alcance: [], sinDependencias: true, preservar: [], presupuestoLineas: 150 };

// --- Entrevista de restricciones (por tipo de tarea) -----------------------------------------------------

/** Las preguntas de la entrevista según el tipo. `comunes` = claves que se preguntan una vez por pedido. */
export function preguntasEntrevista(tipo: TipoTarea): PreguntaEntrevista[] {
  const p = (clave: string, pregunta: string): PreguntaEntrevista => ({ clave, pregunta });
  switch (tipo) {
    case "bug":
      return [
        p("reproducir", "¿Cómo lo reproduces? (pasos, entrada o comando que lo muestra)"),
        p("hipotesis", "Antes de ver la de la IA: ¿cuál es tu hipótesis de la causa?"),
        p("alcance", "¿Qué archivos se pueden tocar para arreglarlo?"),
        p("prueba", "¿Qué test o comprobación demuestra que quedó arreglado?"),
      ];
    case "ui":
      return [
        p("captura", "Adjunta una captura de cómo se ve ahora (o escribe por qué no hace falta)."),
        p("alcance", "¿Qué archivos o componentes se pueden tocar?"),
        p("esperado", "¿Cómo debería verse o comportarse cuando esté listo?"),
      ];
    case "refactor":
      return [
        p("preservar", "¿Qué NO puede cambiar de comportamiento (funciones, API pública)?"),
        p("alcance", "¿Qué archivos se pueden tocar?"),
        p("pruebas", "¿Qué tests deben seguir pasando igual?"),
      ];
    case "express":
      return [p("alcance", "¿En qué archivo va el cambio?"), p("criterio", "¿Cómo sabrás que quedó bien? (una línea)")];
    default:
      return [
        p("alcance", "¿Qué archivos o carpetas se pueden tocar?"),
        p("dependencias", "¿Se pueden agregar dependencias nuevas? ¿Cuáles y por qué?"),
        p("preservar", "¿Qué no debe cambiar (filtros, API, comportamiento existente)?"),
        p("criterio", "¿Cómo sabremos que funciona? (una llamada y su resultado, o un comando)"),
      ];
  }
}

/** Restricciones que se preguntan una sola vez para todas las tareas de un pedido. */
export const CLAVES_COMUNES = ["dependencias"];

// --- Hechos que junta quien llama ---------------------------------------------------------------------

export interface Hechos {
  /** Identificadores conocidos (índice) para validar especificidad. */
  conocidos?: string[];
  decisionesPendientes?: string[];
  licenciasFaltantes?: string[];
  /** Funciones heredadas/ia-previa/pegado del alcance con nivel < 2 (entender antes de modificar). */
  sinEntender?: string[];
  /** Tramos de IA de la tarea sin evidencia suficiente. */
  tramosSinEvidencia?: number;
  /** Diagnósticos del gate que bloquean. */
  gateFallas?: string[];
  /** Hallazgos de los detectores V.5 sin test ni "no aplica porque…". */
  detectoresPendientes?: string[];
  /** Criterios verificables del diseño (llamadas → resultado) o comandos de prueba del plan que FALLAN al ejecutarlos. */
  criteriosFallan?: string[];
  /** Reglas que faltan (III.2 globales, III.3 secciones del proyecto): sin ellas no se aprueba. */
  reglasFaltan?: string[];
  /** Hay cambios hechos en la ejecución (diff). */
  hayCambios?: boolean;
  /** La reconstrucción semanal está atrasada (bloquea pasar a ejecutando con IA). */
  reconstruccionAtrasada?: boolean;
  /** Otra tarea ejecutando que comparte alcance (pide decidir orden o worktree). */
  choques?: string[];
  /** Tareas en revisión (límite WIP). */
  enRevision?: number;
  /** El commit de la tarea ya existe y pasó el pre-commit. */
  commitado?: boolean;
  /** Si es una tarea de UI: hay captura adjunta o una razón escrita. */
  capturaOk?: boolean;
  /** Dominio novato en modo producir (II.1): solo zonas delegadas / snippets. */
  novatoEn?: string[];
}

export const LIMITE_WIP = 2;

const SIGUIENTE: Partial<Record<Estado, Estado>> = {
  borrador: "diseñada",
  diseñada: "planificada",
  planificada: "aprobada",
  aprobada: "ejecutando",
  ejecutando: "en-revision",
  "en-revision": "revisada",
  revisada: "probada",
  probada: "cerrada",
};

/** El estado al que se avanza (el humano salta plan y ejecución: diseñada → probada por el gate). */
export function siguienteEstado(t: Tarea): Estado | null {
  if (t.ejecutor === "humano") {
    if (t.estado === "borrador") return "diseñada";
    if (t.estado === "diseñada" || t.estado === "ejecutando") return "probada";
    if (t.estado === "probada") return "cerrada";
    return null;
  }
  return SIGUIENTE[t.estado] ?? null;
}

const UI = /\.(tsx|jsx|vue|svelte|css|scss|sass|less|html)$/i;
export const esUi = (t: Tarea) => t.tipo === "ui" || [...(t.restricciones.alcance ?? []), ...(t.plan?.archivos ?? [])].some((a) => UI.test(a));

/** ¿Un criterio es verificable? Una llamada con su resultado (`f(x) → y`, `=`) o un comando. */
export function criterioVerificable(c: string): boolean {
  const t = c.trim();
  return /\(.*\)\s*(→|->|=>|==|===|devuelve|da|retorna|returns?)\s*\S/.test(t) || /^\s*(\$\s*)?(pnpm|npm|npx|yarn|node|python|pytest|curl|cai|make|go|cargo)\s+\S/.test(t) || /\b(GET|POST|PUT|PATCH|DELETE)\s+\/\S+.*(→|->|devuelve|responde)/.test(t);
}

/**
 * Qué falta para pasar al siguiente estado. Lista vacía = se puede avanzar. Cada motivo dice exactamente
 * qué hacer (sin "Aceptar": siempre algo tuyo verificable).
 */
export function faltantes(t: Tarea, h: Hechos = {}): string[] {
  const f: string[] = [];
  const destino = siguienteEstado(t);
  if (!destino) return t.estado === "desconectada" ? ["la tarea está desconectada: `cai volver " + t.id + "` y escribe tu replanteo (o sigue a mano con --manual)"] : [`la tarea está ${t.estado}: no hay siguiente paso`];
  switch (t.estado) {
    case "borrador": {
      for (const p of t.entrevista) {
        if (!p.respuesta) f.push(`entrevista: falta tu respuesta a «${p.pregunta}»`);
        else {
          const malo = respuestaValida(p.respuesta, p.sugerencia);
          if (malo) f.push(`entrevista «${p.clave}»: ${malo}`);
        }
      }
      const d = t.diseno;
      if (!d) {
        f.push("falta tu diseño: problema, enfoque con tus palabras, contexto (archivos o funciones) y un criterio verificable (`cai tarea diseno " + t.id + "`)");
        break;
      }
      if (!d.problema.trim()) f.push("diseño: falta el problema (qué pasa hoy y por qué importa)");
      const esp = pedidoEspecifico(`${d.enfoque} ${d.contexto.join(" ")}`, h.conocidos ?? []);
      if (esp) f.push(`diseño (enfoque): ${esp}`);
      if (!d.contexto.length) f.push("diseño: declara el contexto (archivos o funciones que hay que mirar) — IV.2");
      if (!d.criterios.some(criterioVerificable)) f.push("diseño: el criterio debe ser verificable, por ejemplo «GET /api/users/7 → editable:false» o «calcular(2) → 4» o un comando («pnpm test users»)");
      if (t.tipo === "ui" && !h.capturaOk) f.push("tarea de interfaz: adjunta una captura (`cai tarea adjuntar " + t.id + " <imagen>`) o escribe por qué no hace falta (IV.4)");
      break;
    }
    case "diseñada":
      if (!t.plan) f.push("falta el plan (sin código): `cai tarea planificar " + t.id + "` (lo hace el modelo de razonamiento) o escríbelo tú");
      break;
    case "planificada": {
      if (h.decisionesPendientes?.length) f.push(`decide primero: ${h.decisionesPendientes.join(", ")} (\`cai decidir <id>\`) — IV.3: prohibido adivinar`);
      if (h.reglasFaltan?.length) f.push(`reglas que faltan (la IA trabaja con ellas): ${h.reglasFaltan.join("; ")} — \`cai doctor\``);
      if (!t.restricciones.alcance.length) f.push("restricciones: fija el alcance (qué archivos puede tocar la IA)");
      if (!t.parafrasis) f.push("escribe con tus palabras qué va a hacer el plan (paráfrasis; menciona al menos 2 pasos)");
      else if (t.plan && (t.plan.pasos.some((p) => copiado(t.parafrasis!, p) >= 0.5) || copiado(t.parafrasis, t.plan.flujoDeDatos) >= 0.5)) f.push("la paráfrasis está copiada del plan: dila con tus palabras");
      if (h.licenciasFaltantes?.length) f.push(`licencias que faltan (I.6: la IA solo escribe lo que ya escribiste tú a mano): ${h.licenciasFaltantes.join(", ")}. Haz la kata: \`cai kata ${h.licenciasFaltantes[0]}\``);
      if (h.sinEntender?.length) f.push(`entender antes de modificar: ${h.sinEntender.slice(0, 5).join(", ")} no tiene evidencia de que lo entiendes (\`cai mapa --recorrido\` o \`cai revisar\`)`);
      if (h.novatoEn?.length && t.intencion === "producir" && t.ejecutor !== "humano") f.push(`en ${h.novatoEn.join(", ")} todavía eres novato (II.1): esta tarea va en modo aprender (escribes tú) o se limita a zonas delegadas y snippets`);
      if (esUi(t) && !h.capturaOk) f.push("toca interfaz: falta una captura o una razón escrita (IV.4)");
      break;
    }
    case "aprobada":
      if (h.reconstruccionAtrasada) f.push("la reconstrucción semanal está atrasada (VI.3): `cai reconstruir`. Mientras tanto puedes seguir a mano");
      if (h.choques?.length) f.push(`comparte archivos con ${h.choques.join(", ")}: decide el orden o usa un worktree (\`cai tarea ejecutar ${t.id} --aislada\`)`);
      break;
    case "ejecutando":
      if (!h.hayCambios) f.push("todavía no hay cambios de la ejecución");
      if ((h.enRevision ?? 0) >= LIMITE_WIP) f.push(`ya hay ${h.enRevision} tareas en revisión (límite ${LIMITE_WIP}): revisa esas primero para no aprobar en serie`);
      if (t.ejecutor === "humano" && h.gateFallas?.length) f.push(...h.gateFallas.map((g) => `gate: ${g}`));
      break;
    case "en-revision":
      if (h.tramosSinEvidencia) f.push(`${h.tramosSinEvidencia} tramo(s) de la IA sin tu evidencia: \`cai revisar --tarea ${t.id}\``);
      break;
    case "revisada":
      if (h.gateFallas?.length) f.push(...h.gateFallas.map((g) => `gate: ${g}`));
      if (h.detectoresPendientes?.length) f.push(...h.detectoresPendientes.map((d) => `V.5: ${d} → escribe un test o «no aplica porque…» (\`cai pruebas ${t.id}\`)`));
      if (h.criteriosFallan?.length) f.push(...h.criteriosFallan.map((c) => `tu criterio no se cumple: ${c}`));
      break;
    case "probada":
      if (!h.commitado) f.push("haz el commit (el pre-commit verifica la procedencia y agrega los trailers)");
      break;
  }
  return f;
}

/** Transición validada: devuelve la tarea con el nuevo estado y el historial (sin efectos). */
export function transicionar(t: Tarea, a: Estado, motivo?: string, ahora = new Date().toISOString()): Tarea {
  const permitidas: Record<Estado, Estado[]> = {
    borrador: ["diseñada", "descartada"],
    diseñada: ["planificada", "probada", "ejecutando", "borrador", "descartada"],
    planificada: ["aprobada", "diseñada", "descartada"],
    aprobada: ["ejecutando", "planificada", "descartada"],
    ejecutando: ["en-revision", "desconectada", "probada", "descartada"],
    "en-revision": ["revisada", "ejecutando", "desconectada", "descartada"],
    revisada: ["probada", "ejecutando", "descartada"],
    probada: ["cerrada", "ejecutando", "revisada"],
    cerrada: [],
    desconectada: ["diseñada", "ejecutando", "descartada"],
    descartada: [],
  };
  if (!permitidas[t.estado].includes(a)) throw new Error(`la tarea ${t.id} está ${t.estado}: no puede pasar a ${a}`);
  return { ...t, estado: a, actualizada: ahora, historial: [...t.historial, { de: t.estado, a, cuando: ahora, ...(motivo ? { motivo } : {}) }] };
}

/** ¿La IA puede escribir en este estado? Solo ejecutando (y nunca si la tarea es de ejecutor humano). */
export const iaPuedeEscribir = (t: Tarea) => t.estado === "ejecutando" && t.ejecutor !== "humano";

/** Qué hacer ahora con una tarea (una línea). */
export function sugerencia(t: Tarea): string {
  switch (t.estado) {
    case "borrador":
      return `responde la entrevista (\`cai tarea ${t.id} --responder <clave> "…"\`; sugerencias: \`--sugerir\`) y escribe tu diseño (\`cai tarea ${t.id} --diseno\`)`;
    case "diseñada":
      return t.ejecutor === "humano" ? `escríbela tú y luego \`cai avanzar ${t.id}\`` : `pide el plan sin código: \`cai tarea ${t.id} --planificar\``;
    case "planificada":
      return `decide lo pendiente y aprueba con tu paráfrasis: \`cai tarea ${t.id} --aprobar "…"\``;
    case "aprobada":
      return `empieza: \`cai tarea ${t.id} --ejecutar\` (y pídele a Claude Code que implemente ${t.id})`;
    case "ejecutando":
      return t.ejecutor === "humano" ? `cuando termines: \`cai avanzar ${t.id}\`` : `la IA implementa dentro del alcance; al terminar: \`cai avanzar ${t.id}\``;
    case "en-revision":
      return `revisa cada tramo con evidencia: \`cai revisar --tarea ${t.id}\``;
    case "revisada":
      return `gate y detectores V.5: \`cai avanzar ${t.id}\` (\`cai pruebas ${t.id}\` lista los hallazgos)`;
    case "probada":
      return "haz el commit: el pre-commit verifica la procedencia y la cierra";
    case "desconectada":
      return `\`cai volver ${t.id}\` y escribe tu replanteo, o sigue a mano`;
    default:
      return "nada pendiente";
  }
}
