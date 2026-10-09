import * as vscode from "vscode";
import fs from "node:fs";
import path from "node:path";
import { claveDeSimbolo, dataDir, notasDe, relDe, root, vista } from "./comun";
import { ESTADO, type NotasView } from "./notasView";

/** Sobre cada función: `💬 2 notas · 💡 Ayuda · 🧪 Tests`. Las funciones las da VSCode (símbolos del documento). */

const FUNCIONES = new Set([vscode.SymbolKind.Function, vscode.SymbolKind.Method, vscode.SymbolKind.Constructor]);

function aplanar(s: vscode.DocumentSymbol[], out: vscode.DocumentSymbol[] = []): vscode.DocumentSymbol[] {
  for (const x of s) {
    if (FUNCIONES.has(x.kind)) out.push(x);
    aplanar(x.children, out);
  }
  return out;
}

export class Lentes implements vscode.CodeLensProvider {
  private readonly cambio = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.cambio.event;

  constructor(private readonly notas: NotasView) {
    notas.onCambio(() => this.cambio.fire());
  }

  async provideCodeLenses(doc: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    const cwd = root(doc);
    if (!cwd || vista(cwd) !== "notas" || !vscode.workspace.getConfiguration("cai").get<boolean>("codelens", true)) return [];
    const simbolos = (await vscode.commands.executeCommand<vscode.DocumentSymbol[] | undefined>("vscode.executeDocumentSymbolProvider", doc.uri)) ?? [];
    const todas = this.notas.notas(doc);
    const notas = todas.filter((n) => n.alcance !== "archivo");
    // Arriba del archivo: lo que es del archivo entero (no de una función).
    const arriba = new vscode.Range(0, 0, 0, 0);
    const u = doc.uri.toString();
    const out: vscode.CodeLens[] = [
      new vscode.CodeLens(arriba, { title: "📄 Archivo:", command: "" }),
      new vscode.CodeLens(arriba, { title: "🗺️ Plano", tooltip: "Qué funciones debería tener este archivo y por cuál empezar (notas + tareas)", command: "cai.plano", arguments: [doc.uri] }),
      new vscode.CodeLens(arriba, { title: "💡 Ayuda con el archivo", tooltip: "Preguntar o pedir pista/piezas/ejemplo sobre el archivo entero", command: "cai.ayudaArchivo", arguments: [u] }),
      new vscode.CodeLens(arriba, { title: "🔎 Revisar", tooltip: "Revisión completa en segundo plano: revisores, ¿quedó lista? de cada función (con otra mirada), tests y veredicto del archivo", command: "cai.revisar" }),
    ];
    // Veredicto de la última revisión completa (si el archivo no cambió desde entonces).
    try {
      const v = (JSON.parse(fs.readFileSync(path.join(dataDir(cwd), "cache", "veredictos.json"), "utf8")) as Record<string, { estado: string; listas: number; total: number; testsFallan: number; fecha: string }>)[relDe(cwd, doc.uri.fsPath)];
      if (v)
        out.splice(1, 0, new vscode.CodeLens(arriba, { title: `${{ lista: "🟢", casi: "🟡", falta: "🔴" }[v.estado] ?? ""} ${v.listas}/${v.total} listas${v.testsFallan ? ` · ${v.testsFallan} test(s) fallan` : ""}`, tooltip: `Revisión completa del ${new Date(v.fecha).toLocaleString()}. "🔎 Revisar" la actualiza.`, command: "cai.notasArchivo", arguments: [u] }));
    } catch {
      /* sin revisión completa todavía */
    }
    if (todas.length)
      out.push(new vscode.CodeLens(arriba, { title: `💬 ${todas.length} nota${todas.length > 1 ? "s" : ""}${todas.some((n) => n.bloqueante) ? " ⚠" : ""}`, tooltip: "Ver las notas de este archivo", command: "cai.notasArchivo", arguments: [u] }));
    const funciones = aplanar(simbolos);
    const resueltas = cwd ? (notasDe(cwd, doc, true) ?? []).filter((n) => n.estado === "resuelta" && n.verificacion?.estado === "lista") : [];
    for (const f of funciones) {
      const r = new vscode.Range(f.range.start.line, 0, f.range.start.line, 0);
      const nombre = claveDeSimbolo(funciones, f);
      // Una nota por función: la suya (por clave) o la que esté anclada dentro.
      const nota = notas.find((n) => n.ancla.funcion === nombre) ?? notas.find((n) => n.ancla.linea - 1 >= f.range.start.line && n.ancla.linea - 1 <= f.range.end.line);
      const lista = !nota && resueltas.find((n) => n.ancla.funcion === nombre);
      if (lista) out.push(new vscode.CodeLens(r, { title: "🟢 lista", tooltip: lista.verificacion?.resumen ?? "", command: "cai.notaPanel.mostrar", arguments: [doc.uri.toString(), lista.id] }));
      // Impacto (sin IA): una función que esta usa cambió.
      if (nota?.impacto?.length) out.push(new vscode.CodeLens(r, { title: `⚠ cambió ${nota.impacto.map((i) => i.funcion).join(", ")}`, tooltip: "Una función que esta usa cambió: revisa si sigue bien (✅ ¿Lista? lo limpia)", command: "cai.verificarFuncion", arguments: [doc.uri.toString(), nombre] }));
      if (nota) {
        const v = nota.verificacion ? ` · ${ESTADO[nota.verificacion.estado]}` : "";
        out.push(new vscode.CodeLens(r, { title: `💬 nota${nota.bloqueante ? " ⚠" : ""}${v}`, tooltip: nota.accion ? `▶ ${nota.accion}` : "Ver la nota", command: "cai.nota.abrir", arguments: [doc.uri.toString(), nota.id] }));
      }
      out.push(new vscode.CodeLens(r, { title: "💡 Ayuda", tooltip: "Pista, piezas, pseudocódigo, ejemplo o explicación para esta función", command: "cai.pedirAqui", arguments: [doc.uri.toString(), f.selectionRange.start.line + 1] }));
      // Pasos chicos (medido sin IA): cuántas líneas cambiaron desde la última verificación.
      const sinRevisar = nota?.verificacion?.lineas ? cambiadas(nota.verificacion.lineas, doc.getText(f.range).split(/\r?\n/)) : 0;
      out.push(new vscode.CodeLens(r, { title: sinRevisar >= 10 ? `✅ ¿Lista? (${sinRevisar} líneas sin revisar)` : "✅ ¿Lista?", tooltip: "¿Quedó lista? Revisa la función con lo que ya hiciste (primero sin IA); si está lista, cierra su nota", command: "cai.verificarFuncion", arguments: [doc.uri.toString(), nombre] }));
      out.push(new vscode.CodeLens(r, { title: "🧪 Tests", tooltip: "Proponer casos de prueba para esta función", command: "cai.pedirAqui", arguments: [doc.uri.toString(), f.selectionRange.start.line + 1, "tests"] }));
    }
    return out;
  }

  registrar(ctx: vscode.ExtensionContext): void {
    ctx.subscriptions.push(
      vscode.languages.registerCodeLensProvider({ scheme: "file" }, this),
      vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration("cai") && this.cambio.fire()),
      this.cambio,
    );
  }
}

/** Líneas de `ahora` que no estaban (como multiconjunto) en `antes`: cuánto cambió sin revisar. */
function cambiadas(antes: string[], ahora: string[]): number {
  const quedan = new Map<string, number>();
  for (const l of antes) quedan.set(l.trim(), (quedan.get(l.trim()) ?? 0) + 1);
  let n = 0;
  for (const l of ahora) {
    const k = l.trim();
    if (!k) continue;
    const c = quedan.get(k) ?? 0;
    if (c) quedan.set(k, c - 1);
    else n++;
  }
  return n;
}
