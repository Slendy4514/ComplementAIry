import fs from "node:fs";
import path from "node:path";
import { biblioteca, paraLenguaje, parseLlamada } from "./biblioteca.js";
import { parse } from "./comments.js";
import { makeZoner, notaOrigen, origenDe } from "./config.js";
import { contextBlock, projectContext } from "./context.js";
import { fileIdentifiers, guardReplies } from "./guard.js";
import { langFor } from "./lang.js";
import { ask } from "./llm.js";
import { medir } from "./metricas.js";
import { cargarNotas, guardarNotas, mensaje, nuevaNota, type Nota } from "./notas.js";
import { conBloqueo } from "./ocupado.js";
import { coincide, ejecutar } from "./predict.js";
import { loadPerfil, nivelDe, puntaje, registrar } from "./profile.js";
import { separarListas, type Reply } from "./render.js";
import { markdown } from "./salida.js";
import { proponerTests } from "./tests.js";
import { iaOpts, marcadores, NIVEL_BASE, PEDIDOS, SYSTEM, TIPOS } from "./tutor.js";

/**
 * Conversación dentro de una nota (o una nota nueva desde una línea o una selección).
 * Lo usan la caja de respuesta del hilo, los botones (Pista, Pseudocódigo, Tests...) y
 * "Preguntar a ComplementAIry" sobre una selección. Nunca toca el archivo de código.
 */

export interface PedidoNota {
  archivo: string;
  notaId?: string;
  /** Para una nota nueva: la línea (1-based). */
  linea?: number;
  seleccion?: string;
  texto?: string;
  /** pista | piezas | pseudo | ejemplo | plano | snippet | arquitectura | tests | explica */
  pedido?: string;
  origen?: string;
  /** Si viene de un @ia? del archivo: su clave y cuántos mensajes humanos lleva. */
  fuente?: string;
  turnos?: number;
  /** La pregunta es sobre el archivo entero (no sobre una función). */
  archivoEntero?: boolean;
}

// Función (y no constante) para evitar el ciclo de imports con tutor.ts al cargar.
const schema = () => ({
  type: "object",
  additionalProperties: false,
  required: ["titulo", "que_hacer", "respuestas", "nivel_usado"],
  properties: {
    titulo: { type: "string", description: "Título de la nota, máximo 60 caracteres." },
    que_hacer: { type: "string", description: "El próximo paso concreto para el programador, en una oración." },
    respuestas: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tipo", "texto", "links", "codigo"],
        properties: {
          tipo: { type: "string", enum: [...TIPOS] },
          texto: { type: "string" },
          links: { type: "array", items: { type: "string" } },
          codigo: { type: "string", description: 'Para "snippet": copia EXACTA de la línea DESPUÉS de la cual iría (dentro de la función). Para el resto: "".' },
        },
      },
    },
    nivel_usado: { type: "integer", minimum: 1, maximum: 4 },
  },
});

const PIDE_MAS = /!mas\b|m[aá]s ayuda|dame m[aá]s|qu[eé] m[aá]s|no entiendo|otra pista|sigo sin|no me sale|m[aá]s detalle/i;

const pedidoDe = (p?: string) => (p ? PEDIDOS.find((x) => x.re.test(`!${p}`)) : undefined);

export async function responderNota(root: string, p: PedidoNota, log: (s: string) => void = () => {}): Promise<{ nota: Nota; costoUsd: number }> {
  const rel = p.archivo;
  const lang = langFor(rel);
  if (!lang) throw new Error(`tipo de archivo sin soporte: ${rel}`);
  return conBloqueo(root, rel, p.pedido ? `respondiendo (${p.pedido})` : "respondiendo", async () => {
    const abs = path.join(root, rel);
    const src = fs.readFileSync(abs, "utf8");
    const lineas = src.split(/\r?\n/);
    const z = makeZoner(root);
    const notas = cargarNotas(root, rel, src);
    const funciones = medir(src, await parse(src, lang)).funciones;
    const funcionEn = (l: number) => funciones.filter((f) => f.linea <= l && l < f.linea + f.lineas).pop();

    // 1. La nota (existente o nueva) y el mensaje del humano.
    let nota = p.notaId ? notas.find((n) => n.id === p.notaId) : undefined;
    if (p.notaId && !nota) throw new Error(`no existe la nota ${p.notaId} en ${rel}`);
    // El pedido puede venir de un botón (p.pedido) o escrito en el texto ("!pseudo", "!tests"...).
    if (!p.pedido && p.texto && /!tests?\b/i.test(p.texto)) p = { ...p, pedido: "tests" };
    const ped = pedidoDe(p.pedido) ?? (p.texto ? PEDIDOS.find((x) => x.re.test(p.texto!)) : undefined);
    if (!nota) {
      const l = p.archivoEntero ? 1 : Math.min(Math.max(1, p.linea ?? 1), lineas.length);
      const fn = p.archivoEntero ? undefined : funcionEn(l);
      nota = nuevaNota(notas, {
        archivo: rel,
        ancla: { linea: l, texto: (lineas[l - 1] ?? "").trim(), ...(fn ? { funcion: fn.nombre } : {}) },
        ...(p.archivoEntero ? { alcance: "archivo" as const } : {}),
        tipo: "pregunta",
        titulo: (p.texto ?? (ped ? `${ped.que[0]!.toUpperCase()}${ped.que.slice(1)}` : "Pregunta")).slice(0, 60),
        origen: p.origen ?? "pregunta",
      });
    }
    const humano = [p.texto?.trim(), ped && !p.texto ? `Pido: ${ped.que}.` : "", p.seleccion ? `Sobre esta parte:\n\`\`\`\n${p.seleccion.slice(0, 2000)}\n\`\`\`` : ""].filter(Boolean).join("\n\n");
    if (humano) nota.hilo.push(mensaje("tu", humano));
    nota.estado = "abierta";
    if (p.fuente) nota.fuente = p.fuente;
    if (p.turnos !== undefined) nota.turnos = p.turnos;
    let costo = 0;

    // 2a. Predicción: se comprueba ejecutando el código (sin IA).
    if (nota.prediccion && p.texto) {
      const r = ejecutar(root, rel, lang.id, nota.prediccion);
      if (r.infra) nota.hilo.push(mensaje("ia", `⚠️ No pude ejecutar \`${nota.prediccion.expresion}\` (${r.error}); no lo califico.`));
      else {
        const ok = coincide(p.texto, r);
        const real = r.ok ? JSON.stringify(r.valor) : `error (${r.error})`;
        registrar(lang.id, ok ? 0.06 : -0.08, `predicción ${ok ? "correcta" : "incorrecta"}: ${nota.prediccion.expresion}`);
        nota.hilo.push(mensaje("ia", ok ? `✅ Correcto: \`${nota.prediccion.expresion}\` devuelve ${real}.` : `❌ El código devuelve ${real} y predijiste ${p.texto}. ¿Qué parte del código explica la diferencia? Si el código está mal, este es tu próximo test.`));
        if (ok) nota.estado = "resuelta";
      }
    }
    // 2b. Tests: casos apagados en la carpeta de tests.
    else if (p.pedido === "tests") {
      const fn = funcionEn(nota.ancla.linea);
      const r = await proponerTests(root, rel, fn?.exportada ? fn.nombre : undefined);
      costo += r.costoUsd;
      nota.hilo.push(
        mensaje(
          "ia",
          r.casos
            ? `**🧪 Tests** · Te propuse ${r.casos} caso(s) en \`${r.archivo}\`${r.preguntas ? `; en ${r.preguntas} te pregunto qué debería pasar` : ""}. Ábrelo, ajusta los valores esperados y activa cada caso.`
            : `No pude proponer casos válidos (${r.descartados.join("; ") || "no hay funciones exportadas"}).`,
        ),
      );
      nota.accion = r.casos ? `Revisa y activa los casos en ${r.archivo}` : nota.accion;
    }
    // 2c. La IA responde en el hilo.
    else {
      const critical = z.isCritical(abs);
      const nivelProg = nivelDe(puntaje(loadPerfil(), lang.id));
      const modo = critical || p.pedido === "aprender" ? "escalera" : "directo";
      const base = modo === "directo" ? 2 : NIVEL_BASE[nivelProg];
      const prev = nota.nivel ?? 0;
      let nivel = ped ? ped.nivel : prev && PIDE_MAS.test(p.texto ?? "") ? Math.min(4, prev + 1) : prev || base;
      if (critical && ped && ped.nivel > Math.max(prev, base) + 1) nivel = Math.max(prev, base) + 1; // en lo crítico, de a un escalón
      const libreria = paraLenguaje(biblioteca(root), lang.id);
      const libTexto = libreria.map((s) => `- ${s.nombre}: ${s.descripcion}${marcadores(s).length ? ` (marcadores: ${marcadores(s).join(", ")})` : ""}`).join("\n");
      const entero = nota.alcance === "archivo";
      const marca = entero ? -1 : nota.ancla.linea - 1;
      const desde = entero || lineas.length <= 400 ? 0 : Math.max(0, marca - 80);
      const hasta = entero ? Math.min(lineas.length, 600) : lineas.length <= 400 ? lineas.length : marca + 80;
      const vista = lineas
        .slice(desde, hasta)
        .map((l, i) => `${String(desde + i + 1).padStart(4)}| ${l}${desde + i === marca ? "   ◀ NOTA" : ""}`)
        .join("\n");
      const prompt = [
        `Archivo: ${rel} (${lang.id})${critical ? " — ZONA CRÍTICA" : ""}. Programador: ${nivelProg} en ${lang.id}.`,
        notaOrigen(origenDe(z.config, rel)),
        modo === "directo" ? "MODO DIRECTO." : `MODO ESCALERA. Nivel MÁXIMO permitido: ${nivel}.`,
        `(nivel interno: ${nivel})`,
        ped ? `El programador pidió explícitamente: ${ped.que}. Responde con eso (tipo "${ped.tipo}").` : "",
        p.pedido === "explica" ? "El programador pidió que le expliques esta parte: qué hace, por qué y qué cuidar. Sin reescribirla." : "",
        entero ? "La pregunta es sobre el ARCHIVO COMPLETO (su organización, qué funciones tiene o le faltan, cómo encaja en el proyecto), no sobre una función puntual." : "",
        contextBlock(projectContext(root, rel)),
        libTexto ? `BIBLIOTECA DE SNIPPETS (${lang.id}):\n${libTexto}` : "",
        "Formato: listas con cada ítem en su propia línea; nada de muros de texto. Si sugieres un snippet, en \"codigo\" copia la línea después de la cual va.",
        "Conversación de la nota:",
        nota.hilo.map((m) => `${m.quien === "ia" ? "TUTOR" : "PROGRAMADOR"}: ${m.texto}`).join("\n"),
        entero ? "Código del archivo:" : "Código (◀ NOTA marca dónde está la nota):",
        vista,
      ]
        .filter(Boolean)
        .join("\n");
      log(`cai: respondiendo en ${rel}:${nota.ancla.linea} (nivel ${nivel})`);
      const ids = fileIdentifiers((await parse(src, lang)).root, src);
      let intento = prompt;
      type Respuesta = { titulo: string; que_hacer: string; respuestas: (Reply & { codigo: string })[]; nivel_usado: number };
      let respuesta: Respuesta | null = null;
      let validas: (Reply & { codigo: string })[] = [];
      for (let k = 0; k < 2; k++) {
        const { data, costUsd } = await ask<Respuesta>({ kind: "responder", system: SYSTEM, prompt: intento, schema: schema(), cwd: root, ...iaOpts(z.config, "mediano") });
        costo += costUsd;
        respuesta = data;
        const g = guardReplies(Array.isArray(data?.respuestas) ? data.respuestas : [], nivel, ids);
        validas = (g.ok as (Reply & { codigo: string })[]).filter((r) => r.tipo !== "snippet" || libreria.some((s) => s.nombre === parseLlamada(r.texto)?.nombre));
        if (validas.length || k === 1) break;
        intento = `${prompt}\n\nTu respuesta anterior no cumplió las reglas: ${g.rejected.map((r) => r.why).join("; ")}. Corrígela.`;
      }
      const snippets = validas
        .filter((r) => r.tipo === "snippet")
        .map((r) => ({ llamada: r.texto.split(/\s+—\s+|\s+--\s+/)[0]!.trim(), despues: (r.codigo ?? "").trim() }));
      const cuerpo = validas
        .filter((r) => r.tipo !== "snippet")
        .map((r) => markdown({ tipo: r.tipo, texto: r.texto, links: r.links ?? [] }))
        .concat(snippets.length ? [markdown({ tipo: "snippet", texto: validas.filter((r) => r.tipo === "snippet").map((r) => separarListas(r.texto)).join("\n"), snippets })] : []);
      nota.hilo.push(mensaje("ia", cuerpo.join("\n\n---\n\n") || "(La respuesta daba más de lo que corresponde a este nivel y se descartó. Contame qué intentaste y seguimos.)"));
      nota.snippets.push(...snippets);
      nota.nivel = Math.max(prev, nivel);
      if (respuesta?.que_hacer) nota.accion = respuesta.que_hacer;
      if (respuesta?.titulo && nota.hilo.filter((m) => m.quien === "ia").length === 1) nota.titulo = respuesta.titulo.slice(0, 60);
    }
    nota.actualizada = new Date().toISOString();
    guardarNotas(root, rel, notas);
    return { nota, costoUsd: costo };
  }, p.linea);
}
