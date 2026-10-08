import fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import { correr, dataDir, mostrarError, root, todasLasNotas, type Ocupacion } from "./comun";
import type { Estado } from "./estado";

/**
 * Panel lateral "ComplementAIry": ▶ Siguiente paso (orden fijo, sin IA), el Proyecto (estado,
 * estructura con lo que falta crear, preguntas para ti), tareas, notas por archivo y qué está
 * haciendo la IA. Todo sale de la CLI (`cai siguiente/tareas/memoria --json`) y de .cai/.
 */

interface Estructura {
  resumen: string;
  carpetas: { ruta: string; para_que: string }[];
  modulos: { archivo: string; responsabilidad: string; funciones: string[] }[];
  orden: string[];
}

interface Pregunta {
  n: number;
  pregunta: string;
  sugerencia: string;
}

interface Panorama {
  estado: string;
  riesgos: string[];
}

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
  crear?: boolean;
  detalle?: string;
  origen?: string;
  hecha: boolean;
}

type Nodo =
  | { k: "grupo"; id: "pendientes" | "hechas" | "proyecto" | "estructura" | "preguntas" | "ia"; label: string }
  | { k: "accion"; label: string; icono: string; comando: vscode.Command; tooltip?: string; descripcion?: string }
  | { k: "modulo"; archivo: string; resp: string; funciones: string[]; existe: boolean }
  | { k: "pregunta"; q: Pregunta }
  | { k: "paso"; p: Paso; principal?: boolean }
  | { k: "tarea"; t: Tarea }
  | { k: "archivo"; rel: string; n: number }
  | { k: "nota"; rel: string; id: string; titulo: string; linea: number; bloqueante: boolean }
  | { k: "ia"; o?: Ocupacion }
  | { k: "vacio"; label: string };

const ICONO_PASO: Record<string, string> = { responder: "comment-discussion", arreglar: "error", tarea: "tasklist", bloqueante: "warning", nota: "note" };
const ICONO_TAREA: Record<string, string> = { estructura: "new-file", panorama: "lightbulb", plano: "symbol-method", manual: "circle-small" };

/** ¿La ruta (que puede venir de la IA) queda dentro del proyecto? */
export function dentro(cwd: string, rel: string): boolean {
  const r = path.relative(cwd, path.resolve(cwd, rel));
  return !!r && !r.startsWith("..") && !path.isAbsolute(r);
}

/** Crea un archivo vacío (lo decides tú con un clic; la IA no escribe en él) y lo abre. */
export async function crearArchivo(cwd: string, rel: string): Promise<void> {
  if (!dentro(cwd, rel)) return void vscode.window.showWarningMessage(`ComplementAIry: ${rel} queda fuera del proyecto; no lo creo.`);
  const uri = vscode.Uri.file(path.join(cwd, rel));
  if (!fs.existsSync(uri.fsPath)) {
    const ok = await vscode.window.showInformationMessage(`¿Crear ${rel} (vacío)?`, { modal: true }, "Crear");
    if (ok !== "Crear") return;
    await vscode.workspace.fs.writeFile(uri, new Uint8Array());
  }
  await vscode.window.showTextDocument(uri, { preview: false });
}

/** Abre un archivo del proyecto en una línea (y despliega la nota si es una). */
export async function irA(cwd: string, archivo?: string, linea?: number, notaId?: string, ofrecerCrear = false): Promise<void> {
  if (!archivo || !dentro(cwd, archivo)) return;
  const uri = vscode.Uri.file(path.join(cwd, archivo));
  if (!fs.existsSync(uri.fsPath)) {
    // Solo lo que se propuso crear (estructura / tareas "crear"); el resto avisa.
    if (ofrecerCrear) return crearArchivo(cwd, archivo);
    return void vscode.window.showWarningMessage(`ComplementAIry: ${archivo} no existe (¿lo renombraste o borraste?).`);
  }
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
  private preguntas: Pregunta[] = [];
  private estructura?: Estructura;
  private panorama?: Panorama;
  /** Archivos de código que cambiaron desde el último panorama (sin IA). */
  private desactualizado = 0;
  /** Archivos nuevos que no están en la estructura propuesta. */
  private fuera: string[] = [];
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
    try {
      this.preguntas = (JSON.parse(await correr(["memoria", "--json"], cwd, { silencioso: true })) as { abiertas: Pregunta[] }).abiertas;
    } catch {
      this.preguntas = []; // una CLI vieja sin `memoria` no deja el resto del panel vacío
    }
    const leer = <T>(f: string): T | undefined => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dataDir(cwd), f), "utf8")) as T;
      } catch {
        return undefined;
      }
    };
    this.estructura = leer<Estructura>("estructura.json");
    // Sin repetidos (el id del árbol es el archivo) y solo rutas dentro del proyecto.
    if (this.estructura)
      this.estructura.modulos = this.estructura.modulos.filter((m, i, arr) => dentro(cwd, m.archivo) && arr.findIndex((x) => x.archivo === m.archivo) === i);
    this.panorama = leer<{ sugerencias?: Panorama }>(path.join("cache", "panorama.json"))?.sugerencias;
    try {
      this.desactualizado = this.panorama ? (JSON.parse(await correr(["panorama", "--estado", "--json"], cwd, { silencioso: true })) as { cambiados: string[] }).cambiados.length : 0;
    } catch {
      this.desactualizado = 0;
    }
    // Archivos creados después de la propuesta de estructura que no están en ella (sin IA).
    this.fuera = [];
    const est = path.join(dataDir(cwd), "estructura.json");
    if (this.estructura && fs.existsSync(est)) {
      const desde = fs.statSync(est).mtimeMs;
      const propuestos = new Set(this.estructura.modulos.map((m) => m.archivo));
      const nuevos = await vscode.workspace.findFiles(new vscode.RelativePattern(cwd, "**/*.{js,jsx,ts,tsx,mjs,cjs,py,go,rs,java,kt,rb,php,cs,swift,dart,lua,vue}"), "**/{node_modules,dist,build,.git,.cai,coverage}/**", 400);
      this.fuera = nuevos
        // Solo la fecha de CREACIÓN (editar un archivo no lo vuelve "nuevo"); sin ella, no se marca.
        .filter((u) => {
          const b = fs.statSync(u.fsPath).birthtimeMs;
          return b > 0 && b > desde;
        })
        .map((u) => path.relative(cwd, u.fsPath).split(path.sep).join("/"))
        .filter((r) => !propuestos.has(r) && !/(\.test\.|\.spec\.|(^|\/)tests?\/)/.test(r))
        .slice(0, 10);
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
        const abierto = ["pendientes", "proyecto", "preguntas", "ia"].includes(n.id);
        const t = new vscode.TreeItem(n.label, abierto ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
        t.iconPath = new vscode.ThemeIcon({ pendientes: "list-ordered", hechas: "pass", proyecto: "project", estructura: "type-hierarchy", preguntas: "question", ia: "sparkle" }[n.id]);
        if (n.id === "estructura" && this.estructura) {
          t.description = this.estructura.resumen;
          t.tooltip = new vscode.MarkdownString(`**Estructura propuesta**\n\n${this.estructura.resumen}\n\n**Por dónde empezar:**\n${this.estructura.orden.map((o, i) => `${i + 1}. ${o}`).join("\n")}`);
        }
        t.id = `grupo:${n.id}`; // id fijo: el contador del texto cambia, pero no se pliega solo
        return t;
      }
      case "paso": {
        const t = new vscode.TreeItem(n.principal ? `▶ ${n.p.accion}` : n.p.accion);
        t.description = n.p.archivo ? `${n.p.archivo}${n.p.linea ? `:${n.p.linea}` : ""}` : "";
        t.tooltip = new vscode.MarkdownString(`**${n.p.titulo}**\n\n${n.p.accion}`);
        t.iconPath = new vscode.ThemeIcon(n.principal ? "play-circle" : (ICONO_PASO[n.p.tipo] ?? "circle-small"));
        t.command = this.comandoPaso(cwd, n.p);
        return t;
      }
      case "tarea": {
        const t = new vscode.TreeItem(n.t.titulo);
        t.iconPath = new vscode.ThemeIcon(ICONO_TAREA[n.t.origen ?? "manual"] ?? "circle-small");
        t.tooltip = new vscode.MarkdownString(`**${n.t.titulo}**${n.t.detalle ? `\n\n${n.t.detalle}` : ""}\n\n_Clic: ver el detalle completo._`);
        t.checkboxState = n.t.hecha ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked;
        t.description = n.t.detalle ?? n.t.archivo ?? "";
        t.id = `tarea:${n.t.id}`;
        // Clic: el detalle COMPLETO en el panel "Nota" (con ir al archivo, hecha, descartar).
        t.command = { command: "cai.notaPanel.tarea", title: "Ver", arguments: [n.t] };
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
      case "accion": {
        const t = new vscode.TreeItem(n.label);
        t.iconPath = new vscode.ThemeIcon(n.icono);
        t.command = n.comando;
        if (n.tooltip) t.tooltip = n.tooltip;
        if (n.descripcion) t.description = n.descripcion;
        return t;
      }
      case "modulo": {
        const t = new vscode.TreeItem(n.archivo);
        t.id = `modulo:${n.archivo}`;
        t.description = n.existe ? n.resp : `por crear · ${n.resp}`;
        t.iconPath = new vscode.ThemeIcon(n.existe ? "pass-filled" : "circle-large-outline");
        t.tooltip = new vscode.MarkdownString(`**${n.archivo}** ${n.existe ? "✓ existe" : "○ por crear"}\n\n${n.resp}${n.funciones.length ? `\n\nFunciones:\n${n.funciones.map((f) => `- ${f}`).join("\n")}` : ""}`);
        t.contextValue = n.existe ? "cai-modulo" : "cai-modulo-faltante";
        t.command = { command: "cai.irA", title: "Abrir", arguments: [cwd, n.archivo, undefined, undefined, true] };
        return t;
      }
      case "pregunta": {
        const t = new vscode.TreeItem(n.q.pregunta);
        t.id = `pregunta:${n.q.pregunta}`;
        t.iconPath = new vscode.ThemeIcon("comment-unresolved");
        if (n.q.sugerencia) t.description = `sugerencia: ${n.q.sugerencia}`;
        t.tooltip = "Clic: responder o conversar sobre la pregunta (en el panel Nota). Tu respuesta queda en la memoria del proyecto.";
        t.command = { command: "cai.notaPanel.pregunta", title: "Responder", arguments: [n.q] };
        return t;
      }
      case "vacio":
        return new vscode.TreeItem(n.label);
    }
  }

  /** Qué hace el clic en un paso: preguntas de la memoria → caja de respuesta; el resto → ir al lugar. */
  private comandoPaso(cwd: string, p: Paso): vscode.Command {
    if (p.tipo === "responder" && /conocimiento\.md$/.test(p.archivo ?? "") && this.preguntas[0]) return { command: "cai.notaPanel.pregunta", title: "Responder", arguments: [this.preguntas[0]] };
    const tarea = p.tipo === "tarea" ? this.tareas.find((t) => t.id === p.ref) : undefined;
    if (tarea) return { command: "cai.notaPanel.tarea", title: "Ver", arguments: [tarea] };
    const crear = false;
    return { command: "cai.irA", title: "Ir", arguments: [cwd, p.archivo, p.linea, p.tipo === "tarea" ? undefined : p.ref, crear] };
  }

  getChildren(n?: Nodo): Nodo[] {
    const cwd = root(vscode.window.activeTextEditor?.document);
    if (!cwd) return [{ k: "vacio", label: "Abre un proyecto" }];
    if (!n) {
      // ▶ Ahora (una sola cosa) · Pendientes (todo lo demás, en orden) · Proyecto · Hechas · IA
      const raiz: Nodo[] = [];
      if (this.pasos[0]) raiz.push({ k: "paso", p: this.pasos[0], principal: true });
      if (this.pasos.length > 1) raiz.push({ k: "grupo", id: "pendientes", label: `Pendientes (${this.pasos.length - 1})` });
      raiz.push({ k: "grupo", id: "proyecto", label: "Proyecto" });
      if (this.tareas.some((t) => t.hecha)) raiz.push({ k: "grupo", id: "hechas", label: "Hechas recientes" });
      raiz.push({ k: "grupo", id: "ia", label: "IA" });
      return raiz;
    }
    if (n.k === "grupo") {
      if (n.id === "pendientes")
        return this.pasos.slice(1, 40).map((p): Nodo => {
          const t = p.tipo === "tarea" ? this.tareas.find((x) => x.id === p.ref) : undefined;
          return t ? { k: "tarea", t } : { k: "paso", p };
        });
      if (n.id === "hechas") return this.tareas.filter((t) => t.hecha).slice(-10).map((t) => ({ k: "tarea", t }));
      if (n.id === "proyecto") {
        const out: Nodo[] = [];
        if (this.panorama)
          out.push({
            k: "accion",
            label: `Estado: ${this.panorama.estado}`,
            icono: "pulse",
            tooltip: `${this.panorama.estado}${this.panorama.riesgos.length ? `\n\nRiesgos:\n- ${this.panorama.riesgos.join("\n- ")}` : ""}\n\nClic: ver el panorama completo`,
            comando: { command: "cai.verPanorama", title: "Ver" },
          });
        else out.push({ k: "accion", label: "Ver el panorama del proyecto", icono: "telescope", descripcion: "estado, sugerencias y preguntas", comando: { command: "cai.panorama", title: "Panorama" } });
        if (this.panorama && this.desactualizado)
          out.push({ k: "accion", label: `Panorama desactualizado: ${this.desactualizado} archivo(s) cambiaron`, icono: "history", descripcion: "actualizar", comando: { command: "cai.panorama", title: "Actualizar" } });
        if (this.estructura) out.push({ k: "grupo", id: "estructura", label: "Estructura" });
        else out.push({ k: "accion", label: "Proponer la estructura del proyecto", icono: "type-hierarchy", descripcion: "carpetas, archivos y por dónde empezar", comando: { command: "cai.estructura", title: "Estructura" } });
        out.push({ k: "grupo", id: "preguntas", label: `Preguntas para ti${this.preguntas.length ? ` (${this.preguntas.length})` : ""}` });
        return out;
      }
      if (n.id === "estructura" && this.estructura) {
        const mods: Nodo[] = [...this.estructura.modulos]
          .sort((a, b) => a.archivo.localeCompare(b.archivo))
          .map((m) => ({ k: "modulo", archivo: m.archivo, resp: m.responsabilidad, funciones: m.funciones, existe: fs.existsSync(path.join(cwd, m.archivo)) }));
        const fuera: Nodo[] = this.fuera.map((r) => ({ k: "accion", label: r, icono: "question", descripcion: "nuevo, fuera de la propuesta", tooltip: "Lo creaste después de la propuesta de estructura y no está en ella. Si encaja, actualiza docs/ESTRUCTURA.md (o pide una nueva propuesta).", comando: { command: "cai.irA", title: "Abrir", arguments: [cwd, r] } }));
        return [...mods, ...fuera, { k: "accion", label: "Ver ESTRUCTURA.md", icono: "book", comando: { command: "cai.verEstructura", title: "Ver" } }];
      }
      if (n.id === "preguntas")
        return this.preguntas.length ? this.preguntas.map((q) => ({ k: "pregunta", q })) : [{ k: "vacio", label: "Ninguna por ahora" }];
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
    const w = vscode.workspace.createFileSystemWatcher("**/{.cai,.aicode}/{notas/*.json,tareas.json,conocimiento.md,estructura.json,cache/diagnosticos.json,cache/panorama.json}");
    const r = () => this.refrescar();
    w.onDidChange(r);
    w.onDidCreate(r);
    w.onDidDelete(r);
    ctx.subscriptions.push(
      this.vista,
      w,
      this.estado.onCambio(() => this.cambio.fire(undefined)),
      vscode.workspace.onDidSaveTextDocument(r),
      vscode.workspace.onDidCreateFiles(r),
      vscode.workspace.onDidDeleteFiles(r),
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
      vscode.commands.registerCommand("cai.irA", (cwd: string, archivo?: string, linea?: number, notaId?: string, ofrecerCrear?: boolean) => irA(cwd, archivo, linea, notaId, !!ofrecerCrear)),
      vscode.commands.registerCommand("cai.panel.refrescar", () => this.refrescar(0)),
      vscode.commands.registerCommand("cai.crearArchivo", (n?: Nodo) => {
        const cwd = root(vscode.window.activeTextEditor?.document);
        if (cwd && n?.k === "modulo") return crearArchivo(cwd, n.archivo);
      }),
      vscode.commands.registerCommand("cai.responderPregunta", async (q?: Pregunta | Nodo) => {
        const cwd = root(vscode.window.activeTextEditor?.document);
        const p = q && "k" in q ? (q.k === "pregunta" ? q.q : undefined) : q;
        if (!cwd || !p) return;
        const r = await vscode.window.showInputBox({
          title: p.pregunta,
          prompt: "Tu respuesta queda en la memoria del proyecto (.cai/conocimiento.md) y se usa en todas las sugerencias.",
          value: p.sugerencia,
          valueSelection: [0, p.sugerencia.length],
        });
        if (!r?.trim()) return;
        try {
          // Por número, pero comprobando que siga siendo la misma pregunta (otra pudo responderse antes).
          const actuales = (JSON.parse(await correr(["memoria", "--json"], cwd, { silencioso: true })) as { abiertas: Pregunta[] }).abiertas;
          const n = actuales.find((x) => x.pregunta === p.pregunta)?.n;
          if (!n) return void vscode.window.showWarningMessage("ComplementAIry: esa pregunta ya no está abierta.");
          await correr(["memoria", "responder", String(n), r.trim()], cwd);
          vscode.window.setStatusBarMessage("ComplementAIry: anotado en la memoria del proyecto ✓", 5000);
        } catch (e) {
          mostrarError(e);
        }
        this.refrescar(0);
      }),
      vscode.commands.registerCommand("cai.verPanorama", async () => {
        const cwd = root(vscode.window.activeTextEditor?.document);
        if (!cwd) return;
        const f = path.join(dataDir(cwd), "panorama.md");
        if (!fs.existsSync(f)) return vscode.commands.executeCommand("cai.panorama");
        await vscode.commands.executeCommand("markdown.showPreview", vscode.Uri.file(f));
      }),
      vscode.commands.registerCommand("cai.verEstructura", async () => {
        const cwd = root(vscode.window.activeTextEditor?.document);
        if (!cwd) return;
        const f = path.join(cwd, "docs", "ESTRUCTURA.md");
        if (!fs.existsSync(f)) return void vscode.window.showInformationMessage("ComplementAIry: no hay docs/ESTRUCTURA.md. Pídela desde el panel (Proponer la estructura del proyecto).");
        await vscode.commands.executeCommand("markdown.showPreview", vscode.Uri.file(f));
      }),
      vscode.commands.registerCommand("cai.estructura", async () => {
        const cwd = root(vscode.window.activeTextEditor?.document);
        if (!cwd) return;
        if (this.estructura) {
          const op = await vscode.window.showQuickPick(["Ver la estructura actual", "Pedir una nueva propuesta"], { placeHolder: "Estructura del proyecto" });
          if (!op) return;
          if (op.startsWith("Ver")) return vscode.commands.executeCommand("cai.verEstructura");
        }
        const desc = await vscode.window.showInputBox({
          prompt: "¿Qué estás construyendo? (opcional si ya está en .cai/proyecto.md)",
          placeHolder: "Ej.: un plugin de Obsidian que ordena notas recientes en carpetas",
        });
        if (desc === undefined) return;
        try {
          await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "ComplementAIry: proponiendo la estructura del proyecto…" }, () =>
            correr(["plano", ...(desc.trim() ? [desc.trim()] : [])], cwd),
          );
          this.refrescar(0);
          await vscode.commands.executeCommand("cai.verEstructura");
        } catch (e) {
          mostrarError(e);
        }
      }),
      vscode.commands.registerCommand("cai.siguiente", async () => {
        const cwd = root(vscode.window.activeTextEditor?.document);
        if (!cwd) return;
        await this.cargar();
        if (!this.pasos.length) return void vscode.window.showInformationMessage("ComplementAIry: ✓ nada pendiente. Sigue con tu plan o pide un panorama (Ctrl+Alt+P).");
        const pick = await vscode.window.showQuickPick(
          this.pasos.slice(0, 15).map((p, i) => ({ label: `${i === 0 ? "▶ " : ""}${p.accion}`, description: p.archivo ? `${p.archivo}${p.linea ? `:${p.linea}` : ""}` : "", detail: p.titulo, p })),
          { placeHolder: "Siguiente paso (el primero es el más importante)" },
        );
        if (pick) {
          const c = this.comandoPaso(cwd, pick.p);
          await vscode.commands.executeCommand(c.command, ...(c.arguments ?? []));
        }
      }),
    );
    this.refrescar(0);
  }
}
