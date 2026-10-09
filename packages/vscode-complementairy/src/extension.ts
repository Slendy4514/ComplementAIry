import { execFile } from "node:child_process";
import * as vscode from "vscode";
import { Acciones, insertarSnippet, revisarConEdiciones } from "./acciones";
import { Lentes } from "./codelens";
import { cli, correr, envVista, guardadoPropio, guardar, leerConfig, mostrarError, output, root, silenciado, vista } from "./comun";
import { registrarConfiguracion } from "./configuracion";
import { NotaPanel } from "./notaView";
import { ChatView } from "./chatView";
import fs from "node:fs";
import path from "node:path";
import { Rapidas } from "./rapidas";
import { BarraModo, Estado } from "./estado";
import { NotasView } from "./notasView";
import { Panel } from "./panel";

/**
 * Capa sobre la CLI `cai`: notas en la línea exacta (hilos con botones), panel "Siguiente paso",
 * barra de estado "pensando…", CodeLens y snippets que insertas tú. Toda la lógica (y todas las
 * garantías) están en la CLI; la extensión la invoca y muestra lo que deja en .cai/.
 */

const shq = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

// `check` sale con 1 cuando alguna predicción no coincidió: es un resultado, no un error.
const run = (args: string[], cwd: string, _titulo?: string): Promise<string> => correr(args, cwd, args[0] === "check" ? { aceptar: [1] } : {});

async function onFile(cmd: string, titulo: string, extra: string[] = []): Promise<void> {
  const ed = vscode.window.activeTextEditor;
  if (!ed) return void vscode.window.showWarningMessage("ComplementAIry: abre un archivo primero.");
  const cwd = root(ed.document);
  if (!cwd) return void vscode.window.showWarningMessage("ComplementAIry: el archivo no está dentro de un proyecto abierto.");
  await guardar(ed.document);
  try {
    const out = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `ComplementAIry: ${titulo}…`, cancellable: false },
      () => run([cmd, ed.document.uri.fsPath, ...extra], cwd, titulo),
    );
    const resumen = out.split("\n").filter((l) => /^[✓✗!]/.test(l.trim())).slice(-2).join(" · ");
    vscode.window.setStatusBarMessage(`ComplementAIry: ${resumen || "listo"}`, 6000);
  } catch (e) {
    mostrarError(e);
  }
}

// --- Resaltado --------------------------------------------------------------------

const guiaDeco = vscode.window.createTextEditorDecorationType({ backgroundColor: new vscode.ThemeColor("cai.guiaFondo"), isWholeLine: true });
const humanoDeco = vscode.window.createTextEditorDecorationType({ backgroundColor: new vscode.ThemeColor("cai.humanoFondo"), isWholeLine: true });
const bloqDeco = vscode.window.createTextEditorDecorationType({
  borderWidth: "0 0 0 3px",
  borderStyle: "solid",
  borderColor: new vscode.ThemeColor("cai.bloqueante"),
  isWholeLine: true,
});

function decorate(ed: vscode.TextEditor | undefined): void {
  if (!ed) return;
  if (!vscode.workspace.getConfiguration("cai").get<boolean>("resaltar", true)) {
    for (const d of [guiaDeco, humanoDeco, bloqDeco]) ed.setDecorations(d, []);
    return;
  }
  const guia: vscode.Range[] = [];
  const humano: vscode.Range[] = [];
  const bloq: vscode.Range[] = [];
  let bloqId: string | null = null;
  for (let i = 0; i < ed.document.lineCount; i++) {
    const t = ed.document.lineAt(i).text;
    const m = /@guia\[([\w.-]+)\]/.exec(t);
    if (m) {
      guia.push(new vscode.Range(i, 0, i, 0));
      if (/\(blocking\)/.test(t)) bloqId = m[1]!;
      if (bloqId === m[1]) bloq.push(new vscode.Range(i, 0, i, 0));
      continue;
    }
    bloqId = null;
    if (/@ia\?|@yo:|@snippet\b/i.test(t)) humano.push(new vscode.Range(i, 0, i, 0));
  }
  ed.setDecorations(guiaDeco, guia);
  ed.setDecorations(humanoDeco, humano);
  ed.setDecorations(bloqDeco, bloq);
}

export function activate(ctx: vscode.ExtensionContext): void {
  envVista();
  const reg = (id: string, fn: () => unknown) => ctx.subscriptions.push(vscode.commands.registerCommand(id, fn));

  const estado = new Estado();
  estado.registrar(ctx);
  const notas = new NotasView((doc, n, i) => insertarSnippet(doc, n, i), ctx.extensionUri);
  notas.registrar(ctx);
  new Acciones(notas).registrar(ctx);
  new Lentes(notas).registrar(ctx);
  const panel = new Panel(estado);
  panel.registrar(ctx);
  const barra = new BarraModo((doc) => notas.notas(doc));
  barra.registrar(ctx);
  ctx.subscriptions.push(panel.onPasos((p) => barra.siguiente(p[0])));
  new NotaPanel(notas).registrar(ctx);
  new ChatView().registrar(ctx);
  void avisarInstruccionesViejas();

  /**
   * Revisión en segundo plano (no bloquea nada): "completa" = revisar --completo; "ligera" = "¿quedó
   * lista?" de las funciones con nota que cambiaron (modelo chico). La barra de estado muestra la cola.
   */
  function revisarEnFondo(doc: vscode.TextDocument, tipo: "completa" | "ligera"): void {
    const cwd = root(doc);
    if (!cwd) return;
    void guardar(doc).then(() => {
      const nombre = path.basename(doc.uri.fsPath);
      vscode.window.setStatusBarMessage(`ComplementAIry: revisando ${nombre} en segundo plano (puedes seguir trabajando)`, 4000);
      const args = tipo === "completa" ? ["revisar", doc.uri.fsPath, "--completo", "--json"] : ["verificar", doc.uri.fsPath, "--chico", "--json"];
      correr(args, cwd)
        .then((out) => {
          if (tipo !== "completa") return void vscode.window.setStatusBarMessage(`ComplementAIry: revisé ${nombre} (ligera)`, 6000);
          const r = JSON.parse(out) as { veredicto: { estado: string; listas: number; total: number; testsFallan: number } };
          const v = r.veredicto;
          const icono = { lista: "🟢", casi: "🟡", falta: "🔴" }[v.estado] ?? "";
          void vscode.window.showInformationMessage(`${icono} ${nombre}: ${v.listas} de ${v.total} funciones listas${v.testsFallan ? ` · ${v.testsFallan} test(s) fallan` : ""}`, "Ver").then((x) => x && vscode.window.showTextDocument(doc));
        })
        .catch(mostrarError);
    });
  }

  // Revisión al salir de un archivo (por defecto: nunca, a solicitud). Si cambiaste un archivo y no
  // vuelves en `revisar.minutosFuera` minutos, se revisa una vez (ligera o completa, según la configuración).
  const cambiadosSinRevisar = new Set<string>();
  const temporizadoresSalida = new Map<string, NodeJS.Timeout>();
  ctx.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((d) => d.uri.scheme === "file" && cambiadosSinRevisar.add(d.uri.toString())),
    vscode.window.onDidChangeActiveTextEditor((ed) => {
      if (!ed) return;
      const actual = ed.document.uri.toString();
      clearTimeout(temporizadoresSalida.get(actual)); // volviste: ya no hace falta
      temporizadoresSalida.delete(actual);
      for (const k of cambiadosSinRevisar) {
        if (k === actual || temporizadoresSalida.has(k)) continue;
        const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === k);
        const cwd = doc && root(doc);
        const cfg = cwd ? leerConfig(cwd).revisar : undefined;
        if (!doc || !cfg?.alSalir || cfg.alSalir === "nunca") continue;
        temporizadoresSalida.set(
          k,
          setTimeout(() => {
            temporizadoresSalida.delete(k);
            cambiadosSinRevisar.delete(k);
            if (!doc.isClosed) revisarEnFondo(doc, cfg.alSalir === "completa" ? "completa" : "ligera");
          }, Math.max(1, cfg.minutosFuera ?? 10) * 60_000),
        );
      }
    }),
    { dispose: () => temporizadoresSalida.forEach((t) => clearTimeout(t)) },
  );

  /** Si el CLAUDE.md del proyecto tiene instrucciones de una versión anterior, ofrece actualizarlas. */
  async function avisarInstruccionesViejas(): Promise<void> {
    const cwd = root(vscode.window.activeTextEditor?.document);
    if (!cwd) return;
    const md = path.join(cwd, "CLAUDE.md");
    if (!fs.existsSync(md)) return;
    const txt = fs.readFileSync(md, "utf8");
    if (!/<!-- (cai|aicode):inicio -->/.test(txt) || /<!-- cai:version 0\.9 -->/.test(txt)) return;
    const op = await vscode.window.showInformationMessage(
      "ComplementAIry: las instrucciones de Claude Code de este proyecto (CLAUDE.md) son de una versión anterior; pueden pedirle comentarios @guia que el modo notas bloquea. ¿Actualizarlas? (solo la sección de ComplementAIry)",
      "Actualizar",
      "Ahora no",
    );
    if (op === "Actualizar") await correr(["init", cwd, "--solo-claude"], cwd).then((o) => vscode.window.setStatusBarMessage(`ComplementAIry: ${o.split("\n").pop()}`, 6000), mostrarError);
  }
  new Rapidas(notas).registrar(ctx);
  registrarConfiguracion(ctx);

  const vistaActual = () => {
    const cwd = root(vscode.window.activeTextEditor?.document);
    return cwd ? vista(cwd) : "notas";
  };
  // Ctrl+Alt+G: en modo notas, preguntar sobre la selección/línea; en modo comentarios, responder los @ia? del archivo.
  reg("cai.guia", () => (vistaActual() === "notas" ? vscode.commands.executeCommand("cai.preguntar") : onFile("guia", "respondiendo tus @ia?")));
  reg("cai.responderIa", () => onFile("guia", "respondiendo tus @ia?"));
  reg("cai.revisar", async () => {
    const ed = vscode.window.activeTextEditor;
    const cwd = root(ed?.document);
    if (!ed || !cwd) return;
    // Revisión pedida por ti, COMPLETA y en segundo plano (puedes irte a otro archivo o revisar otro a la vez):
    // revisores a ciegas + "¿quedó lista?" de cada función (con otra mirada) + tests + veredicto del archivo.
    if (vista(cwd) === "notas") return revisarEnFondo(ed.document, "completa");
    // Modo comentarios: los comentarios se aplican sobre el texto del editor (no en disco).
    try {
      const msg = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "ComplementAIry: revisando…" }, () => revisarConEdiciones(ed, cwd));
      vscode.window.setStatusBarMessage(`ComplementAIry: ${msg}`, 8000);
    } catch (e) {
      mostrarError(e);
    }
  });
  ctx.subscriptions.push(vscode.commands.registerCommand("cai.plano", async (uri?: unknown) => {
    const u = uri instanceof vscode.Uri ? uri : typeof uri === "string" ? vscode.Uri.parse(uri) : undefined;
    const doc = u ? await vscode.workspace.openTextDocument(u) : vscode.window.activeTextEditor?.document;
    const cwd = root(doc);
    if (!doc || !cwd) return;
    await guardar(doc);
    try {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "ComplementAIry: armando el plano del archivo…" }, () => run(["plano", "--archivo", doc.uri.fsPath], cwd));
      vscode.window.setStatusBarMessage("ComplementAIry: plano listo (resumen arriba del archivo, notas en cada función y tareas en el panel)", 8000);
    } catch (e) {
      mostrarError(e);
    }
  }));
  reg("cai.predecir", () => onFile("predecir", "preparando preguntas"));
  reg("cai.check", () => onFile("check", "comprobando predicciones"));
  reg("cai.limpiar", async () => {
    const ed = vscode.window.activeTextEditor;
    const cwd = root(ed?.document);
    if (!ed || !cwd) return;
    await guardar(ed.document);
    try {
      const out = await run(["guia", "clean", ed.document.uri.fsPath], cwd, "limpiando");
      vscode.window.setStatusBarMessage(`ComplementAIry: ${out.split("\n").pop()}`, 5000);
    } catch (e) {
      mostrarError(e);
    }
  });
  reg("cai.snippet", async () => {
    const ed = vscode.window.activeTextEditor;
    const cwd = root(ed?.document);
    if (!ed || !cwd || ed.selection.isEmpty) return void vscode.window.showWarningMessage("ComplementAIry: seleccioná el código que repetís.");
    const nombre = await vscode.window.showInputBox({ prompt: "Nombre del snippet (lo escribís + Tab para usarlo)", validateInput: (v) => (/^[\w-]+$/.test(v) ? null : "Solo letras, números, - y _") });
    if (!nombre) return;
    await guardar(ed.document);
    const a = ed.selection.start.line + 1;
    const b = ed.selection.end.character === 0 && ed.selection.end.line > ed.selection.start.line ? ed.selection.end.line : ed.selection.end.line + 1;
    try {
      await run(["snippet", "nuevo", nombre, "--archivo", ed.document.uri.fsPath, "--lineas", `${a}-${b}`], cwd, "creando snippet");
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(vscode.Uri.file(cwd), ".vscode", "cai.code-snippets"));
      await vscode.window.showTextDocument(doc, { preview: false });
      vscode.window.showInformationMessage("Snippet creado. Reemplazá lo que cambia cada vez por ${1:nombre}, ${2:otro}…");
    } catch (e) {
      mostrarError(e);
    }
  });
  reg("cai.explica", async () => {
    const ed = vscode.window.activeTextEditor;
    const sel = ed?.document.getText(ed.selection).trim() || (await vscode.window.showInputBox({ prompt: "Comando a explicar (no se ejecuta)" }));
    const cwd = root(ed?.document);
    if (!sel || !cwd) return;
    try {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "ComplementAIry: explicando…" }, () => run(["explica", "--", sel], cwd, "explicando"));
      output.show(true);
    } catch (e) {
      mostrarError(e);
    }
  });
  reg("cai.perfil", async () => {
    const cwd = root(vscode.window.activeTextEditor?.document) ?? process.cwd();
    try {
      await run(["perfil"], cwd, "perfil");
      output.show(true);
    } catch (e) {
      mostrarError(e);
    }
  });

  reg("cai.expandir", async () => {
    const ed = vscode.window.activeTextEditor;
    const cwd = root(ed?.document);
    if (!ed || !cwd) return;
    await guardar(ed.document);
    const file = ed.document.uri.fsPath;
    const linea = ed.selection.active.line + 1;
    try {
      const exps = JSON.parse(await run(["expandir", file, "--linea", String(linea), "--vscode"], cwd, "expandiendo")) as { desde: number; hasta: number; texto: string; nombre: string }[];
      if (exps.length) {
        // Reemplaza el comentario por el snippet real, con los huecos para completar con Tab.
        const e = exps[0]!;
        const first = ed.document.lineAt(e.desde - 1);
        const range = new vscode.Range(first.range.start.translate(0, first.firstNonWhitespaceCharacterIndex), ed.document.lineAt(e.hasta - 1).range.end);
        await ed.insertSnippet(new vscode.SnippetString(e.texto), range);
        vscode.window.setStatusBarMessage(`ComplementAIry: snippet ${e.nombre}`, 4000);
        return;
      }
      // Sin pedido en esta línea: elegir de la biblioteca (tuyos primero).
      const lib = JSON.parse(await run(["snippet", "lista", file, "--json"], cwd, "biblioteca")) as { nombre: string; descripcion: string; origen: string; body: string }[];
      const pick = await vscode.window.showQuickPick(
        lib.map((x) => ({ label: x.nombre, description: x.descripcion, detail: x.origen === "base" ? "base" : `tuyo (${x.origen})`, body: x.body })),
        { placeHolder: "Snippet a insertar (crea los tuyos con Ctrl+Alt+S)" },
      );
      if (pick) await ed.insertSnippet(new vscode.SnippetString(pick.body));
    } catch (e) {
      mostrarError(e);
    }
  });

  // Acompañante: al guardar, en segundo plano. Cuidado con el autoguardado: Ctrl+S actúa enseguida;
  // un autoguardado espera a que dejes de editar (acompanar.esperaAutoguardado, 45 s) y corre UNA vez.
  const motivos = new Map<string, vscode.TextDocumentSaveReason>();
  const asentados = new Map<string, NodeJS.Timeout>();
  const programarAsentado = (doc: vscode.TextDocument) => {
    const k = doc.uri.toString();
    clearTimeout(asentados.get(k));
    const cwd = root(doc);
    const espera = (cwd ? leerConfig(cwd).acompanar?.esperaAutoguardado : undefined) ?? 45;
    asentados.set(
      k,
      setTimeout(() => {
        asentados.delete(k);
        if (!doc.isClosed) acompanarAhora(doc, "asentado");
      }, Math.max(5, espera) * 1000),
    );
  };
  ctx.subscriptions.push(
    vscode.workspace.onWillSaveTextDocument((e) => motivos.set(e.document.uri.toString(), e.reason)),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      const motivo = motivos.get(doc.uri.toString()) ?? vscode.TextDocumentSaveReason.Manual;
      motivos.delete(doc.uri.toString());
      // Los guardados que hace la extensión antes de un pedido tuyo no disparan el acompañante.
      if (guardadoPropio(doc)) return;
      if (motivo === vscode.TextDocumentSaveReason.Manual) {
        clearTimeout(asentados.get(doc.uri.toString()));
        asentados.delete(doc.uri.toString());
        acompanarAhora(doc, "manual");
      } else programarAsentado(doc);
    }),
    // Si sigues escribiendo, la espera vuelve a empezar.
    vscode.workspace.onDidChangeTextDocument((e) => e.contentChanges.length && asentados.has(e.document.uri.toString()) && programarAsentado(e.document)),
    // Al cambiar de archivo, lo pendiente del anterior corre ya (terminaste ahí, por ahora).
    vscode.window.onDidChangeActiveTextEditor((ed) => {
      // Pasar a un panel (Nota, terminal, salida) no cuenta como cambiar de archivo.
      if (!ed) return;
      for (const [k, t] of asentados)
        if (k !== ed?.document.uri.toString()) {
          clearTimeout(t);
          asentados.delete(k);
          const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === k);
          if (doc && !doc.isDirty) acompanarAhora(doc, "asentado");
        }
    }),
    { dispose: () => asentados.forEach((t) => clearTimeout(t)) },
  );
  function acompanarAhora(doc: vscode.TextDocument, motivo: "manual" | "asentado"): void {
    probarAlGuardar(doc);
    {
      if (!vscode.workspace.getConfiguration("cai").get<boolean>("acompanar", true) || silenciado()) return;
      const cwd = root(doc);
      const file = doc.uri.fsPath;
      if (!cwd || doc.uri.scheme !== "file" || /[\\/](\.cai|\.aicode|\.claude|node_modules|\.git)[\\/]/.test(file)) return;
      execFile("sh", ["-c", `${cli()} acompanar ${shq(file)} --json --motivo ${motivo}`], { cwd, maxBuffer: 16 << 20, env: { ...process.env, CLAUDE_PROJECT_DIR: cwd } }, (err, stdout, stderr) => {
        if (err) {
          output.appendLine(`acompañante: ${stderr || err.message}`);
          return;
        }
        try {
          const r = JSON.parse(stdout) as { acciones: { tipo: string; detalle: string }[]; pendiente?: boolean };
          if (r.pendiente) return void vscode.window.setStatusBarMessage("ComplementAIry: sigo con lo anterior; reviso este guardado al terminar", 5000);
          const enNotas = vista(cwd) === "notas";
          const msgs: Record<string, string> = {
            expandido: "snippet expandido",
            respondido: enNotas ? "respondí en las notas" : "respondí tus @ia?",
            "plano-proyecto": "te dejé una propuesta de arquitectura en docs/ESTRUCTURA.md",
            "plano-archivo": enNotas ? "te dejé el plano de este archivo (notas + tareas)" : "te dejé el plano de este archivo",
            ayuda: "vi que esta parte te está costando: te dejé una pista",
            comentario: enNotas ? "te dejé notas sobre lo que terminaste" : "te dejé comentarios sobre lo que terminaste",
            diseno: "te dejé una sugerencia de diseño",
            "sin-tests": "esta función no tiene tests (botón 🧪 Tests)",
            resuelto: "¡resuelto!",
            impacto: "⚠ cambió una función que otras usan (mira sus notas)",
          };
          const ESTADOS: Record<string, string> = { lista: "🟢 lista", casi: "🟡 casi lista", falta: "🔴 falta" };
          const txt = r.acciones
            .map((a) => (a.tipo === "impacto" ? `⚠ ${a.detalle}` : a.tipo === "verificado" ? a.detalle.replace(/: (lista|casi|falta)$/, (_, e: string) => ` ${ESTADOS[e]}`) : (msgs[a.tipo] ?? a.tipo)))
            .join(" · ");
          if (txt) vscode.window.setStatusBarMessage(`ComplementAIry: ${txt}`, 8000);
          if (r.acciones.some((a) => a.tipo === "plano-proyecto"))
            vscode.window.showInformationMessage("ComplementAIry: te dejé una propuesta de estructura del proyecto (panel → Proyecto → Estructura). Lo que falta crear está en tus tareas.", "Abrir").then(async (v) => {
              if (v) await vscode.commands.executeCommand("cai.verEstructura");
            });
        } catch {
          output.appendLine(`acompañante: salida inesperada: ${stdout.slice(0, 200)}`);
        }
      });
    }
  }

  /**
   * Al guardar (Ctrl+S, o con autoguardado cuando dejas de editar): se vuelven a probar los casos de
   * test de las funciones de ese archivo, sin IA. El resultado queda en la nota de cada función.
   */
  function probarAlGuardar(doc: vscode.TextDocument): void {
    const cwd = root(doc);
    if (!cwd || doc.uri.scheme !== "file" || leerConfig(cwd).tests?.alGuardar === false) return;
    correr(["tests", doc.uri.fsPath, "--recorrer", "--json"], cwd, { silencioso: true })
      .then((out) => {
        const r = JSON.parse(out) as { funciones: { funcion: string; pasan: number; fallan: number }[] };
        if (!r.funciones.length) return;
        const pasan = r.funciones.reduce((a, f) => a + f.pasan, 0);
        const fallan = r.funciones.reduce((a, f) => a + f.fallan, 0);
        const malas = r.funciones.filter((f) => f.fallan).map((f) => f.funcion);
        vscode.window.setStatusBarMessage(`🧪 ${pasan} ✅ · ${fallan} ❌${malas.length ? ` (falla: ${malas.join(", ")})` : ""}`, 10_000);
      })
      .catch(() => undefined);
  }

  const abrir = async (cwd: string, ...partes: string[]) => {
    for (const dir of [".cai", ".aicode"]) {
      const uri = vscode.Uri.joinPath(vscode.Uri.file(cwd), dir, ...partes);
      try {
        await vscode.workspace.fs.stat(uri);
        // panorama.md se lee (vista previa); conocimiento.md se edita (texto).
        if (partes.at(-1) === "panorama.md") await vscode.commands.executeCommand("markdown.showPreview", uri);
        else await vscode.window.showTextDocument(uri, { preview: false });
        return;
      } catch {
        /* probar la otra carpeta */
      }
    }
  };
  reg("cai.panorama", async () => {
    const cwd = root(vscode.window.activeTextEditor?.document);
    if (!cwd) return;
    try {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "ComplementAIry: mirando el proyecto completo…" }, () => run(["panorama"], cwd, "panorama"));
      await abrir(cwd, "panorama.md");
    } catch (e) {
      mostrarError(e);
    }
  });
  reg("cai.conocimiento", async () => {
    const cwd = root(vscode.window.activeTextEditor?.document);
    if (cwd) await abrir(cwd, "conocimiento.md");
  });
  reg("cai.tests", async () => {
    const ed = vscode.window.activeTextEditor;
    const cwd = root(ed?.document);
    if (!ed || !cwd) return;
    // La función bajo el cursor: la última "function nombre" / "const nombre =" antes de la línea.
    const antes = ed.document.getText(new vscode.Range(0, 0, ed.selection.active.line + 1, 0));
    const m = [...antes.matchAll(/(?:function\s+|const\s+|def\s+)([A-Za-z_$][\w$]*)/g)].pop();
    await guardar(ed.document);
    try {
      const out = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "ComplementAIry: proponiendo casos de prueba…" }, () =>
        run(["tests", ed.document.uri.fsPath, ...(m ? [m[1]!] : [])], cwd, "tests"),
      );
      const archivo = /en (\S+\.(?:test\.\w+|py))/.exec(out)?.[1];
      if (archivo) await vscode.window.showTextDocument(vscode.Uri.joinPath(vscode.Uri.file(cwd), archivo), { preview: false });
    } catch (e) {
      mostrarError(e);
    }
  });

  reg("cai.buscarActualizacion", () => revisarActualizacion(ctx, true));
  void revisarActualizacion(ctx, false);

  decorate(vscode.window.activeTextEditor);
  ctx.subscriptions.push(
    output,
    vscode.window.onDidChangeActiveTextEditor(decorate),
    vscode.workspace.onDidChangeTextDocument((e) => {
      const ed = vscode.window.activeTextEditor;
      if (ed && e.document === ed.document) decorate(ed);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration("cai")) return;
      envVista();
      decorate(vscode.window.activeTextEditor);
    }),
  );
}

// --- Aviso de versión nueva (consulta el último release del repositorio de GitHub) ------

function esMayor(a: string, b: string): boolean {
  const pa = a.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}

async function revisarActualizacion(ctx: vscode.ExtensionContext, aPedido: boolean): Promise<void> {
  const pkg = ctx.extension.packageJSON as { version: string; repository?: string | { url?: string } };
  const url = typeof pkg.repository === "string" ? pkg.repository : (pkg.repository?.url ?? "");
  const repo = /github\.com[/:]([^/]+)\/([^/.#]+)/.exec(url);
  if (!repo) {
    if (aPedido) vscode.window.showInformationMessage("ComplementAIry: esta versión no viene de un release de GitHub; no hay dónde buscar actualizaciones.");
    return;
  }
  if (!aPedido) {
    if (!vscode.workspace.getConfiguration("cai").get<boolean>("avisarActualizaciones", true)) return;
    const ultima = ctx.globalState.get<number>("cai.ultimaRevision") ?? 0;
    if (Date.now() - ultima < 6 * 3600_000) return;
  }
  await ctx.globalState.update("cai.ultimaRevision", Date.now());
  try {
    const r = await fetch(`https://api.github.com/repos/${repo[1]}/${repo[2]}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "complementairy" },
    });
    if (!r.ok) {
      if (aPedido) vscode.window.showWarningMessage(`ComplementAIry: no pude consultar GitHub (${r.status}): todavía no hay releases publicados o el repositorio es privado.`);
      return;
    }
    const rel = (await r.json()) as { tag_name: string; html_url: string };
    const nueva = rel.tag_name.replace(/^v/, "");
    if (!esMayor(nueva, pkg.version)) {
      if (aPedido) vscode.window.showInformationMessage(`ComplementAIry está al día (${pkg.version}).`);
      return;
    }
    if (!aPedido && ctx.globalState.get<string>("cai.omitida") === nueva) return;
    const op = await vscode.window.showInformationMessage(
      `ComplementAIry ${nueva} está disponible (tienes ${pkg.version}). Se actualiza al reconstruir el contenedor.`,
      "Reconstruir ahora",
      "Ver cambios",
      "Omitir esta versión",
    );
    if (op === "Reconstruir ahora") await vscode.commands.executeCommand("remote-containers.rebuildContainer");
    else if (op === "Ver cambios") await vscode.env.openExternal(vscode.Uri.parse(rel.html_url));
    else if (op === "Omitir esta versión") await ctx.globalState.update("cai.omitida", nueva);
  } catch (e) {
    if (aPedido) vscode.window.showWarningMessage(`ComplementAIry: no pude buscar actualizaciones (${(e as Error).message}).`);
  }
}

export function deactivate(): void {}
