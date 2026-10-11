import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import picomatch from "picomatch";
import { adapterFor, type Adapter, type Tool } from "./adapters.js";
import { makeZoner, dataDir } from "../proyecto/config.js";

/**
 * Verificación determinista: tipos, lint, tests, arquitectura, mutation testing y las
 * reglas mecánicas del proyecto (.cai/reglas.json). Ninguna IA decide si algo pasa.
 */

export interface Diag {
  file: string;
  line: number;
  msg: string;
  tool: string;
  code?: string;
  bloqueante: boolean;
}

export interface Corrida {
  tool: string;
  estado: "ok" | "con hallazgos" | "no instalada" | "omitida" | "error";
  detalle?: string;
}

export interface GateResult {
  diags: Diag[];
  corridas: Corrida[];
}

export interface GateOptions {
  /** Herramientas a correr (por defecto todas menos mutación si no hay archivos críticos). */
  solo?: string[];
  /** Forzar mutation testing aunque los archivos no sean críticos. */
  mutacion?: boolean;
  timeoutMs?: number;
}

const shq = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

/** Solo "no instalada" si el ejecutable no existe: código 127 o el aviso de npx. Nunca por el texto de un test. */
function notInstalled(code: number | null, out: string, stderr: string): boolean {
  if (code === 127) return true;
  const head = stderr.split("\n").slice(0, 5).join("\n");
  return /could not determine executable to run|npx canceled due to missing packages|^sh: \d+: [\w.-]+: not found$/m.test(head);
}

function run(root: string, cmd: string, timeoutMs: number): { code: number | null; out: string; stdout: string; stderr: string } {
  const r = spawnSync("sh", ["-c", cmd], { cwd: root, encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 << 20, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" } });
  return { code: r.status, out: `${r.stdout ?? ""}\n${r.stderr ?? ""}`, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function eslintDiags(root: string, stdout: string, files: Set<string>): Diag[] | null {
  try {
    const data = JSON.parse(stdout) as { filePath: string; messages: { line?: number; message: string; ruleId: string | null; severity: number }[] }[];
    return data.flatMap((f) =>
      f.messages
        .map((m) => ({ file: relOf(root, f.filePath), line: m.line ?? 1, msg: m.message, tool: "typescript:lint", ...(m.ruleId ? { code: m.ruleId } : {}), bloqueante: m.severity === 2 }))
        .filter((d) => !files.size || files.has(d.file)),
    );
  } catch {
    return null;
  }
}

function relOf(root: string, f: string): string {
  return path.relative(root, path.resolve(root, f)).split(path.sep).join("/");
}

function parseDiags(root: string, tool: string, t: Tool, out: string, files: Set<string>): Diag[] {
  const diags: Diag[] = [];
  for (const m of out.matchAll(t.parse)) {
    const g = m.groups ?? {};
    if (!g.file || !g.msg) continue;
    const file = relOf(root, g.file.trim());
    if (files.size && !files.has(file)) continue;
    diags.push({ file, line: Number(g.line ?? 1), msg: g.msg.trim(), tool, ...(g.code ? { code: g.code } : {}), bloqueante: true });
  }
  return diags;
}

/** Mutantes sobrevivientes del reporte JSON de Stryker: cada uno es un cambio que tus tests no detectan. */
function strykerDiags(root: string, files: Set<string>): Diag[] {
  const report = path.join(root, "reports", "mutation", "mutation.json");
  if (!fs.existsSync(report)) return [];
  const data = JSON.parse(fs.readFileSync(report, "utf8")) as {
    files: Record<string, { mutants: { mutatorName: string; replacement?: string; status: string; location: { start: { line: number } } }[] }>;
  };
  const diags: Diag[] = [];
  for (const [f, info] of Object.entries(data.files)) {
    const file = relOf(root, f);
    if (files.size && !files.has(file)) continue;
    for (const m of info.mutants.filter((x) => x.status === "Survived" || x.status === "NoCoverage")) {
      diags.push({
        file,
        line: m.location.start.line,
        tool: "mutacion",
        code: m.mutatorName,
        msg:
          m.status === "NoCoverage"
            ? `ningún test ejecuta este código (mutante ${m.mutatorName} sin cobertura)`
            : `mutante sobrevivió: ${m.mutatorName}${m.replacement ? ` → \`${m.replacement.slice(0, 60)}\`` : ""}; ningún test detecta este cambio`,
        bloqueante: true,
      });
    }
  }
  return diags;
}

interface ReglaJson {
  id: string;
  descripcion: string;
  patron: string;
  archivos?: string[];
  activa?: boolean;
  bloqueante?: boolean;
}

/** Reglas mecánicas del humano: regex por línea, sin IA. */
export function reglasDiags(root: string, files: string[]): { diags: Diag[]; corrida?: Corrida } {
  const f = path.join(dataDir(root), "reglas.json");
  if (!fs.existsSync(f)) return { diags: [] };
  let reglas: ReglaJson[];
  try {
    reglas = ((JSON.parse(fs.readFileSync(f, "utf8")) as { reglas?: ReglaJson[] }).reglas ?? []).filter((r) => r.activa !== false);
  } catch (e) {
    return { diags: [], corrida: { tool: "reglas", estado: "error", detalle: `.cai/reglas.json inválido: ${String(e)}` } };
  }
  const diags: Diag[] = [];
  const errores: string[] = [];
  for (const r of reglas) {
    const match = picomatch(r.archivos?.length ? r.archivos : ["**/*"], { dot: true });
    let re: RegExp;
    try {
      re = new RegExp(r.patron);
    } catch (e) {
      errores.push(`regla ${r.id}: patrón inválido (${e instanceof Error ? e.message : String(e)})`);
      continue;
    }
    for (const file of files.filter((x) => match(x))) {
      let lines: string[];
      try {
        lines = fs.readFileSync(path.join(root, file), "utf8").split("\n");
      } catch {
        continue;
      }
      lines.forEach((l, i) => {
        if (re.test(l)) diags.push({ file, line: i + 1, tool: "reglas", code: r.id, msg: r.descripcion, bloqueante: r.bloqueante !== false });
      });
    }
  }
  if (errores.length) return { diags, corrida: { tool: "reglas", estado: "error", detalle: errores.join("; ") } };
  return { diags, corrida: { tool: "reglas", estado: diags.length ? "con hallazgos" : "ok" } };
}

export function runGate(root: string, filesIn: string[], o: GateOptions = {}): GateResult {
  const z = makeZoner(root);
  const files = filesIn.map((f) => relOf(root, f));
  const res: GateResult = { diags: [], corridas: [] };

  // Agrupar archivos por adaptador.
  const groups = new Map<Adapter, string[]>();
  for (const f of files) {
    const a = adapterFor(root, f);
    if (a) groups.set(a, [...(groups.get(a) ?? []), f]);
  }

  for (const [a, group] of groups) {
    const set = new Set(group);
    const criticos = group.filter((f) => z.isCritical(path.join(root, f)));
    for (const [name, t] of Object.entries(a.tools)) {
      const tool = `${a.id}:${name}`;
      if (o.solo && !o.solo.includes(name)) continue;
      const targets = t.soloCritico && !o.mutacion ? criticos : group;
      if (!targets.length) {
        res.corridas.push({ tool, estado: "omitida", detalle: t.soloCritico ? "solo corre en zonas críticas" : "sin archivos" });
        continue;
      }
      if (t.requiere && !t.requiere.some((r) => fs.existsSync(path.join(root, r)))) {
        res.corridas.push({ tool, estado: "omitida", detalle: `falta ${t.requiere[0]}` });
        continue;
      }
      if (name === "mutacion" && a.id === "typescript") fs.rmSync(path.join(root, "reports", "mutation", "mutation.json"), { force: true });
      const cmd = t.cmd.replace("{files}", targets.map(shq).join(t.soloCritico ? "," : " "));
      const { code, out, stdout, stderr } = run(root, cmd, t.soloCritico ? 30 * 60_000 : (o.timeoutMs ?? 5 * 60_000));
      if (notInstalled(code, out, stderr)) {
        res.corridas.push({ tool, estado: "no instalada", detalle: `instalar: ${a.install}` });
        continue;
      }
      let diags =
        name === "mutacion" && a.id === "typescript"
          ? strykerDiags(root, new Set(targets))
          : t.formato === "eslint-json"
            ? (eslintDiags(root, stdout, set) ?? [])
            : parseDiags(root, tool, t, out, name === "tests" || name === "tipos" ? new Set() : set);
      if (t.formato === "eslint-json" && eslintDiags(root, stdout, set) === null) {
        res.corridas.push({ tool, estado: "error", detalle: out.trim().split("\n").slice(0, 3).join("\n") });
        continue;
      }
      if (name === "mutacion" && a.id === "python" && code !== 0) {
        const survived = /(\d+)\s+surviv/i.exec(out)?.[1];
        diags = [{ file: targets[0]!, line: 1, tool, msg: `${survived ?? "algunos"} mutantes sobrevivieron (ver \`mutmut results\`)`, bloqueante: true }];
      }
      const sinReporte = name === "mutacion" && a.id === "typescript" && !fs.existsSync(path.join(root, "reports", "mutation", "mutation.json"));
      if ((code !== 0 && !diags.length && name !== "mutacion") || sinReporte) {
        const lines = out.split("\n").filter((l) => l.trim() && !/^\s+at /.test(l));
        const detalle = (lines.find((l) => /error|fail/i.test(l)) ?? lines.slice(-2).join(" ")).trim().slice(0, 240);
        res.corridas.push({ tool, estado: "error", detalle });
        // Tests o tipos que fallan sin diagnóstico legible igual bloquean: nunca se aprueba lo que falló.
        if (name === "tests" || name === "tipos") res.diags.push({ file: group[0]!, line: 1, tool, msg: `falló: ${detalle}`, bloqueante: true });
        continue;
      }
      res.diags.push(...diags);
      res.corridas.push({ tool, estado: diags.length ? "con hallazgos" : "ok" });
    }
  }

  if (!o.solo || o.solo.includes("reglas")) {
    const r = reglasDiags(root, files);
    res.diags.push(...r.diags);
    if (r.corrida) res.corridas.push(r.corrida);
  }
  return res;
}
