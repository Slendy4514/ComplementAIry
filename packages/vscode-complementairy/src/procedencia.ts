import fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import { correr, dataDir, guardadoPropio, relDe, root } from "./comun";
import { tieneCai } from "./iniciar";

/**
 * Procedencia en el editor (v1): de quién es cada línea y si un humano la revisó, como un mapa de cobertura
 * en el margen (rojo IA sin revisar · verde revisada · ámbar ajeno sin entender · morado pegado o ia-probable).
 * Al guardar, lo que escribiste se registra como tuyo; un bloque grande insertado de una vez (pegado o
 * autocompletado de otra IA) queda como "pegado": necesita tu evidencia como lo de la IA.
 */

interface Linea {
  h: string;
  o: string;
  n: number;
  t?: string;
}

/** La misma huella que la CLI (FNV-1a sobre la línea sin espacios de los extremos). */
export function huellaLinea(l: string): string {
  let h = 2166136261;
  const s = l.trim();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

const borde = (color: string) =>
  vscode.window.createTextEditorDecorationType({ borderWidth: "0 0 0 3px", borderStyle: "solid", borderColor: new vscode.ThemeColor(color), overviewRulerColor: new vscode.ThemeColor(color), overviewRulerLane: vscode.OverviewRulerLane.Left, isWholeLine: true });

const DECO = {
  iaSin: borde("cai.iaSinRevisar"),
  iaOk: borde("cai.iaRevisada"),
  ajeno: borde("cai.ajenoSinEntender"),
  pegado: borde("cai.pegado"),
};

const AJENOS = new Set(["heredado", "ia-previa", "previo-propio", "desconocido"]);

export class Procedencia {
  /** Líneas insertadas de una vez (texto), por documento, hasta el próximo guardado. */
  private bloques = new Map<string, string[][]>();
  /** Inserciones largas dentro de una línea, de una vez (autocompletado de otra IA): ia-probable. */
  private probables = new Map<string, string[]>();
  /** Insertamos nosotros (snippet aprobado): no es "pegado". */
  private propios = new Set<string>();

  registrar(ctx: vscode.ExtensionContext): void {
    const pintar = () => this.pintar(vscode.window.activeTextEditor);
    const w = vscode.workspace.createFileSystemWatcher("**/.cai/procedencia/*.json");
    for (const ev of [w.onDidChange, w.onDidCreate, w.onDidDelete]) ev(pintar);
    ctx.subscriptions.push(
      w,
      vscode.window.onDidChangeActiveTextEditor((ed) => this.pintar(ed)),
      vscode.workspace.onDidChangeTextDocument((e) => this.cambio(e)),
      vscode.workspace.onDidSaveTextDocument((d) => void this.alGuardar(d)),
      vscode.commands.registerCommand("cai.procedencia.alternar", () => {
        const c = vscode.workspace.getConfiguration("cai");
        void c.update("procedencia", !c.get<boolean>("procedencia", true), vscode.ConfigurationTarget.Global).then(pintar);
      }),
    );
    pintar();
  }

  /** Un snippet insertado por la extensión (con tu clic) no cuenta como pegado. */
  marcarPropio(texto: string): void {
    this.propios.add(texto.trim());
  }

  private cambio(e: vscode.TextDocumentChangeEvent): void {
    if (e.document.uri.scheme !== "file" || e.reason !== undefined) return; // deshacer/rehacer no cuenta
    for (const c of e.contentChanges) {
      const lineas = c.text.split(/\r?\n/);
      if (this.propios.has(c.text.trim())) continue;
      // Nadie teclea 60 caracteres en un solo evento: es autocompletado (Copilot y similares) o pegado corto.
      if (lineas.length === 1 && c.rangeLength === 0 && c.text.trim().length >= 60) {
        const k = e.document.uri.toString();
        const linea = e.document.lineAt(c.range.start.line).text;
        this.probables.set(k, [...(this.probables.get(k) ?? []), linea]);
        continue;
      }
      if (lineas.length < 3) continue;
      const k = e.document.uri.toString();
      this.bloques.set(k, [...(this.bloques.get(k) ?? []), lineas.filter((l) => l.trim())]);
    }
    if (vscode.window.activeTextEditor?.document === e.document) this.pintar(vscode.window.activeTextEditor);
  }

  private async alGuardar(doc: vscode.TextDocument): Promise<void> {
    const cwd = root(doc);
    if (!cwd || doc.uri.scheme !== "file" || !tieneCai(cwd) || guardadoPropio(doc)) return;
    const rel = relDe(cwd, doc.uri.fsPath);
    if (rel.startsWith("..") || rel.startsWith(".cai/")) return;
    const k = doc.uri.toString();
    const bloques = this.bloques.get(k) ?? [];
    this.bloques.delete(k);
    const probables = this.probables.get(k) ?? [];
    this.probables.delete(k);
    // Las líneas pegadas: las que hoy tienen exactamente el texto de un bloque insertado de una vez.
    const pegadas: number[] = [];
    const texto = doc.getText().split(/\r?\n/);
    for (const b of bloques) {
      const primera = b[0]!.trim();
      const i = texto.findIndex((l, j) => l.trim() === primera && b.every((x, m) => texto[j + m]?.trim() === x.trim()));
      if (i >= 0) for (let m = 0; m < b.length; m++) pegadas.push(i + m + 1);
    }
    const iaProbable = probables.map((l) => texto.findIndex((x) => x.trim() && x.includes(l.trim().slice(0, 60))) + 1).filter((n) => n > 0);
    try {
      await correr(["asentar", rel, ...(pegadas.length ? ["--pegado", pegadas.join(",")] : []), ...(iaProbable.length ? ["--ia-probable", iaProbable.join(",")] : []), "--json"], cwd, { silencioso: true });
      if (pegadas.length) vscode.window.setStatusBarMessage(`ComplementAIry: ${pegadas.length} línea(s) pegadas de una vez quedan para revisar (¿de dónde vienen?)`, 6000);
    } catch {
      /* sin CLI: el pre-commit lo asienta igual */
    }
  }

  pintar(ed: vscode.TextEditor | undefined): void {
    if (!ed) return;
    const cwd = root(ed.document);
    const limpiar = () => Object.values(DECO).forEach((d) => ed.setDecorations(d, []));
    if (!cwd || !vscode.workspace.getConfiguration("cai").get<boolean>("procedencia", true)) return limpiar();
    const rel = relDe(cwd, ed.document.uri.fsPath);
    const f = path.join(dataDir(cwd), "procedencia", `${rel.replace(/\//g, "__")}.json`);
    let lineas: Linea[] = [];
    try {
      lineas = (JSON.parse(fs.readFileSync(f, "utf8")) as { lineas: Linea[] }).lineas;
    } catch {
      return limpiar();
    }
    // Anclar por huella, en orden (si editaste después, las líneas nuevas quedan sin color hasta guardar).
    const porHuella = new Map<string, Linea[]>();
    for (const l of lineas) porHuella.set(l.h, [...(porHuella.get(l.h) ?? []), l]);
    const r: Record<keyof typeof DECO, vscode.Range[]> = { iaSin: [], iaOk: [], ajeno: [], pegado: [] };
    for (let i = 0; i < ed.document.lineCount; i++) {
      const t = ed.document.lineAt(i).text;
      if (!t.trim()) continue;
      const m = porHuella.get(huellaLinea(t))?.shift();
      if (!m) continue;
      const rango = new vscode.Range(i, 0, i, 0);
      if (m.o === "ia") (m.n >= 2 ? r.iaOk : r.iaSin).push(rango);
      else if ((m.o === "pegado" || m.o === "ia-probable") && m.n < 2) r.pegado.push(rango);
      else if (AJENOS.has(m.o) && m.n < 2) r.ajeno.push(rango);
    }
    for (const k of Object.keys(DECO) as (keyof typeof DECO)[]) ed.setDecorations(DECO[k], r[k]);
  }
}
