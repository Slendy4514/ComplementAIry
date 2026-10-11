/**
 * `cai mcp`: servidor MCP (stdio, JSON-RPC 2.0) para que la IA interactúe con ComplementAIry con herramientas
 * TIPADAS y validadas sin IA (manifiesto III.4: interacción determinista con sistemas externos):
 *
 *   cai_tarea_estado      estado, plan, restricciones y qué falta de una tarea
 *   cai_proponer_plan     la IA de la sesión propone el plan: se valida el esquema y que no traiga código;
 *                         ambigüedades y supuestos → decisiones pendientes (decide el humano)
 *   cai_presentar_opciones "prohibido adivinar": ≥ 2 opciones con pros y contras → decisión pendiente
 *   cai_reglas            reglas efectivas de un archivo y de qué capa vienen
 *   cai_informe           qué código no revisó un humano, por riesgo
 *   cai_mapa              grafo del proyecto (Mermaid)
 *
 * Nada aquí decide por el humano: proponer sí; aprobar, decidir y dar evidencia, nunca.
 */
import { createInterface } from "node:readline";
import { proponerDecisiones } from "../proyecto/decisiones.js";
import { conExpresiones } from "../flujos/construir.js";
import { CATALOGO } from "../nucleo/construcciones.js";
import { faltantes, transicionar, type Plan } from "../nucleo/flujo.js";
import { reglaEfectiva } from "../proyecto/reglas.js";
import { cargarTarea, conTarea } from "../proyecto/tareas.js";
import { describirTarea, hechosDe, supuestosComoDecision } from "../flujos/tarea.js";
import { sinRevisar } from "../flujos/informe.js";
import { mapaMermaid } from "../flujos/mapa.js";
import { validarContraEsquema } from "../ia/motores.js";

const OPCIONES = { type: "array", minItems: 2, maxItems: 4, items: { type: "object", required: ["opcion", "pros", "contras"], properties: { opcion: { type: "string" }, pros: { type: "string" }, contras: { type: "string" } } } };

const ESQUEMA_PLAN = {
  type: "object",
  required: ["tarea", "flujoDeDatos", "funcionesClave", "integracion", "retos", "supuestos", "ambiguedades", "archivos", "comoProbar", "pasos", "construcciones"],
  properties: {
    tarea: { type: "string" },
    flujoDeDatos: { type: "string" },
    funcionesClave: { type: "array", items: { type: "object", required: ["nombre", "que"], properties: { nombre: { type: "string" }, que: { type: "string" } } } },
    integracion: { type: "array", items: { type: "string" } },
    retos: { type: "array", items: { type: "string" } },
    supuestos: { type: "array", items: { type: "string" } },
    ambiguedades: { type: "array", items: { type: "object", required: ["pregunta", "opciones"], properties: { pregunta: { type: "string" }, opciones: { ...OPCIONES, maxItems: 2 } } } },
    archivos: { type: "array", items: { type: "string" } },
    comoProbar: { type: "array", items: { type: "string" } },
    fuentes: { type: "array", items: { type: "string" } },
    pasos: { type: "array", items: { type: "string" } },
    construcciones: { type: "array", items: { type: "string", enum: Object.keys(CATALOGO) } },
  },
};

const HERRAMIENTAS = [
  { name: "cai_tarea_estado", description: "Estado de una tarea de ComplementAIry: entrevista, diseño, plan, restricciones y qué falta para avanzar.", inputSchema: { type: "object", required: ["tarea"], properties: { tarea: { type: "string", description: "id, p. ej. t3" } } } },
  { name: "cai_proponer_plan", description: "Propón el plan de implementación de una tarea DISEÑADA, sin código (flujo de datos, funciones clave, integración, retos, supuestos, ambigüedades con 2 opciones, archivos, cómo probar, pasos, construcciones). Se valida sin IA; las ambigüedades quedan como decisiones del programador.", inputSchema: ESQUEMA_PLAN },
  { name: "cai_presentar_opciones", description: "Cuando algo es ambiguo, NO adivines: presenta 2 a 4 opciones con pros y contras. Queda como decisión pendiente que decide el programador.", inputSchema: { type: "object", required: ["pregunta", "opciones"], properties: { pregunta: { type: "string" }, opciones: OPCIONES, tarea: { type: "string" } } } },
  { name: "cai_reglas", description: "Reglas que valen para un archivo y de qué capa vienen (protegida, línea roja, carpeta, proyecto, global).", inputSchema: { type: "object", required: ["archivo"], properties: { archivo: { type: "string" } } } },
  { name: "cai_informe", description: "Qué código no revisó un humano, ordenado por riesgo.", inputSchema: { type: "object", properties: {} } },
  { name: "cai_mapa", description: "Grafo del proyecto (Mermaid): módulos, llamadas, % IA y % entendido.", inputSchema: { type: "object", properties: { modulo: { type: "string" } } } },
];

const sinCodigo = (xs: string[]) => !xs.some((x) => /```/.test(x) || conExpresiones(x) || /^\s*(const|let|function|def|return|if)\b/m.test(x));

async function llamar(root: string, nombre: string, a: Record<string, unknown>): Promise<string> {
  switch (nombre) {
    case "cai_tarea_estado": {
      const t = cargarTarea(root, String(a.tarea));
      return [...describirTarea(root, t), "", "Falta:", ...faltantes(t, await hechosDe(root, t)).map((x) => `- ${x}`)].join("\n");
    }
    case "cai_proponer_plan": {
      const errores = validarContraEsquema(a, ESQUEMA_PLAN as Record<string, unknown>);
      if (errores.length) throw new Error(`el plan no cumple el formato: ${errores.slice(0, 4).join("; ")}`);
      const p = a as unknown as Omit<Plan, "creado"> & { tarea: string; construcciones: string[] };
      if (!sinCodigo([p.flujoDeDatos, ...p.pasos, ...p.retos, ...p.funcionesClave.map((f) => f.que)])) throw new Error("el plan trae código o expresiones: todo en palabras (V.2: «No escribas código todavía»)");
      if (p.pasos.length < 2 || p.pasos.length > 8) throw new Error("entre 2 y 8 pasos, cada uno revisable");
      const t = cargarTarea(root, p.tarea);
      if (t.estado !== "diseñada") throw new Error(`la tarea ${t.id} está ${t.estado}: el plan se propone con el diseño listo`);
      const decs = proponerDecisiones(root, [...p.ambiguedades.map((x) => ({ pregunta: x.pregunta, opciones: x.opciones.map((o) => ({ opcion: o.opcion, consecuencia: `pros: ${o.pros} · contras: ${o.contras}` })) })), ...supuestosComoDecision(p.supuestos)], {}, `plan de ${t.id} (MCP)`, t.id);
      const plan: Plan = { flujoDeDatos: p.flujoDeDatos, funcionesClave: p.funcionesClave, integracion: p.integracion, retos: p.retos, supuestos: p.supuestos, ambiguedades: p.ambiguedades.map((x) => ({ ...x, ...(decs.find((d) => d.pregunta === x.pregunta.trim()) ? { decision: decs.find((d) => d.pregunta === x.pregunta.trim())!.id } : {}) })), archivos: p.archivos, comoProbar: p.comoProbar, fuentes: p.fuentes ?? [], pasos: p.pasos, creado: new Date().toISOString(), modelo: "sesión (MCP)" };
      conTarea(root, t.id, (x) => transicionar({ ...x, plan, construcciones: p.construcciones, restricciones: { ...x.restricciones, alcance: x.restricciones.alcance.length ? x.restricciones.alcance : p.archivos } }, "planificada", "plan propuesto por la sesión (MCP)"));
      return `Plan guardado en ${t.id} (planificada). Decisiones pendientes para el programador: ${decs.map((d) => `${d.id} «${d.pregunta}»`).join("; ") || "ninguna"}. Pregúntale con AskUserQuestion (header cai:<id>) y espera su paráfrasis y aprobación.`;
    }
    case "cai_presentar_opciones": {
      const ops = a.opciones as { opcion: string; pros: string; contras: string }[];
      if (!Array.isArray(ops) || ops.length < 2) throw new Error("al menos 2 opciones");
      const [d] = proponerDecisiones(root, [{ pregunta: String(a.pregunta), opciones: ops.map((o) => ({ opcion: o.opcion, consecuencia: `pros: ${o.pros} · contras: ${o.contras}` })) }], {}, "MCP: presentar opciones", a.tarea ? String(a.tarea) : undefined);
      return d ? `Decisión ${d.id} pendiente. Pregúntale al programador con AskUserQuestion: header "cai:${d.id}", la pregunta con su texto y las opciones exactas: ${d.opciones.map((o) => `"${o.opcion}"`).join(", ")}.` : "Ya hay una decisión parecida pendiente o vigente: `cai decisiones`.";
    }
    case "cai_reglas":
      return reglaEfectiva(root, String(a.archivo)).map((r) => `[${r.origen}] ${r.regla}`).join("\n");
    case "cai_informe": {
      const r = sinRevisar(root);
      return [...r.resumen, ...r.filas.slice(0, 20).map((f) => `- ${f.archivo} · ${f.funcion} · ${f.lineas} línea(s) ${f.origen}`)].join("\n");
    }
    case "cai_mapa":
      return mapaMermaid(root, a.modulo ? { modulo: String(a.modulo) } : {});
    default:
      throw new Error(`herramienta desconocida: ${nombre}`);
  }
}

/** Atiende una petición JSON-RPC (exportado para probarlo sin stdio). */
export async function atender(root: string, msg: { id?: number | string; method: string; params?: Record<string, unknown> }): Promise<Record<string, unknown> | null> {
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id, result });
  switch (msg.method) {
    case "initialize":
      return ok({ protocolVersion: (msg.params?.protocolVersion as string) ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "complementairy", version: "1.0.0" } });
    case "notifications/initialized":
      return null;
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: HERRAMIENTAS });
    case "tools/call": {
      const p = msg.params as { name: string; arguments?: Record<string, unknown> };
      try {
        return ok({ content: [{ type: "text", text: await llamar(root, p.name, p.arguments ?? {}) }] });
      } catch (e) {
        return ok({ content: [{ type: "text", text: `[cai] ${e instanceof Error ? e.message : String(e)}` }], isError: true });
      }
    }
    default:
      return msg.id === undefined ? null : { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `método no soportado: ${msg.method}` } };
  }
}

export async function servirMcp(root: string): Promise<number> {
  const rl = createInterface({ input: process.stdin });
  for await (const linea of rl) {
    if (!linea.trim()) continue;
    let msg: { id?: number; method: string; params?: Record<string, unknown> };
    try {
      msg = JSON.parse(linea);
    } catch {
      continue;
    }
    const r = await atender(root, msg);
    if (r) process.stdout.write(JSON.stringify(r) + "\n");
  }
  return 0;
}
