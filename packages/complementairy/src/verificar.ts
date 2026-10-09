import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { syntaxErrors } from "./acompanante.js";
import { parse } from "./comments.js";
import { makeZoner } from "./config.js";
import { contextBlock, CRITERIO, projectContext } from "./context.js";
import { runGate } from "./gate.js";
import { langFor } from "./lang.js";
import { ask } from "./llm.js";
import { medir, type Funcion } from "./metricas.js";
import { cargarNotas, guardarNotas, mensaje, type Nota } from "./notas.js";
import { claveFuncion, consolidar, funcionPorClave, notaPara } from "./notasFuncion.js";
import { conBloqueo } from "./ocupado.js";
import { iaOpts, type Tamano } from "./tutor.js";

/**
 * "¿Quedó lista?": revisa una función con lo que ya escribiste.
 * 1. Sin IA: errores de sintaxis y verificaciones rápidas (tipos, lint, reglas) en esa función.
 *    Si algo falla, el veredicto es "falta" y no se llama a la IA.
 * 2. Con IA: ¿cumple lo que pedía su nota? → lista (la nota se cierra) / casi / falta (con mejoras).
 * No se vuelve a verificar una función que no cambió desde la última vez (huella del código).
 */

export type Estado = "lista" | "casi" | "falta";

export interface Veredicto {
  funcion: string;
  estado: Estado;
  resumen: string;
  sinIa: boolean;
  /** No cambió desde la última verificación: no se volvió a mirar. */
  omitida?: boolean;
  nota?: string;
}

// El orden importa: primero la evidencia (qué hace, citando líneas), después el veredicto.
const schema = (o: { independiente: boolean; explicacion: boolean }) => ({
  type: "object",
  additionalProperties: false,
  required: ["que_hace", "deberia", "estado", "resumen", "mejoras", "que_hacer", ...(o.independiente ? ["otra_mirada"] : []), ...(o.explicacion ? ["explicacion"] : [])],
  properties: {
    que_hace: { type: "string", description: "Qué hace el código, citando las líneas (\"línea 3: …\"). Sin opinar todavía." },
    deberia: { type: "string", description: "Qué debería hacer según lo que pedía su nota y las reglas." },
    estado: { type: "string", enum: ["lista", "casi", "falta"] },
    resumen: { type: "string", description: "Una o dos oraciones: qué hace bien o qué le falta." },
    mejoras: { type: "array", maxItems: 4, items: { type: "string" }, description: "Concretas y cortas, sin código. Vacío si no hay." },
    que_hacer: { type: "string", description: "El próximo paso en una oración (vacío si está lista)." },
    ...(o.independiente ? { otra_mirada: { type: "string", description: "Comparando con el plan hecho SIN ver el código: SOLO diferencias que importen (un caso borde no cubierto, un enfoque claramente mejor) y por qué. \"\" si coinciden." } } : {}),
    ...(o.explicacion
      ? { explicacion: { type: "object", additionalProperties: false, required: ["coincide", "comentario"], properties: { coincide: { type: "boolean" }, comentario: { type: "string", description: "¿Su explicación describe lo que el código hace de verdad? Qué falta o qué está confundido, en una oración." } } } }
      : {}),
  },
});

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["pasos", "casos_borde"],
  properties: { pasos: { type: "array", maxItems: 6, items: { type: "string" } }, casos_borde: { type: "array", maxItems: 6, items: { type: "string" } } },
};

/** Revisión a ciegas: sin comentarios que "aprueban" (`// esto está bien`, `no tocar`), que sesgan al revisor. */
export function sinAprobaciones(codigo: string): string {
  return codigo.split("\n").map(cegar).join("\n");
}

/** Una línea de comentario que "aprueba" queda en blanco (la numeración de líneas no cambia). */
export function cegar(l: string): string {
  const comentario = /^\s*(\/\/|#|--|\/\*|\*\s|\*$)/.test(l);
  if (!comentario) return l;
  // Lo que AVISA de un problema se conserva ("no funciona con lista vacía", "TODO", "FIXME"): eso ayuda al revisor.
  if (/\b(TODO|FIXME|BUG|XXX|HACK)\b/.test(l) || /\b(no|not|nunca|tampoco)\s+(\w+\s+)?(est[aá]|funciona|es|qued[oó])/i.test(l)) return l;
  return /\b(est[aá] bien|funciona|ya (qued[oó]|est[aá])|no tocar|revisad[oa]|aprobad[oa]|correcto|seguro|probado)\b/i.test(l) ? "" : l;
}

const SYSTEM = `Verificas si UNA función del programador quedó lista. Nunca escribes código: describes en palabras.
- "lista": hace lo que su nota pedía, maneja los casos borde razonables y no tiene bugs evidentes. Puede haber mejoras opcionales.
- "casi": funciona en lo principal, pero falta algo concreto (un caso borde, un error mal manejado, una regla del proyecto).
- "falta": no cumple lo pedido o tiene un bug claro.
Habla SOLO de esta función. Sé concreto y breve. Español neutro con tuteo.

${CRITERIO}`;

export const huella = (texto: string) => crypto.createHash("sha1").update(texto.replace(/\s+/g, " ").trim()).digest("hex").slice(0, 12);

const ICONO: Record<Estado, string> = { lista: "🟢", casi: "🟡", falta: "🔴" };

export async function verificar(
  root: string,
  rel: string,
  o: {
    funcion?: string;
    tamano?: Tamano;
    forzar?: boolean;
    log?: (s: string) => void;
    filtro?: (f: Funcion) => boolean;
    /** Como mucho estas llamadas a la IA (el acompañante respeta su límite por hora). */
    maxIa?: number;
    /** No verificar notas creadas desde este momento (recién creadas en el mismo guardado). */
    noAntesDe?: string;
    /** "Otra mirada": la IA arma su plan SIN ver tu código y luego compara (contra el sesgo de lo ya hecho). */
    independiente?: boolean;
    /** Modo aprender: tu explicación de la función con tus palabras (la IA la compara con el código). */
    explicacion?: string;
  } = {},
): Promise<{ veredictos: Veredicto[]; costoUsd: number }> {
  const lang = langFor(rel);
  if (!lang) throw new Error(`tipo de archivo sin soporte: ${rel}`);
  return conBloqueo(root, rel, "verificando", async () => {
    const abs = path.join(root, rel);
    const src = fs.readFileSync(abs, "utf8");
    const lineas = src.split(/\r?\n/);
    const parsed = await parse(src, lang);
    const funciones = medir(src, parsed).funciones;
    const { notas } = consolidar(cargarNotas(root, rel, src), funciones, src);
    const z = makeZoner(root);
    const res = { veredictos: [] as Veredicto[], costoUsd: 0 };

    // Qué funciones: la pedida, o (al guardar) las que tienen nota abierta y cambiaron.
    let objetivo: Funcion[];
    if (o.funcion) {
      const f = funcionPorClave(funciones, o.funcion);
      if (!f) throw new Error(`no encuentro la función "${o.funcion}" en ${rel}`);
      objetivo = [f];
    } else
      objetivo = funciones.filter(
        (f) =>
          notas.some((n) => n.estado === "abierta" && !n.prediccion && n.ancla.funcion === claveFuncion(funciones, f) && (!o.noAntesDe || n.creada < o.noAntesDe)) &&
          (o.filtro?.(f) ?? true),
      );
    let llamadas = 0;

    const errores = syntaxErrors(parsed.root);
    let gate: ReturnType<typeof runGate> | null = null;
    for (const f of objetivo) {
      const codigo = lineas.slice(f.linea - 1, f.linea - 1 + f.lineas).join("\n");
      const h = huella(codigo);
      const clave = claveFuncion(funciones, f);
      // Sin cambios desde la última verificación (aunque su nota ya esté cerrada): el mismo veredicto, sin IA.
      const previa = notas.filter((n) => !n.prediccion && n.ancla.funcion === clave && n.verificacion?.hash === h).sort((a, b) => b.actualizada.localeCompare(a.actualizada))[0];
      // Con tu explicación o "otra mirada" se verifica igual: es un pedido distinto al anterior.
      if (!o.forzar && !o.explicacion?.trim() && !o.independiente && previa?.verificacion) {
        res.veredictos.push({ funcion: clave, estado: previa.verificacion.estado, resumen: previa.verificacion.resumen, sinIa: true, omitida: true, nota: previa.id });
        continue;
      }
      if (o.maxIa !== undefined && llamadas >= o.maxIa) break;
      const nota = notaPara(notas, rel, funciones, src, { linea: f.linea, funcion: clave, tipo: "nota", origen: "verificar" });
      const dentro = (l: number) => l >= f.linea && l < f.linea + f.lineas;

      // 1. Sin IA.
      gate ??= runGate(root, [rel], { solo: ["tipos", "lint", "reglas"] });
      const problemas = [
        ...errores.filter((e) => dentro(e.line)).map((e) => `línea ${e.line}: ${e.msg}`),
        ...gate.diags.filter((d) => d.bloqueante && path.relative(root, path.resolve(root, d.file)) === rel && dentro(d.line)).map((d) => `línea ${d.line} [${d.tool}]: ${d.msg}`),
      ];
      if (problemas.length) {
        const resumen = `Antes de revisarla hay que arreglar ${problemas.length} problema(s) que encontraron las verificaciones.`;
        registrar(nota, "falta", resumen, problemas.slice(0, 5), "Arregla lo que marcan las verificaciones y vuelve a preguntar.", h, true);
        res.veredictos.push({ funcion: clave, estado: "falta", resumen, sinIa: true, nota: nota.id });
        continue;
      }

      // 2. Con IA, a ciegas: solo el código, el objetivo y las reglas (sin la conversación ni comentarios que aprueban).
      o.log?.(`cai: verificando ${f.nombre} en ${rel}`);
      const firma = (lineas[f.linea - 1] ?? "").trim();
      let plan = "";
      if (o.independiente) {
        // "Otra mirada": cómo lo haría la IA SIN ver tu código (para no anclarse en lo que ya hiciste).
        const p = await ask<{ pasos: string[]; casos_borde: string[] }>({
          kind: "verificar:plan-ciego",
          system: `Propones cómo implementar UNA función sin ver su código: pasos en palabras y casos borde a cuidar. Sin código. Español neutro.\n\n${CRITERIO}`,
          schema: PLAN_SCHEMA,
          cwd: root,
          sinHerramientas: true,
          ...iaOpts(z.config, "chico"),
          effort: "low",
          prompt: [`Función: ${firma} (archivo ${rel}, ${lang.id}).`, nota.accion ? `Objetivo: ${nota.accion}` : "", contextBlock(projectContext(root, rel))].filter(Boolean).join("\n\n"),
        });
        res.costoUsd += p.costUsd;
        plan = `Pasos: ${p.data.pasos.join(" / ")}\nCasos borde: ${p.data.casos_borde.join(" / ")}`;
      }
      const conExplicacion = !!o.explicacion?.trim();
      const { data, costUsd, modelo } = await ask<{ estado: Estado; resumen: string; mejoras: string[]; que_hacer: string; otra_mirada?: string; explicacion?: { coincide: boolean; comentario: string } }>({
        kind: "verificar",
        ref: { archivo: rel, funcion: clave },
        system: SYSTEM,
        schema: schema({ independiente: !!plan, explicacion: conExplicacion }),
        cwd: root,
        sinHerramientas: true,
        ...iaOpts(z.config, o.tamano ?? "mediano"),
        prompt: [
          `Archivo: ${rel} (${lang.id}). Función: ${f.nombre}.`,
          contextBlock(projectContext(root, rel)),
          nota.accion ? `Lo que su nota pedía hacer: ${nota.accion}` : "",
          plan ? `Plan hecho SIN ver el código (otra mirada; compáralo con lo que hizo):\n${plan}` : "",
          conExplicacion ? `Cómo explica el programador su función, con sus palabras: "${o.explicacion!.trim().slice(0, 800)}"` : "",
          `Código de ${f.nombre}:\n${sinAprobaciones(codigo).split("\n").map((l, i) => `${f.linea + i}| ${l}`).join("\n")}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      });
      res.costoUsd += costUsd;
      llamadas++;
      registrar(nota, data.estado, data.resumen, data.mejoras, data.que_hacer, h, false, { otra: data.otra_mirada ?? "", modelo, costo: costUsd });
      nota.verificacion!.lineas = codigo.split("\n");
      if (conExplicacion && data.explicacion) nota.explicacion = { texto: o.explicacion!.trim(), coincide: data.explicacion.coincide, comentario: data.explicacion.comentario, fecha: new Date().toISOString() };
      res.veredictos.push({ funcion: clave, estado: data.estado, resumen: data.resumen, sinIa: false, nota: nota.id });
    }
    guardarNotas(root, rel, notas);
    return res;
  });
}

function registrar(n: Nota, estado: Estado, resumen: string, mejoras: string[], queHacer: string, hash: string, sinIa: boolean, extra: { otra?: string; modelo?: string | undefined; costo?: number } = {}): void {
  const titulo = { lista: "Lista", casi: "Casi lista", falta: "Falta" }[estado];
  const lista = mejoras.length ? `\n${mejoras.map((m) => `- ${m}`).join("\n")}` : "";
  const masLista = estado === "lista" && mejoras.length ? "\n\nMejoras opcionales:" : estado !== "lista" && mejoras.length ? "\n\nQué falta:" : "";
  // Una verificación reemplaza a la anterior (si fue lo último del hilo): no se acumulan veredictos.
  const ultimo = n.hilo[n.hilo.length - 1];
  if (ultimo?.quien === "ia" && /^\*\*(🟢|🟡|🔴) /.test(ultimo.texto)) n.hilo.pop();
  const otra = extra.otra?.trim() ? `\n\n🔀 **Otra mirada** (pensada sin ver tu código): ${extra.otra.trim()}` : "";
  n.hilo.push(mensaje("ia", `**${ICONO[estado]} ${titulo}**${sinIa ? " (sin IA)" : ""} · ${resumen}${masLista}${lista}${otra}`, { kind: "verificar", ...(extra.modelo ? { modelo: extra.modelo } : {}), ...(extra.costo !== undefined ? { costo: extra.costo } : {}) }));
  n.verificacion = { estado, resumen, fecha: new Date().toISOString(), hash };
  if (estado === "lista") {
    n.estado = "resuelta"; // se archiva: el panel no se llena
    n.bloqueante = false;
    n.accion = "";
  } else {
    n.estado = "abierta";
    if (queHacer) n.accion = queHacer;
  }
  n.actualizada = new Date().toISOString();
}
