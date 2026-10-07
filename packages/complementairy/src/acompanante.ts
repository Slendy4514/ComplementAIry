import fs from "node:fs";
import picomatch from "picomatch";
import path from "node:path";
import { aplicarExpansion, biblioteca, paraLenguaje, parseLlamada, planExpansion } from "./biblioteca.js";
import { codeOnly, parse } from "./comments.js";
import { makeZoner, dataDir } from "./config.js";
import { contextBlock, projectContext, registrarPatron, CRITERIO } from "./context.js";
import { runGate } from "./gate.js";
import { fileIdentifiers, guardReplies } from "./guard.js";
import { langFor } from "./lang.js";
import { ask, evitada } from "./llm.js";
import { planoProyecto } from "./plano.js";
import { funcionesSinTests, medir, rutaTest, violaciones } from "./metricas.js";
import { loadPerfil, nivelDe, puntaje, registrar } from "./profile.js";
import { insertAboveLine, renderReply, type Reply } from "./render.js";
import { findThreads, nextThreadId, regionesTop, regionOf } from "./threads.js";
import { iaOpts, marcadores, runGuia, TIPOS } from "./tutor.js";
import type { SyntaxNode } from "./parser.js";

/**
 * El acompañante: corre cada vez que guardás. Las decisiones de CUÁNDO intervenir son
 * deterministas (errores que persisten, archivo vacío, sin plano); la IA solo redacta la ayuda.
 */

export interface Accion {
  tipo: "expandido" | "respondido" | "plano-proyecto" | "plano-archivo" | "ayuda" | "resuelto" | "comentario" | "diseno" | "sin-tests";
  detalle: string;
}

interface RegionEstado {
  fallos: number;
  hash: string;
  ayudado: boolean;
}

interface Estado {
  proyectoPlano?: boolean;
  llamadas: number[];
  archivos: Record<
    string,
    {
      planoOfrecido?: boolean;
      regiones: Record<string, RegionEstado>;
      /** Huella de cada parte en el guardado anterior y en la última revisión. */
      vistos?: Record<string, string>;
      revisados?: Record<string, string>;
      ultimaRevision?: number;
      /** Prácticas ya avisadas (no se repiten mientras el problema siga igual). */
      practicas?: Record<string, true>;
      sinTests?: Record<string, true>;
    }
  >;
}

const estadoFile = (root: string) => path.join(dataDir(root), "cache", "acompanante.json");
function loadEstado(root: string): Estado {
  try {
    return JSON.parse(fs.readFileSync(estadoFile(root), "utf8")) as Estado;
  } catch {
    return { llamadas: [], archivos: {} };
  }
}
function saveEstado(root: string, e: Estado): void {
  fs.mkdirSync(path.dirname(estadoFile(root)), { recursive: true });
  fs.writeFileSync(estadoFile(root), JSON.stringify(e, null, 2));
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["respuestas"],
  properties: {
    respuestas: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tipo", "texto", "links"],
        properties: { tipo: { type: "string", enum: [...TIPOS] }, texto: { type: "string" }, links: { type: "array", items: { type: "string" } } },
      },
    },
  },
};

const SYSTEM = `Eres el acompañante de ComplementAIry: observas cómo programa la persona y aportas cuando sirve. NUNCA escribes su código.
- Plano de archivo: qué funciones crear (nombre y responsabilidad en palabras: qué recibe, qué devuelve, qué casos cuida), en qué orden, y qué snippets de la BIBLIOTECA sirven (tipo "snippet", texto = "<nombre> clave=valor — para qué"). Respeta docs/ESTRUCTURA.md si existe.
- Ayuda cuando se traba: empieza explicando qué significa el error y dónde mirar (tipo "pista"); si sirve, la pieza (función/API con link a docs). Tono de compañero, breve, sin condescendencia. Sin código.
- Español neutro con tuteo; 1 a 3 oraciones por respuesta. No cites números de línea.

${CRITERIO}`;

/** Errores de sintaxis (nodos ERROR / faltantes) por línea, sin herramientas externas. */
function syntaxErrors(root: SyntaxNode | null): { line: number; msg: string }[] {
  const out: { line: number; msg: string }[] = [];
  if (!root?.hasError()) return out;
  const walk = (n: SyntaxNode) => {
    if (n.type === "ERROR" || n.isMissing()) out.push({ line: n.startPosition.row + 1, msg: n.isMissing() ? `falta ${n.type}` : "error de sintaxis" });
    else if (n.hasError()) for (const c of n.children) walk(c);
  };
  walk(root);
  return out;
}

const lineOffset = (src: string, line: number) => src.split("\n").slice(0, line - 1).join("\n").length + (line > 1 ? 1 : 0);

export async function acompanar(root: string, rel: string, log: (s: string) => void = () => {}): Promise<{ acciones: Accion[]; costoUsd: number }> {
  const abs = path.join(root, rel);
  const lang = langFor(rel);
  const res = { acciones: [] as Accion[], costoUsd: 0 };
  if (!lang || !fs.existsSync(abs)) return res;
  const z = makeZoner(root);
  if (z.zoneOf(abs) === "protegida") return res;
  const base = z.config.acompanar;
  const porCarpeta = Object.entries(base.porCarpeta ?? {}).find(([g]) => picomatch(g, { dot: true })(rel));
  const cfg = { ...base, nivel: porCarpeta ? porCarpeta[1] : base.nivel };

  // 1. Snippets que activaste con [x] (o tus @snippet: no; esos van con Ctrl+Alt+E).
  {
    const src = fs.readFileSync(abs, "utf8");
    const exps = await planExpansion(root, rel, src, undefined, "texto", true).catch(() => []);
    if (exps.length) {
      fs.writeFileSync(abs, aplicarExpansion(src, exps));
      for (const e of exps) res.acciones.push({ tipo: "expandido", detalle: `${e.snippet.nombre} en la línea ${e.desde}` });
    }
  }

  // 2. Tus preguntas pendientes.
  {
    const src = fs.readFileSync(abs, "utf8");
    if (/@ia\?|@yo:/.test(src)) {
      const parsed = await parse(src, lang);
      if (findThreads(src, parsed.comments).some((t) => t.pending)) {
        const r = await runGuia(root, rel, log);
        res.costoUsd += r.costoUsd;
        if (r.respondidos) res.acciones.push({ tipo: "respondido", detalle: `${r.respondidos} pregunta(s)` });
      }
    }
  }
  if (cfg.nivel === "silencioso") return res;

  const estado = loadEstado(root);
  const ahora = Date.now();
  estado.llamadas = estado.llamadas.filter((t) => ahora - t < 3600_000);
  const puedeLlamar = () => estado.llamadas.length < cfg.maxLlamadasHora;
  const contar = (c: number) => {
    estado.llamadas.push(Date.now());
    res.costoUsd += c;
  };
  const archivo = (estado.archivos[rel] ??= { regiones: {} });

  // 3. Plano del proyecto, una vez, si ya escribiste qué busca y todavía no hay estructura.
  const proyectoMd = path.join(dataDir(root), "proyecto.md");
  const conProyecto = fs.existsSync(proyectoMd) && fs.readFileSync(proyectoMd, "utf8").replace(/<!--[\s\S]*?-->|^#.*$/gm, "").trim().length > 0;
  if (!estado.proyectoPlano && conProyecto && !fs.existsSync(path.join(root, "docs", "ESTRUCTURA.md")) && puedeLlamar()) {
    estado.proyectoPlano = true;
    const r = await planoProyecto(root);
    contar(r.costoUsd);
    res.acciones.push({ tipo: "plano-proyecto", detalle: path.relative(root, r.file) });
  }

  const src = fs.readFileSync(abs, "utf8");
  const parsed = await parse(src, lang);
  const libreria = paraLenguaje(biblioteca(root), lang.id);
  const libTexto = libreria.map((s) => `- ${s.nombre}: ${s.descripcion}${marcadores(s).length ? ` (marcadores: ${marcadores(s).join(", ")})` : ""}`).join("\n");
  const nivelProg = nivelDe(puntaje(loadPerfil(), lang.id));
  const critical = z.isCritical(abs);
  const ctx = contextBlock(projectContext(root, rel));
  const estructura = fs.existsSync(path.join(root, "docs", "ESTRUCTURA.md")) ? fs.readFileSync(path.join(root, "docs", "ESTRUCTURA.md"), "utf8").slice(0, 6000) : "";
  const userIds = fileIdentifiers(parsed.root, src);

  const pedir = async (prompt: string, nivel: number): Promise<Reply[]> => {
    const { data, costUsd } = await ask<{ respuestas: Reply[] }>({ kind: "acompanar", system: SYSTEM, prompt, schema: SCHEMA, cwd: root, ...iaOpts(z.config) });
    contar(costUsd);
    const g = guardReplies(Array.isArray(data?.respuestas) ? data.respuestas : [], nivel, userIds);
    return g.ok.filter((r) => r.tipo !== "snippet" || libreria.some((s) => s.nombre === parseLlamada(r.texto)?.nombre));
  };

  /** Escribe solo si el archivo no cambió mientras la IA pensaba (si cambió, se reintenta al próximo guardado). */
  const escribir = async (line: number, replies: Reply[], prefijo: string): Promise<boolean> => {
    const actual = fs.readFileSync(abs, "utf8");
    if (actual !== src || !replies.length) return false;
    const id = `${nextThreadId(parsed.comments, new Set(), prefijo)}.1`;
    const block = replies.flatMap((r) => renderReply(lang, "", id, r));
    const next = await insertAboveLine(actual, lang, line, block);
    if (!next) return false;
    fs.writeFileSync(abs, next);
    return true;
  };

  /** Como `escribir`, pero ancla por el texto de la línea en el archivo ACTUAL (null = arriba del todo). */
  const escribirSobre = async (textoLinea: string | null, replies: Reply[], prefijo: string): Promise<boolean> => {
    if (!replies.length) return false;
    const actual = fs.readFileSync(abs, "utf8");
    const parsedActual = await parse(actual, lang);
    const ls = actual.split("\n");
    const line = textoLinea === null ? (actual.startsWith("#!") ? 2 : 1) : ls.indexOf(textoLinea) + 1;
    if (line < 1) return false;
    const id = `${nextThreadId(parsedActual.comments, new Set(), prefijo)}.1`;
    const next = await insertAboveLine(actual, lang, line, replies.flatMap((r) => renderReply(lang, "", id, r)));
    if (!next) return false;
    fs.writeFileSync(abs, next);
    return true;
  };

  // 4. Archivo nuevo o casi vacío: plano del archivo (una vez).
  const codigo = codeOnly(src, parsed.comments).split("\n").filter((l) => l.trim()).length;
  const yaTienePlano = /@guia\[[^\]]+\] plano:/.test(src);
  if (codigo <= 2 && !yaTienePlano && !archivo.planoOfrecido && puedeLlamar()) {
    archivo.planoOfrecido = true;
    const hermanos = fs.readdirSync(path.dirname(abs)).filter((f) => f !== path.basename(abs)).slice(0, 30);
    const replies = await pedir(
      [
        `Archivo nuevo: ${rel} (${lang.id})${critical ? " — ZONA CRÍTICA" : ""}. Programador: ${nivelProg}.`,
        "Propón el plano de este archivo (tipo plano) y los snippets útiles de la biblioteca.",
        ctx,
        estructura ? `docs/ESTRUCTURA.md:\n${estructura}` : "",
        `Archivos en la misma carpeta: ${hermanos.join(", ") || "(ninguno)"}`,
        libTexto ? `BIBLIOTECA DE SNIPPETS:\n${libTexto}` : "",
        `Contenido actual:\n${src || "(vacío)"}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      2,
    );
    // Arriba del todo (después de un shebang o comentario inicial de una línea, si hay).
    const first = src.startsWith("#!") ? 2 : 1;
    if (await escribir(first, replies, "c")) res.acciones.push({ tipo: "plano-archivo", detalle: rel });
  }

  // 5. ¿Te estás trabando? Errores que siguen en la misma función después de varios intentos.
  let errores = syntaxErrors(parsed.root);
  const gate = (() => {
    try {
      return runGate(root, [rel], { solo: ["tipos"], timeoutMs: 60_000 });
    } catch {
      return null;
    }
  })();
  if (gate) errores = [...errores, ...gate.diags.filter((d) => d.file === rel).map((d) => ({ line: d.line, msg: d.msg }))];
  const porRegion = new Map<string, { line: number; hash: string; msgs: string[]; text: string }>();
  for (const e of errores) {
    const reg = regionOf(src, parsed, lineOffset(src, e.line));
    const key = reg.start === 0 && reg.end === src.length ? `archivo` : src.slice(reg.start, src.indexOf("\n", reg.start) === -1 ? reg.end : src.indexOf("\n", reg.start)).trim().slice(0, 120);
    const cur = porRegion.get(key) ?? { line: src.slice(0, reg.start).split("\n").length, hash: reg.hash, msgs: [], text: reg.text };
    cur.msgs.push(`${e.msg} (línea ${e.line})`);
    porRegion.set(key, cur);
  }
  // Regiones que ya no tienen errores: resueltas.
  for (const [key, st] of Object.entries(archivo.regiones)) {
    if (porRegion.has(key)) continue;
    if (st.fallos >= 2) {
      registrar(lang.id, st.ayudado ? 0.02 : 0.05, st.ayudado ? "resolvió un error con ayuda" : "resolvió un error por su cuenta tras varios intentos");
      res.acciones.push({ tipo: "resuelto", detalle: key });
    }
    delete archivo.regiones[key];
  }
  const umbral = cfg.nivel === "activo" ? Math.max(1, cfg.intentos - 1) : cfg.intentos;
  for (const [key, r] of porRegion) {
    const st = (archivo.regiones[key] ??= { fallos: 0, hash: "", ayudado: false });
    if (st.hash !== r.hash) {
      st.fallos++; // cambiaste la función y sigue con errores: es un intento
      st.hash = r.hash;
    }
    if (st.fallos >= umbral && !st.ayudado && puedeLlamar()) {
      st.ayudado = true;
      const replies = await pedir(
        [
          `${rel} (${lang.id})${critical ? " — ZONA CRÍTICA: solo una pista, sin piezas" : ""}. Programador: ${nivelProg}.`,
          `Lleva ${st.fallos} intentos con errores en esta parte. Errores actuales:\n- ${r.msgs.join("\n- ")}`,
          ctx,
          `Código de la parte con errores:\n${r.text}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
        critical ? 1 : 2,
      );
      if (await escribir(r.line, replies, "c")) {
        res.acciones.push({ tipo: "ayuda", detalle: `${key.slice(0, 60)} (${st.fallos} intentos)` });
        log(`cai: ofrecí ayuda en ${rel}: ${key.slice(0, 60)}`);
      }
    }
  }
  // 5b. Buenas prácticas medibles (umbrales en .cai/config.json → practicas). Si se superan,
  //     se pide UN plano de diseño (cómo separar la función o el archivo). Una vez por problema.
  const met = medir(src, parsed);
  const vios = violaciones(met, z.config.practicas);
  const avisadas = (archivo.practicas ??= {});
  for (const k of Object.keys(avisadas)) if (!vios.some((v) => v.clave === k)) delete avisadas[k]; // resuelto: si vuelve, se avisa de nuevo
  for (const v of vios.filter((x) => !avisadas[x.clave]).slice(0, 2)) {
    if (!puedeLlamar()) break;
    const lineas = src.split("\n");
    const foco = v.nivel === "funcion" ? (met.funciones.find((f) => v.clave === `funcion:${f.nombre}`) ?? null) : null;
    const codigo = foco ? lineas.slice(foco.linea - 1, foco.linea - 1 + foco.lineas).join("\n") : src.slice(0, 12000);
    const replies = await pedir(
      [
        `${rel} (${lang.id}). Programador: ${nivelProg}.`,
        `Práctica que no se cumple (medida automáticamente): ${v.detalle}.`,
        `Propón un PLANO para mejorar el diseño: ${v.nivel === "archivo" ? "cómo repartir este archivo (qué archivos nuevos, qué funciones va a cada uno y por qué)" : "cómo dividir esta función (qué funciones nuevas, qué recibe y devuelve cada una, en qué orden)"}. Sin código. Si en este caso concreto la práctica no aplica, dilo en una línea y por qué.`,
        ctx,
        estructura ? `docs/ESTRUCTURA.md:\n${estructura}` : "",
        v.nivel === "archivo" ? `Funciones del archivo: ${met.funciones.map((f) => `${f.nombre} (${f.lineas} líneas)`).join(", ")}` : "",
        `Código:\n${codigo}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      2,
    );
    if (await escribirSobre(foco ? lineas[foco.linea - 1]! : null, replies, "c")) {
      avisadas[v.clave] = true;
      res.acciones.push({ tipo: "diseno", detalle: v.detalle });
    }
  }

  // 6. Comentarios mientras avanzás: revisar las partes que TERMINASTE (cambiaron antes, en este
  //    guardado ya no las tocaste y compilan). Solo esas partes viajan a la IA.
  const regiones = regionesTop(src, parsed);
  const vistos = archivo.vistos ?? {};
  const revisados = (archivo.revisados ??= {});
  const primeraVez = !archivo.vistos;
  const terminadas = primeraVez
    ? []
    : regiones.filter((r) => {
        const vista = r.key in vistos; // existía en el guardado anterior
        const quieta = vistos[r.key] === r.hash || cfg.nivel === "activo"; // en este guardado ya no la tocaste
        const cambio = revisados[r.key] !== r.hash; // cambió desde la última revisión
        const sinErrores = !errores.some((e) => e.line >= r.desde && e.line <= r.hasta);
        return vista && quieta && cambio && sinErrores && r.hasta - r.desde >= 2;
      });
  // La primera vez que se ve el archivo, lo existente cuenta como ya revisado (no se comenta lo viejo).
  if (primeraVez) for (const r of regiones) revisados[r.key] = r.hash;
  archivo.vistos = Object.fromEntries(regiones.map((r) => [r.key, r.hash]));
  // Funciones exportadas que terminaste y no tienen tests: aviso sin IA (cómo pedirlos).
  if (z.config.tests.avisarSinTests && terminadas.length) {
    const avisadosT = (archivo.sinTests ??= {});
    const candidatas = met.funciones.filter((f) => f.exportada && !avisadosT[f.nombre] && terminadas.some((r) => f.linea >= r.desde && f.linea <= r.hasta));
    for (const f of funcionesSinTests(z, candidatas.map((x) => x.nombre)).slice(0, 2)) {
      const fn = candidatas.find((x) => x.nombre === f)!;
      const texto = `\`${f}\` todavía no tiene tests. Escribe "@ia? !tests" encima (o ejecuta: cai tests ${rel} ${f}) y te propongo casos en ${rutaTest(rel, z.config.tests.carpeta)}.`;
      if (await escribirSobre(src.split("\n")[fn.linea - 1]!, [{ tipo: "pregunta", texto, links: [] }], "c")) {
        avisadosT[f] = true;
        res.acciones.push({ tipo: "sin-tests", detalle: f });
      }
    }
  }
  const enfriado = !archivo.ultimaRevision || Date.now() - archivo.ultimaRevision > 60_000;
  if (cfg.revisar && terminadas.length && enfriado && puedeLlamar()) {
    const partes = terminadas.slice(0, 3);
    archivo.ultimaRevision = Date.now();
    for (const r of partes) revisados[r.key] = r.hash;
    const { data, costUsd } = await ask<{ hallazgos: { codigo: string; etiqueta: string; bloqueante: boolean; categoria: string; texto: string; links: string[] }[] }>({
      kind: "acompanar:revisar",
      system: REVISION_SYSTEM,
      cwd: root,
      schema: REVISION_SCHEMA,
      ...iaOpts(z.config),
      prompt: [
        `${rel} (${lang.id})${critical ? " — ZONA CRÍTICA" : ""}. Programador: ${nivelProg}.`,
        ctx,
        `Partes que acaba de terminar:\n${partes.map((r) => r.text).join("\n\n")}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    });
    contar(costUsd);
    const actual = fs.readFileSync(abs, "utf8");
    // Se ancla por el texto de cada línea en el archivo actual (otros pasos pudieron agregar comentarios).
    if (data.hallazgos.length) {
      let next = actual;
      const lineas = actual.split("\n");
      const parsedNow = await parse(actual, lang);
      const id = nextThreadId(parsedNow.comments, new Set(), "c");
      let k = 0;
      const items = data.hallazgos
        .slice(0, 2 * partes.length)
        .map((h) => ({ h, line: lineas.findIndex((l) => l.trim() === h.codigo.trim()) + 1 }))
        .filter((x) => x.line > 0)
        .sort((a, b) => b.line - a.line);
      for (const { h, line } of items) {
        const block = renderReply(lang, "", `${id}.${++k}`, { tipo: "revision", texto: `${h.etiqueta}${h.bloqueante ? " (blocking)" : ""}: ${h.texto}`, links: h.links });
        const ins = await insertAboveLine(next, lang, line, block);
        if (ins) next = ins;
        registrarPatron(`acompanante/${h.categoria}`, h.texto);
      }
      if (next !== actual) {
        fs.writeFileSync(abs, next);
        res.acciones.push({ tipo: "comentario", detalle: `${items.length} comentario(s) sobre ${partes.map((p) => p.key.slice(0, 40)).join(", ")}` });
      }
    } else if (!data.hallazgos.length) evitada("acompanar:revisar", "parte terminada sin observaciones");
  } else if (terminadas.length && !enfriado) evitada("acompanar:revisar", "en enfriamiento (menos de 60 s desde la última revisión)");

  saveEstado(root, estado);
  return res;
}

const REVISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["hallazgos"],
  properties: {
    hallazgos: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["codigo", "etiqueta", "bloqueante", "categoria", "texto", "links"],
        properties: {
          codigo: { type: "string", description: "Copia EXACTA de la línea a la que se refiere." },
          etiqueta: { type: "string", enum: ["issue", "suggestion", "question", "nitpick", "praise"] },
          bloqueante: { type: "boolean" },
          categoria: { type: "string", description: "kebab-case estable, p. ej. validacion-entrada, nombres" },
          texto: { type: "string" },
          links: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

const REVISION_SYSTEM = `Eres el compañero de programación de ComplementAIry. La persona acaba de terminar estas partes de su código; coméntalas como lo haría un buen par:
- Corrige lo que esté mal (issue), sugiere mejoras concretas (suggestion) y señala si no se cumplen sus reglas escritas. Como mucho 2 comentarios por parte, solo si aportan.
- Si está bien, devuelve una lista vacía (o un único "praise" si algo está especialmente bien hecho).
- Explica el porqué y da la pista o la pieza (con link a documentación oficial si estás seguro); nunca escribas la corrección en código.
- Español neutro con tuteo, 1 a 2 oraciones por comentario. No cites números de línea; en "codigo" copia la línea exacta.

${CRITERIO}`;
