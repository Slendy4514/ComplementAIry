import fs from "node:fs";
import path from "node:path";
import { makeZoner } from "./config.js";
import { contextoComun } from "./contexto.js";
import { langFor } from "./lang.js";
import { ask } from "./llm.js";
import { cargarNotas, guardarNotas, mensaje, type Nota } from "./notas.js";
import { ARCHIVO, claveFuncion, funcionesDe, funcionPorClave, notaPara } from "./notasFuncion.js";
import { conBloqueo } from "./ocupado.js";
import { iaOpts } from "./tutor.js";

/**
 * Entender una función (o un archivo) antes de escribirla: qué debe hacer y cuándo está terminada
 * (criterios). La IA pregunta 1–2 cosas por vez y arma el objetivo; tú lo confirmas. "¿Quedó lista?"
 * lo compara contra esos criterios y, si se cumplen, te propone darla por terminada (tu clic).
 */

const SYSTEM = `Ayudas al programador a ENTENDER qué debe hacer una función (o un archivo) ANTES de escribirla: qué hace, entradas, salida, casos borde, y cuándo está terminada (2-4 criterios comprobables, p. ej. "con meses = 0 lanza un error que dice el valor").
- Pregunta solo lo que no puedes deducir del código, el nombre, la estructura o lo que ya dijo (máximo 2 preguntas por vez, con opciones probables).
- Devuelve siempre el objetivo completo como lo entiendes ahora. Cuando no te queden dudas importantes, creoQueEntendi = true.
- Sin código. Español neutro con tuteo; breve.`;

export async function entenderFuncion(root: string, rel: string, clave: string | undefined, texto: string): Promise<{ objetivo: NonNullable<Nota["objetivo"]>; preguntas: { pregunta: string; opciones: string[] }[]; creoQueEntendi: boolean; costoUsd: number }> {
  const lang = langFor(rel);
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  const funciones = await funcionesDe(src, lang);
  const f = clave ? funcionPorClave(funciones, clave) : undefined;
  if (clave && !f) throw new Error(`no encuentro la función "${clave}" en ${rel}`);
  const k = f ? claveFuncion(funciones, f) : ARCHIVO;
  const nota = cargarNotas(root, rel, src).find((n) => (f ? n.ancla.funcion === k : n.alcance === "archivo") && n.estado === "abierta");
  const codigo = f ? src.split(/\r?\n/).slice(f.linea - 1, f.linea - 1 + f.lineas).join("\n") : src.slice(0, 6000);
  const z = makeZoner(root);
  const { data, costUsd } = await ask<{ objetivo: string; criterios: string[]; preguntas: { pregunta: string; opciones: string[] }[]; creoQueEntendi: boolean }>({
    kind: "entender",
    ref: { archivo: rel, ...(f ? { funcion: f.nombre } : {}) },
    system: SYSTEM,
    cwd: root,
    sinHerramientas: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["objetivo", "criterios", "preguntas", "creoQueEntendi"],
      properties: {
        objetivo: { type: "string", description: "Qué debe hacer, en 1-2 oraciones." },
        criterios: { type: "array", maxItems: 4, items: { type: "string" } },
        preguntas: { type: "array", maxItems: 2, items: { type: "object", additionalProperties: false, required: ["pregunta", "opciones"], properties: { pregunta: { type: "string" }, opciones: { type: "array", maxItems: 4, items: { type: "string" } } } } },
        creoQueEntendi: { type: "boolean" },
      },
    },
    ...iaOpts(z.config, "mediano"),
    prompt: [
      contextoComun(root, rel, { ...(f ? { funcion: k } : {}), corto: !!f }),
      nota?.objetivo ? `Objetivo actual (${nota.objetivo.confirmado ? "confirmado" : "borrador"}): ${nota.objetivo.texto}\nCriterios: ${nota.objetivo.criterios.join("; ")}` : "",
      nota?.hilo.length ? `Lo último de su nota:\n${nota.hilo.slice(-4).map((m) => `${m.quien === "ia" ? "IA" : "PROGRAMADOR"}: ${m.texto.slice(0, 500)}`).join("\n")}` : "",
      `${f ? `Función ${f.nombre}` : `Archivo ${rel}`} (${lang?.id ?? "?"}):\n${codigo}`,
      texto.trim() ? `PROGRAMADOR: ${texto.trim()}` : "PROGRAMADOR: (quiere definir el objetivo; empieza)",
    ]
      .filter(Boolean)
      .join("\n\n"),
  });
  const objetivo = await conBloqueo(root, rel, "entendiendo el objetivo", async () => {
    const src2 = fs.readFileSync(path.join(root, rel), "utf8");
    const fs2 = await funcionesDe(src2, lang);
    const notas = cargarNotas(root, rel, src2);
    const n = notaPara(notas, rel, fs2, src2, { linea: f?.linea ?? 1, ...(f ? { funcion: k } : { alcance: "archivo" as const }), tipo: "nota", origen: "entender" });
    if (texto.trim()) n.hilo.push(mensaje("tu", texto.trim(), { pedido: "objetivo" }));
    // Un objetivo que cambia deja de estar confirmado (lo vuelves a confirmar tú).
    const o: NonNullable<Nota["objetivo"]> = { texto: data.objetivo.trim(), criterios: data.criterios.map((c) => c.trim()).filter(Boolean), preguntas: data.preguntas.map((p) => p.pregunta) };
    n.objetivo = o;
    n.hilo.push(
      mensaje(
        "ia",
        `**🎯 Objetivo${data.creoQueEntendi ? " (creo que ya lo entendí: confírmalo)" : ""}** · ${o.texto}${o.criterios.length ? `\n\nTerminada cuando:\n${o.criterios.map((c) => `- ${c}`).join("\n")}` : ""}${data.preguntas.length ? `\n\n${data.preguntas.map((p) => `❓ ${p.pregunta}${p.opciones.length ? ` (${p.opciones.join(" / ")})` : ""}`).join("\n")}` : ""}`,
        { kind: "entender" },
      ),
    );
    n.actualizada = new Date().toISOString();
    guardarNotas(root, rel, notas);
    return o;
  });
  return { objetivo, preguntas: data.preguntas, creoQueEntendi: data.creoQueEntendi, costoUsd: costUsd };
}

/** Tú: confirmar el objetivo, darla por terminada, o reabrirla. Solo humano. */
export async function marcarObjetivo(root: string, rel: string, clave: string | undefined, accion: "confirmar" | "terminado" | "reabrir"): Promise<NonNullable<Nota["objetivo"]>> {
  return conBloqueo(root, rel, "objetivo", async () => {
    const src = fs.readFileSync(path.join(root, rel), "utf8");
    const funciones = await funcionesDe(src, langFor(rel));
    const f = clave ? funcionPorClave(funciones, clave) : undefined;
    const k = f ? claveFuncion(funciones, f) : undefined;
    const notas = cargarNotas(root, rel, src);
    const n = notas.filter((x) => (k ? x.ancla.funcion === k : x.alcance === "archivo") && x.objetivo).pop();
    if (!n?.objetivo) throw new Error(`${clave ?? rel} todavía no tiene objetivo: defínelo primero (🎯 Objetivo)`);
    const ahora = new Date().toISOString();
    if (accion === "confirmar") n.objetivo.confirmado = ahora;
    else if (accion === "terminado") {
      if (!n.objetivo.confirmado) throw new Error("confirma primero el objetivo: se da por terminada contra criterios que acordaste");
      n.objetivo.terminada = ahora;
      n.estado = "resuelta";
    } else {
      delete n.objetivo.terminada;
      delete n.objetivo.confirmado;
      n.estado = "abierta";
    }
    n.hilo.push(mensaje("tu", { confirmar: "Confirmo el objetivo.", terminado: "La doy por terminada.", reabrir: "La reabro." }[accion], { pedido: "objetivo" }));
    n.actualizada = ahora;
    guardarNotas(root, rel, notas);
    return n.objetivo;
  });
}
