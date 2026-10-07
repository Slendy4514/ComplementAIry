import { execFile } from "node:child_process";
import * as vscode from "vscode";

/**
 * Capa fina sobre la CLI `aicode`: atajos, progreso y resaltado. Toda la lógica (y todas
 * las garantías) están en la CLI; la extensión solo la invoca sobre el archivo abierto.
 */

let output: vscode.OutputChannel;
let status: vscode.StatusBarItem;

function cli(): string {
  return vscode.workspace.getConfiguration("aicode").get<string>("comando", "aicode");
}

function root(doc?: vscode.TextDocument): string | undefined {
  const folder = doc ? vscode.workspace.getWorkspaceFolder(doc.uri) : vscode.workspace.workspaceFolders?.[0];
  return folder?.uri.fsPath;
}

const shq = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

function run(args: string[], cwd: string, titulo: string): Promise<string> {
  output.appendLine(`$ ${cli()} ${args.join(" ")}`);
  status.text = `$(sync~spin) AICode: ${titulo}`;
  status.show();
  return new Promise((resolve, reject) => {
    execFile("sh", ["-c", `${cli()} ${args.map(shq).join(" ")}`], { cwd, maxBuffer: 16 << 20, env: { ...process.env, CLAUDE_PROJECT_DIR: cwd } }, (err, stdout, stderr) => {
      status.hide();
      output.append(stdout);
      if (stderr) output.append(stderr);
      if (err && !stdout.trim()) reject(new Error(stderr.trim() || err.message));
      else resolve(stdout.trim());
    });
  });
}

async function onFile(cmd: string, titulo: string, extra: string[] = []): Promise<void> {
  const ed = vscode.window.activeTextEditor;
  if (!ed) return void vscode.window.showWarningMessage("AICode: abrí un archivo primero.");
  const cwd = root(ed.document);
  if (!cwd) return void vscode.window.showWarningMessage("AICode: el archivo no está dentro de un proyecto abierto.");
  if (ed.document.isDirty) await ed.document.save();
  try {
    const out = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `AICode: ${titulo}…`, cancellable: false },
      () => run([cmd, ed.document.uri.fsPath, ...extra], cwd, titulo),
    );
    const resumen = out.split("\n").filter((l) => /^[✓✗!]/.test(l.trim())).slice(-2).join(" · ");
    vscode.window.setStatusBarMessage(`AICode: ${resumen || "listo"}`, 6000);
  } catch (e) {
    vscode.window.showErrorMessage(`AICode: ${(e as Error).message}`, "Ver salida").then((v) => v && output.show());
  }
}

// --- Resaltado --------------------------------------------------------------------

const guiaDeco = vscode.window.createTextEditorDecorationType({ backgroundColor: new vscode.ThemeColor("aicode.guiaFondo"), isWholeLine: true });
const humanoDeco = vscode.window.createTextEditorDecorationType({ backgroundColor: new vscode.ThemeColor("aicode.humanoFondo"), isWholeLine: true });
const bloqDeco = vscode.window.createTextEditorDecorationType({
  borderWidth: "0 0 0 3px",
  borderStyle: "solid",
  borderColor: new vscode.ThemeColor("aicode.bloqueante"),
  isWholeLine: true,
});

function decorate(ed: vscode.TextEditor | undefined): void {
  if (!ed) return;
  if (!vscode.workspace.getConfiguration("aicode").get<boolean>("resaltar", true)) {
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
  output = vscode.window.createOutputChannel("AICode");
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  const reg = (id: string, fn: () => unknown) => ctx.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg("aicode.guia", () => onFile("guia", "respondiendo tus @ia?"));
  reg("aicode.revisar", () => onFile("revisar", "revisando"));
  reg("aicode.predecir", () => onFile("predecir", "preparando preguntas"));
  reg("aicode.check", () => onFile("check", "comprobando predicciones"));
  reg("aicode.limpiar", async () => {
    const ed = vscode.window.activeTextEditor;
    const cwd = root(ed?.document);
    if (!ed || !cwd) return;
    if (ed.document.isDirty) await ed.document.save();
    const out = await run(["guia", "clean", ed.document.uri.fsPath], cwd, "limpiando");
    vscode.window.setStatusBarMessage(`AICode: ${out.split("\n").pop()}`, 5000);
  });
  reg("aicode.snippet", async () => {
    const ed = vscode.window.activeTextEditor;
    const cwd = root(ed?.document);
    if (!ed || !cwd || ed.selection.isEmpty) return void vscode.window.showWarningMessage("AICode: seleccioná el código que repetís.");
    const nombre = await vscode.window.showInputBox({ prompt: "Nombre del snippet (lo escribís + Tab para usarlo)", validateInput: (v) => (/^[\w-]+$/.test(v) ? null : "Solo letras, números, - y _") });
    if (!nombre) return;
    if (ed.document.isDirty) await ed.document.save();
    const a = ed.selection.start.line + 1;
    const b = ed.selection.end.character === 0 && ed.selection.end.line > ed.selection.start.line ? ed.selection.end.line : ed.selection.end.line + 1;
    try {
      await run(["snippet", "nuevo", nombre, "--archivo", ed.document.uri.fsPath, "--lineas", `${a}-${b}`], cwd, "creando snippet");
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(vscode.Uri.file(cwd), ".vscode", "aicode.code-snippets"));
      await vscode.window.showTextDocument(doc, { preview: false });
      vscode.window.showInformationMessage("Snippet creado. Reemplazá lo que cambia cada vez por ${1:nombre}, ${2:otro}…");
    } catch (e) {
      vscode.window.showErrorMessage(`AICode: ${(e as Error).message}`);
    }
  });
  reg("aicode.explica", async () => {
    const ed = vscode.window.activeTextEditor;
    const sel = ed?.document.getText(ed.selection).trim() || (await vscode.window.showInputBox({ prompt: "Comando a explicar (no se ejecuta)" }));
    const cwd = root(ed?.document);
    if (!sel || !cwd) return;
    const out = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "AICode: explicando…" }, () => run(["explica", "--", sel], cwd, "explicando"));
    output.show(true);
    void out;
  });
  reg("aicode.perfil", async () => {
    const cwd = root(vscode.window.activeTextEditor?.document) ?? process.cwd();
    await run(["perfil"], cwd, "perfil");
    output.show(true);
  });

  reg("aicode.expandir", async () => {
    const ed = vscode.window.activeTextEditor;
    const cwd = root(ed?.document);
    if (!ed || !cwd) return;
    if (ed.document.isDirty) await ed.document.save();
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
        vscode.window.setStatusBarMessage(`AICode: snippet ${e.nombre}`, 4000);
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
      vscode.window.showErrorMessage(`AICode: ${(e as Error).message}`);
    }
  });

  // Acompañante: al guardar, en segundo plano (uno a la vez por archivo).
  const enCurso = new Set<string>();
  ctx.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (!vscode.workspace.getConfiguration("aicode").get<boolean>("acompanar", true)) return;
      const cwd = root(doc);
      const file = doc.uri.fsPath;
      if (!cwd || enCurso.has(file) || /[\\/](\.aicode|\.claude|node_modules|\.git)[\\/]/.test(file)) return;
      enCurso.add(file);
      status.text = "$(eye) AICode";
      status.show();
      execFile("sh", ["-c", `${cli()} acompanar ${shq(file)} --json`], { cwd, maxBuffer: 16 << 20, env: { ...process.env, CLAUDE_PROJECT_DIR: cwd } }, (err, stdout, stderr) => {
        enCurso.delete(file);
        status.hide();
        if (err) {
          output.appendLine(`acompañante: ${stderr || err.message}`);
          return;
        }
        try {
          const r = JSON.parse(stdout) as { acciones: { tipo: string; detalle: string }[] };
          const msgs: Record<string, string> = {
            expandido: "snippet expandido",
            respondido: "respondí tus @ia?",
            "plano-proyecto": "te dejé una propuesta de arquitectura en docs/ESTRUCTURA.md",
            "plano-archivo": "te dejé el plano de este archivo",
            ayuda: "vi que esta parte te está costando: te dejé una pista",
            resuelto: "¡resuelto!",
          };
          const txt = r.acciones.map((a) => msgs[a.tipo] ?? a.tipo).join(" · ");
          if (txt) vscode.window.setStatusBarMessage(`AICode: ${txt}`, 8000);
          if (r.acciones.some((a) => a.tipo === "plano-proyecto"))
            vscode.window.showInformationMessage("AICode: te dejé una propuesta de arquitectura.", "Abrir").then(async (v) => {
              if (v) await vscode.window.showTextDocument(vscode.Uri.joinPath(vscode.Uri.file(cwd), "docs", "ESTRUCTURA.md"));
            });
        } catch {
          output.appendLine(`acompañante: salida inesperada: ${stdout.slice(0, 200)}`);
        }
      });
    }),
  );

  decorate(vscode.window.activeTextEditor);
  ctx.subscriptions.push(
    output,
    status,
    vscode.window.onDidChangeActiveTextEditor(decorate),
    vscode.workspace.onDidChangeTextDocument((e) => {
      const ed = vscode.window.activeTextEditor;
      if (ed && e.document === ed.document) decorate(ed);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration("aicode") && decorate(vscode.window.activeTextEditor)),
  );
}

export function deactivate(): void {}
