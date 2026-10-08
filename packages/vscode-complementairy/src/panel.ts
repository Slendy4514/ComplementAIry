import path from "node:path";
import * as vscode from "vscode";
import { correr, mostrarError, root, todasLasNotas, type Ocupacion } from "./comun";
import type { Estado } from "./estado";

/**
 * Panel lateral "ComplementAIry": ▶ Siguiente paso (orden fijo, sin IA), tareas del plano,
 * notas por archivo y qué está haciendo la IA. Todo sale de `cai siguiente --json` y de .cai/.
 */

interface Paso {
  tipo: string;
  titulo: string;
  accion: string;
  archivo?: string;
  linea?: number;
  ref?: string;
}

interface Tarea {
  id: string;
  titulo: string;
  archivo?: string;
  hecha: boolean;
}

type Nodo =
  | { k: "grupo"; id: "despues" | "tareas" | "notas" | "ia"; label: string }
  | { k: "paso"; p: Paso; principal?: boolean }
  | { k: "tarea"; t: Tarea }
  | { k: "archivo"; rel: string; n: number }
  | { k: "nota"; rel: string; id: string; titulo: string; linea: number; bloqueante: boolean }
  | { k: "ia"; o?: Ocupacion }
  | { k: "vacio"; label: string };

const ICONO_PASO: Record<string, string> = { responder: "comment-discussion", arreglar: "error", tarea: "tasklist", bloqueante: "warning", nota: "note" };

/** Abre un archivo del proyecto en una línea (y despliega la nota si es una). */
export async function irA(cwd: string, archivo?: string, linea?: number, notaId?: string): Promise<void> {
  if (!archivo) return;
  const uri = vscode.Uri.file(path.join(cwd, archivo));
  if (notaId) return void (await vscode.commands.executeCommand("cai.nota.abrir", uri.toString(), notaId));
  const ed = await vscode.window.showTextDocument(uri, { preview: false });
  if (linea) {
    const pos = new vscode.Position(Math.max(0, linea - 1), 0);
    ed.selection = new vscode.Selection(pos, pos);
    ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  }
}

export class Panel implements vscode.TreeDataProvider<Nodo> {
  private readonly cambio = new vscode.EventEmitter<Nodo | undefined>();
  readonly onDidChangeTreeData = this.cambio.event;
  private pasos: Paso[] = [];
  private tareas: Tarea[] = [];
  private timer?: NodeJS.Timeout;
  private vista?: vscode.TreeView<Nodo>;

  constructor(private readonly estado: Estado) {}

  /** Recalcula (agrupando cambios seguidos: guardar dispara varios eventos). */
  refrescar(ms = 800): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.cargar(), ms);
  }

  private async cargar(): Promise<void> {
    const cwd = root(vscode.window.activeTextEditor?.document);
    if (!cwd) return;
    try {
      this.pasos = (JSON.parse(await correr(["siguiente", "--json"], cwd, { silencioso: true })) as { pasos: Paso[] }).pasos;
      this.tareas = JSON.parse(await correr(["tareas", "--json"], cwd, { silencioso: true })) as Tarea[];
    } catch {
      this.pasos = [];
    }
    const p = this.pasos[0];
    if (this.vista) this.vista.badge = this.pasos.length ? { value: this.pasos.length, tooltip: `${this.pasos.length} cosa(s) por hacer` } : undefined;
    if (this.vista) this.vista.message = p ? undefined : "✓ Nada pendiente. Sigue con tu plan o pide un panorama (Ctrl+Alt+P).";
    this.cambio.fire(undefined);
  }

  getTreeItem(n: Nodo): vscode.TreeItem {
    const cwd = root(vscode.window.activeTextEditor?.document) ?? "";
    switch (n.k) {
      case "grupo": {
        const t = new vscode.TreeItem(n.label, n.id === "tareas" || n.id === "ia" ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
        t.iconPath = new vscode.ThemeIcon({ despues: "list-ordered", tareas: "checklist", notas: "comment", ia: "sparkle" }[n.id]);
        t.id = `grupo:${n.id}`; // id fijo: el contador del texto cambia, pero no se pliega solo
        return t;
      }
      case "paso": {
        const t = new vscode.TreeItem(n.principal ? `▶ ${n.p.accion}` : n.p.accion);
        t.description = n.p.archivo ? `${n.p.archivo}${n.p.linea ? `:${n.p.linea}` : ""}` : "";
        t.tooltip = new vscode.MarkdownString(`**${n.p.titulo}**\n\n${n.p.accion}`);
        t.iconPath = new vscode.ThemeIcon(n.principal ? "play-circle" : (ICONO_PASO[n.p.tipo] ?? "circle-small"));
        t.command = { command: "cai.irA", title: "Ir", arguments: [cwd, n.p.archivo, n.p.linea, n.p.tipo === "tarea" ? undefined : n.p.ref] };
        return t;
      }
      case "tarea": {
        const t = new vscode.TreeItem(n.t.titulo);
        t.checkboxState = n.t.hecha ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked;
        t.description = n.t.archivo ?? "";
        t.id = `tarea:${n.t.id}`;
        if (n.t.archivo) t.command = { command: "cai.irA", title: "Ir", arguments: [cwd, n.t.archivo] };
        return t;
      }
      case "archivo": {
        const t = new vscode.TreeItem(n.rel, vscode.TreeItemCollapsibleState.Collapsed);
        t.description = `${n.n}`;
        t.resourceUri = vscode.Uri.file(path.join(cwd, n.rel));
        t.id = `archivo:${n.rel}`;
        t.iconPath = vscode.ThemeIcon.File;
        return t;
      }
      case "nota": {
        const t = new vscode.TreeItem(n.titulo);
        t.description = `línea ${n.linea}`;
        t.iconPath = new vscode.ThemeIcon(n.bloqueante ? "warning" : "note");
        t.id = `nota:${n.rel}:${n.id}`;
        t.command = { command: "cai.irA", title: "Ir", arguments: [cwd, n.rel, n.linea, n.id] };
        return t;
      }
      case "ia": {
        if (!n.o) {
          const t = new vscode.TreeItem("Libre: nada en curso");
          t.iconPath = new vscode.ThemeIcon("check");
          return t;
        }
        const t = new vscode.TreeItem(`${n.o.tarea}${n.o.archivo === "__proyecto__" ? "" : ` · ${n.o.archivo}`}`);
        t.description = `${Math.round((Date.now() - Date.parse(n.o.desde)) / 1000)} s`;
        t.iconPath = new vscode.ThemeIcon("sync~spin");
        t.command = { command: "cai.estado", title: "Ver" };
        return t;
      }
      case "vacio":
        return new vscode.TreeItem(n.label);
    }
  }

  getChildren(n?: Nodo): Nodo[] {
    const cwd = root(vscode.window.activeTextEditor?.document);
    if (!cwd) return [{ k: "vacio", label: "Abre un proyecto" }];
    if (!n) {
      const pend = this.tareas.filter((t) => !t.hecha).length;
      const notas = todasLasNotas(cwd).length;
      const raiz: Nodo[] = [];
      if (this.pasos[0]) raiz.push({ k: "paso", p: this.pasos[0], principal: true });
      if (this.pasos.length > 1) raiz.push({ k: "grupo", id: "despues", label: `Después (${Math.min(this.pasos.length - 1, 10)})` });
      raiz.push({ k: "grupo", id: "tareas", label: `Tareas${pend ? ` (${pend} pendientes)` : ""}` });
      raiz.push({ k: "grupo", id: "notas", label: `Notas (${notas})` });
      raiz.push({ k: "grupo", id: "ia", label: "IA" });
      return raiz;
    }
    if (n.k === "grupo") {
      if (n.id === "despues") return this.pasos.slice(1, 11).map((p) => ({ k: "paso", p }));
      if (n.id === "tareas") {
        const pend = this.tareas.filter((t) => !t.hecha);
        const hechas = this.tareas.filter((t) => t.hecha).slice(-5);
        const out: Nodo[] = [...pend, ...hechas].map((t) => ({ k: "tarea", t }));
        return out.length ? out : [{ k: "vacio", label: "Sin tareas: salen del plano de cada archivo y del panorama" }];
      }
      if (n.id === "notas") {
        const por = new Map<string, number>();
        for (const x of todasLasNotas(cwd)) por.set(x.archivo, (por.get(x.archivo) ?? 0) + 1);
        return por.size ? [...por].sort().map(([rel, c]) => ({ k: "archivo", rel, n: c })) : [{ k: "vacio", label: "Sin notas abiertas" }];
      }
      if (n.id === "ia") return this.estado.actual.length ? this.estado.actual.map((o) => ({ k: "ia", o })) : [{ k: "ia" }];
    }
    if (n.k === "archivo")
      return todasLasNotas(cwd)
        .filter((x) => x.archivo === n.rel)
        .sort((a, b) => a.ancla.linea - b.ancla.linea)
        .map((x) => ({ k: "nota", rel: x.archivo, id: x.id, titulo: x.titulo, linea: x.ancla.linea, bloqueante: x.bloqueante }));
    return [];
  }

  registrar(ctx: vscode.ExtensionContext): void {
    this.vista = vscode.window.createTreeView("cai.panel", { treeDataProvider: this, showCollapseAll: true });
    const w = vscode.workspace.createFileSystemWatcher("**/{.cai,.aicode}/{notas/*.json,tareas.json,conocimiento.md,cache/diagnosticos.json}");
    const r = () => this.refrescar();
    w.onDidChange(r);
    w.onDidCreate(r);
    w.onDidDelete(r);
    ctx.subscriptions.push(
      this.vista,
      w,
      this.estado.onCambio(() => this.cambio.fire(undefined)),
      vscode.workspace.onDidSaveTextDocument(r),
      this.vista.onDidChangeCheckboxState(async (e) => {
        const cwd = root(vscode.window.activeTextEditor?.document);
        if (!cwd) return;
        for (const [n, estado] of e.items)
          if (n.k === "tarea") {
            try {
              await correr(["tareas", estado === vscode.TreeItemCheckboxState.Checked ? "hecha" : "pendiente", n.t.id], cwd);
            } catch (err) {
              mostrarError(err);
            }
          }
        this.refrescar(0);
      }),
      vscode.commands.registerCommand("cai.irA", (cwd: string, archivo?: string, linea?: number, notaId?: string) => irA(cwd, archivo, linea, notaId)),
      vscode.commands.registerCommand("cai.panel.refrescar", () => this.refrescar(0)),
      vscode.commands.registerCommand("cai.siguiente", async () => {
        const cwd = root(vscode.window.activeTextEditor?.document);
        if (!cwd) return;
        await this.cargar();
        if (!this.pasos.length) return void vscode.window.showInformationMessage("ComplementAIry: ✓ nada pendiente. Sigue con tu plan o pide un panorama (Ctrl+Alt+P).");
        const pick = await vscode.window.showQuickPick(
          this.pasos.slice(0, 15).map((p, i) => ({ label: `${i === 0 ? "▶ " : ""}${p.accion}`, description: p.archivo ? `${p.archivo}${p.linea ? `:${p.linea}` : ""}` : "", detail: p.titulo, p })),
          { placeHolder: "Siguiente paso (el primero es el más importante)" },
        );
        if (pick) await irA(cwd, pick.p.archivo, pick.p.linea, pick.p.tipo === "tarea" ? undefined : pick.p.ref);
      }),
    );
    this.refrescar(0);
  }
}
