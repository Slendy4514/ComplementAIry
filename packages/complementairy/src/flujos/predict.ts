import { programaAislado, validarExpresionAislada, type Analisis } from "./sandbox.js";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parse } from "../nucleo/comments.js";
import { makeZoner, dataDir } from "../proyecto/config.js";
import { langFor } from "../nucleo/lang.js";
import { ask } from "../ia/llm.js";
import { registrar } from "../proyecto/profile.js";
import { eolOf, renderReply } from "../nucleo/render.js";
import { sonLiterales } from "../nucleo/literales.js";
import { cargarNotas, guardarNotas, mensaje, nuevaNota } from "../proyecto/notas.js";
import { guiaId, nextThreadId } from "../nucleo/threads.js";
import { iaOpts } from "../ia/llm.js";
import { verifyCommentOnly } from "../nucleo/soloComentarios.js";

/**
 * Trace-and-Predict: la IA propone llamadas a TUS funciones y tú predices el resultado.
 * La comparación no la hace la IA: se ejecuta tu código y se compara. Determinista.
 */

export interface Prediccion {
  expresion: string;
  funcion: string;
}

const file = (root: string) => path.join(dataDir(root), "cache", "predicciones.json");
const load = (root: string): Record<string, Prediccion> => {
  try {
    return JSON.parse(fs.readFileSync(file(root), "utf8")) as Record<string, Prediccion>;
  } catch {
    return {};
  }
};
const save = (root: string, d: Record<string, Prediccion>) => {
  fs.mkdirSync(path.dirname(file(root)), { recursive: true });
  fs.writeFileSync(file(root), JSON.stringify(d, null, 2));
};

/**
 * La expresión debe ser una sola llamada a una función exportada del archivo, con argumentos literales
 * (lista blanca: ver `sonLiterales`; una lista negra de palabras se puede esquivar).
 */
export function validarExpresion(expr: string, exported: Set<string>, langId = "typescript"): string | null {
  const m = /^([A-Za-z_$][\w$]*)\((.*)\)$/s.exec(expr.trim());
  if (!m) return "no es una llamada simple a función";
  if (!exported.has(m[1]!)) return `${m[1]} no es una función exportada del archivo`;
  if (!sonLiterales(m[2]!, { conNombre: langId === "python" })) return "los argumentos deben ser valores literales (números, textos, true/false/null, listas u objetos de esos)";
  return null;
}

export function exportedFunctions(langId: string, src: string): Set<string> {
  const out = new Set<string>();
  const re =
    langId === "python"
      ? /^def\s+([A-Za-z_]\w*)\s*\(/gm
      : /export\s+(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)|export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(|function)/g;
  for (const m of src.matchAll(re)) out.add((m[1] ?? m[2])!);
  return out;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["preguntas"],
  properties: {
    preguntas: {
      type: "array",
      maxItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["expresion", "por_que"],
        properties: {
          expresion: { type: "string", description: "Una llamada a una función exportada con argumentos literales, p. ej. calcularCuota(1000, 0, 4)" },
          por_que: { type: "string", description: "Qué concepto pone a prueba esta predicción (una oración)." },
        },
      },
    },
  },
};

const SYSTEM = `Generás preguntas de predicción ("¿qué devuelve...?") para que el programador verifique que entiende SU código.
- Elegí casos que hagan pensar: bordes, ramas distintas, el caso que más fácil se malinterpreta.
- La expresión debe ser UNA llamada a una función exportada del archivo, con argumentos literales (números, strings, booleanos, arrays u objetos literales). Nada más.
- En "por_que" NUNCA reveles el resultado ni des pistas del valor: solo nombrá el concepto que se pone a prueba (p. ej. "qué pasa en la rama de tasa cero").
- Español neutro con tuteo.`;

export async function runPredecir(root: string, rel: string): Promise<{ creadas: number; costoUsd: number; avisos: string[] }> {
  const abs = path.join(root, rel);
  const lang = langFor(rel);
  if (!lang) throw new Error(`tipo de archivo sin soporte: ${rel}`);
  const src = fs.readFileSync(abs, "utf8");
  const exported = exportedFunctions(lang.id, src);
  if (!exported.size) throw new Error("el archivo no exporta funciones para predecir");
  const z = makeZoner(root);
  const { data, costUsd } = await ask<{ preguntas: { expresion: string; por_que: string }[] }>({
    kind: "predecir",
    system: SYSTEM,
    cwd: root,
    schema: SCHEMA,
    ...iaOpts(z.config, "mediano"),
    prompt: `Archivo ${rel} (${lang.id}). Funciones exportadas: ${[...exported].join(", ")}.\n\n${src}`,
  });
  const avisos: string[] = [];
  const parsed = await parse(src, lang);
  const preds = load(root);
  const taken = new Set<string>();
  let out = src;
  let creadas = 0;
  for (const q of data.preguntas) {
    const err = validarExpresion(q.expresion, exported, lang.id);
    if (err) {
      avisos.push(`pregunta descartada (${q.expresion}): ${err}`);
      continue;
    }
    const fn = /^([A-Za-z_$][\w$]*)/.exec(q.expresion.trim())![1]!;
    // Ejecutamos ya: si la explicación contiene el resultado real, la quitamos (no regalar la respuesta).
    const real = ejecutar(root, rel, lang.id, { expresion: q.expresion.trim(), funcion: fn });
    if (real.infra) {
      avisos.push(`pregunta descartada (${q.expresion}): no se pudo ejecutar (${real.error})`);
      continue;
    }
    const delata = (t: string) => {
      const v = real.ok ? String(real.valor) : "";
      return (v.length > 0 && t.includes(v)) || (!real.ok && /\b(error|lanza|throw)/i.test(t)) || /devuelve|da como resultado|=\s*-?\d/i.test(t);
    };
    const porQue = delata(q.por_que) ? "" : ` (${q.por_que.replace(/[.\s]+$/, "")})`;
    if (z.config.vista === "notas") {
      // Vista notas: la pregunta es una nota; respondes en su caja y se comprueba ejecutando el código.
      const ls = src.split(/\r?\n/);
      const d = ls.findIndex((l) => new RegExp(`(function\\s*\\*?\\s*|const\\s+|def\\s+)${fn.replace(/\$/g, "\\$")}\\b`).test(l));
      const notas = cargarNotas(root, rel, src);
      nuevaNota(notas, {
        archivo: rel,
        ancla: { linea: d + 1 || 1, texto: (ls[d] ?? ls[0] ?? "").trim(), funcion: fn },
        tipo: "prediccion",
        titulo: `¿Qué devuelve ${q.expresion.trim()}?`.slice(0, 80),
        accion: "Responde aquí el valor (sin ejecutar el código), o \"error\" si crees que falla",
        origen: "predecir",
        prediccion: { expresion: q.expresion.trim(), funcion: fn },
        hilo: [mensaje("ia", `**🎯 Predicción** · Sin ejecutarlo: ¿qué devuelve \`${q.expresion.trim()}\`?${porQue}\n\nResponde en esta nota con el valor (o "error").`)],
      });
      guardarNotas(root, rel, notas);
      creadas++;
      continue;
    }
    const id = nextThreadId(parsed.comments, taken, "p");
    taken.add(id);
    const nl = eolOf(out);
    const lines = out.split(nl);
    const decl = lines.findIndex((l) => new RegExp(`(function\\s*\\*?\\s*|const\\s+|def\\s+)${fn.replace(/\$/g, "\\$")}\\b`).test(l));
    const at = decl >= 0 ? decl : 0;
    const indent = /^[ \t]*/.exec(lines[at]!)![0];
    const block = renderReply(lang, indent, `${id}.1`, {
      tipo: "pregunta",
      texto: `Sin ejecutarlo: ¿qué devuelve ${q.expresion.trim()}?${porQue} Responde en la línea de abajo con @yo: <valor> (o "error" si crees que falla) y corre cai check.`,
    });
    const next = [...lines.slice(0, at), ...block, ...lines.slice(at)].join(nl);
    if (!(await verifyCommentOnly(out, next, lang)).ok) {
      avisos.push(`no se pudo insertar la pregunta para ${fn}`);
      continue;
    }
    out = next;
    preds[`${rel}#${id}`] = { expresion: q.expresion.trim(), funcion: fn };
    creadas++;
  }
  if (out !== src) fs.writeFileSync(abs, out);
  save(root, preds);
  return { creadas, costoUsd: costUsd, avisos };
}

export interface Ejecucion {
  /** Marcas de la copia de preparación (modo programar) por las que pasó la ejecución. */
  marcas?: number[];
  ok: boolean;
  valor?: unknown;
  error?: string;
  /** Falló la ejecución en sí (import, tsx ausente...), no el código del usuario: no se califica. */
  infra?: boolean;
  /** Se corrió aislado (sin export): qué partes del entorno se reemplazaron por dobles. */
  dobles?: string[];
  aislado?: boolean;
}

/**
 * Ejecuta una expresión contra el archivo. Con `aislado` (código que no exporta o depende de su entorno)
 * el archivo se carga tal cual en un contexto aislado y lo del entorno se reemplaza por dobles.
 */
let permisosNode: boolean | undefined;
/** ¿Este Node tiene el modelo de permisos (`--permission`, Node ≥ 22)? */
function conPermisos(): boolean {
  permisosNode ??= spawnSync("node", ["--permission", "-e", "0"], { encoding: "utf8", timeout: 10_000 }).status === 0;
  return permisosNode;
}

export function ejecutar(root: string, rel: string, langId: string, p: Prediccion, o: { aislado?: Analisis; dobles?: Record<string, unknown>; cobertura?: string } = {}): Ejecucion {
  // Un único punto de control: toda expresión (nueva, en caché o predicción) se valida antes de correr.
  if (!/^[A-Za-z_$][\w$]*$/.test(p.funcion)) return { ok: false, infra: true, error: `nombre de función inválido: ${p.funcion}` };
  const rechazo = o.aislado ? validarExpresionAislada(p.expresion, new Set(o.aislado.declaraciones)) : validarExpresion(p.expresion, new Set([p.funcion]), langId);
  if (rechazo) return { ok: false, infra: true, error: `expresión rechazada (${rechazo}): ${p.expresion.slice(0, 80)}` };
  const tmp = path.join(dataDir(root), "cache", `run-${crypto.randomBytes(4).toString("hex")}`);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  try {
    let cmd: string;
    if (o.aislado) {
      fs.writeFileSync(tmp + ".mjs", programaAislado(path.join(root, rel), o.aislado, p.expresion, o.dobles ?? {}));
      // Con el modelo de permisos de Node (si está): solo puede leer su programa y tu archivo.
      const permisos = conPermisos() ? `--permission --allow-fs-read=${JSON.stringify(tmp + ".mjs")} --allow-fs-read=${JSON.stringify(path.join(root, rel))} ` : "";
      cmd = `node ${permisos}${JSON.stringify(tmp + ".mjs")}`;
    } else if (langId === "python") {
      // Importar como módulo del proyecto (paquete.modulo) para que funcionen los imports relativos.
      const mod = rel.replace(/\.py$/, "").split("/").join(".");
      fs.writeFileSync(
        tmp + ".py",
        `import json, math, sys, importlib\nsys.path.insert(0, ${JSON.stringify(root)})\n` +
          `def _j(v):\n    if isinstance(v, float) and math.isnan(v): return "NaN"\n` +
          `    if isinstance(v, float) and math.isinf(v): return "Infinity" if v > 0 else "-Infinity"\n    return v\n` +
          `try:\n    _m = importlib.import_module(${JSON.stringify(mod)})\n    ${p.funcion} = getattr(_m, ${JSON.stringify(p.funcion)})\n` +
          `except Exception as e:\n    print("@@" + json.dumps({"ok": False, "infra": True, "error": type(e).__name__ + ": " + str(e)}))\n    sys.exit(0)\n` +
          `try:\n    v = _j(${p.expresion})\n    print("@@" + json.dumps({"ok": True, "valor": v, "marcas": sorted(getattr(__import__("builtins"), "_cai_hits", set()))}, default=str, allow_nan=False))\n` +
          `except Exception as e:\n    print("@@" + json.dumps({"ok": False, "error": type(e).__name__ + ": " + str(e), "marcas": sorted(getattr(__import__("builtins"), "_cai_hits", set()))}))\n`,
      );
      cmd = `python3 ${JSON.stringify(tmp + ".py")}`;
    } else {
      const spec = path.relative(path.dirname(tmp), path.join(root, rel)).split(path.sep).join("/");
      fs.writeFileSync(
        tmp + ".mts",
        `let mod;\ntry { mod = await import(${JSON.stringify(spec.startsWith(".") ? spec : "./" + spec)}); }\n` +
          `catch (e) { console.log("@@" + JSON.stringify({ ok: false, infra: true, error: String(e && e.message || e) })); process.exit(0); }\n` +
          `const ${p.funcion} = mod[${JSON.stringify(p.funcion)}];\n` +
          `const _j = (v) => v === undefined ? "undefined" : typeof v === "number" && Number.isNaN(v) ? "NaN" : v === Infinity ? "Infinity" : v === -Infinity ? "-Infinity" : v;\n` +
          `try { const v = await ${p.expresion}; console.log("@@" + JSON.stringify({ ok: true, valor: _j(v), marcas: [...(globalThis.__caiHits ?? [])] })); }\n` +
          `catch (e) { console.log("@@" + JSON.stringify({ ok: false, error: (e && e.name ? e.name + ": " : "") + String(e && e.message || e), marcas: [...(globalThis.__caiHits ?? [])] })); }\n`,
      );
      // tsx si el proyecto lo tiene; si no (p. ej. una kata aislada), Node ≥ 22 quita los tipos solo.
      const tsx = fs.existsSync(path.join(root, "node_modules", ".bin", "tsx"));
      cmd = tsx || Number(process.versions.node.split(".")[0]) < 22 ? `npx --no-install tsx ${JSON.stringify(tmp + ".mts")}` : `node --no-warnings ${JSON.stringify(tmp + ".mts")}`;
    }
    // Sin __pycache__ en tu proyecto (la copia y tu módulo se importan para probarlos).
    const r = spawnSync("sh", ["-c", cmd], { cwd: root, encoding: "utf8", timeout: 30_000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", ...(o.cobertura ? { NODE_V8_COVERAGE: o.cobertura } : {}) } });
    const line = (r.stdout ?? "").split("\n").find((l) => l.startsWith("@@"));
    if (!line) return { ok: false, infra: true, error: `no se pudo ejecutar (${(r.stderr ?? "").trim().split("\n").slice(-1)[0] ?? "sin salida"})` };
    try {
      return { ...(JSON.parse(line.slice(2)) as Ejecucion), ...(o.aislado ? { aislado: true } : {}) };
    } catch {
      return { ok: false, infra: true, error: "salida ilegible" };
    }
  } finally {
    for (const ext of [".mts", ".py", ".mjs"]) fs.rmSync(tmp + ext, { force: true });
  }
}

/** ¿La predicción del humano coincide con lo que devolvió el código? */
export function coincide(prediccion: string, r: Ejecucion): boolean {
  const p = prediccion.trim().replace(/^["'`]|["'`]$/g, "");
  if (!r.ok) return /\b(error|lanza|throws?|excepci[oó]n|falla)\b/i.test(p);
  const v = r.valor;
  if (typeof v === "number" || /^-?(Infinity|NaN)$/.test(String(v))) {
    const n = Number(p.replace(/\s/g, "").replace(/^(-?\d+),(\d+)$/, "$1.$2"));
    if (String(v) === "NaN") return /^nan$/i.test(p);
    if (!Number.isFinite(Number(v))) return p.toLowerCase().replace(/\s/g, "") === String(v).toLowerCase();
    return Number.isFinite(n) && Math.abs(n - Number(v)) <= Math.max(0.005, Math.abs(Number(v)) * 1e-6);
  }
  if (typeof v === "boolean") return (v ? /^(true|verdadero|s[ií])$/i : /^(false|falso|no)$/i).test(p);
  if (typeof v === "string") return p === v;
  try {
    return JSON.stringify(JSON.parse(p)) === JSON.stringify(v);
  } catch {
    return p === JSON.stringify(v);
  }
}

export async function runCheck(root: string, rel: string): Promise<{ correctas: number; incorrectas: number; pendientes: number; avisos: string[] }> {
  const abs = path.join(root, rel);
  const lang = langFor(rel);
  if (!lang) throw new Error(`tipo de archivo sin soporte: ${rel}`);
  let src = fs.readFileSync(abs, "utf8");
  const { comments } = await parse(src, lang);
  const preds = load(root);
  const res = { correctas: 0, incorrectas: 0, pendientes: 0, avisos: [] as string[] };
  const sorted = [...comments].sort((a, b) => a.start - b.start);
  const inserts: { after: number; lines: string[] }[] = [];
  const done = new Set(sorted.map((c) => guiaId(c)).filter((g) => g && g.turn === 2).map((g) => g!.thread));
  for (let i = 0; i < sorted.length; i++) {
    const g = guiaId(sorted[i]!);
    if (!g || !g.thread.startsWith("p") || g.turn !== 1 || done.has(g.thread)) continue;
    done.add(g.thread); // la pregunta ocupa varias líneas con el mismo id: se procesa una vez
    const p = preds[`${rel}#${g.thread}`];
    if (!p) continue;
    // La respuesta: el primer @yo: pegado al bloque de la pregunta.
    let j = i + 1;
    while (j < sorted.length && guiaId(sorted[j]!)?.thread === g.thread) j++;
    const yo = sorted[j];
    if (!yo || yo.kind !== "yo" || src.slice(sorted[j - 1]!.end, yo.start).trim() !== "") {
      res.pendientes++;
      continue;
    }
    const pred = yo.content.replace(/^@yo:\s*/, "");
    const r = ejecutar(root, rel, lang.id, p);
    if (r.infra) {
      res.pendientes++;
      res.avisos.push(`${p.expresion}: no se pudo ejecutar (${r.error}); no se califica`);
      continue;
    }
    const ok = coincide(pred, r);
    const real = r.ok ? JSON.stringify(r.valor) : `error (${r.error})`;
    registrar(lang.id, ok ? 0.06 : -0.08, `predicción ${ok ? "correcta" : "incorrecta"}: ${p.expresion}`);
    ok ? res.correctas++ : res.incorrectas++;
    const texto = ok
      ? `praise: ✓ Correcto, ${p.expresion} devuelve ${real}.`
      : `issue: ✗ El código devuelve ${real} y predijiste ${pred}. ¿Qué parte del código explica la diferencia? (Si el código está mal, este es tu próximo test.)`;
    const indent = /^[ \t]*/.exec(src.slice(src.lastIndexOf("\n", yo.start - 1) + 1))![0];
    inserts.push({ after: yo.end, lines: renderReply(lang, indent, `${g.thread}.2`, { tipo: "revision", texto }) });
  }
  const before = src;
  for (const ins of inserts.sort((a, b) => b.after - a.after)) {
    let eol = src.indexOf("\n", ins.after);
    eol = eol === -1 ? src.length : eol + 1;
    const nl = eolOf(src);
    src = src.slice(0, eol) + (eol === src.length && !src.endsWith("\n") ? nl : "") + ins.lines.join(nl) + nl + src.slice(eol);
  }
  if (src !== before) {
    if (!(await verifyCommentOnly(before, src, lang)).ok) throw new Error("la inserción de resultados no pasó la verificación");
    fs.writeFileSync(abs, src);
  }
  return res;
}
