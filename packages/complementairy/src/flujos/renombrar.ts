/**
 * Refactor mecánico con una HERRAMIENTA determinista (Plan C 8.2): renombrar un identificador en todo el
 * proyecto con tree-sitter (no con la IA). Como lo hace una herramienta verificable, las líneas cambiadas
 * quedan con origen "herramienta" y no necesitan revisión línea por línea: solo tu decisión de renombrar.
 *
 * Garantía: el resultado es el original con ese identificador reemplazado, nada más (se verifica deshaciendo
 * el reemplazo y comparando). Si el nombre nuevo ya existe, se rechaza (evita capturar otra variable).
 */
import fs from "node:fs";
import path from "node:path";
import picomatch from "picomatch";
import { makeZoner } from "../proyecto/config.js";
import { listFiles } from "../proyecto/files.js";
import { langFor } from "../nucleo/lang.js";
import { getParser, type SyntaxNode } from "../nucleo/parser.js";
import { asentar } from "../proyecto/procedencia.js";

const IDENT = /^(identifier|property_identifier|shorthand_property_identifier|shorthand_property_identifier_pattern|type_identifier)$/;

async function ocurrencias(src: string, grammar: string, nombre: string): Promise<{ inicio: number; fin: number }[]> {
  const parser = await getParser(grammar);
  const tree = parser.parse(src);
  if (!tree) return [];
  const out: { inicio: number; fin: number }[] = [];
  const visitar = (n: SyntaxNode) => {
    if (IDENT.test(n.type) && n.text === nombre) out.push({ inicio: n.startIndex, fin: n.endIndex });
    for (const c of n.children) if (c) visitar(c);
  };
  visitar(tree.rootNode);
  tree.delete();
  return out;
}

/** Índices de UTF-16 de tree-sitter en JS: web-tree-sitter usa offsets de string JS. */
const reemplazar = (src: string, oc: { inicio: number; fin: number }[], por: string) => {
  let out = src;
  for (const o of [...oc].sort((a, b) => b.inicio - a.inicio)) out = out.slice(0, o.inicio) + por + out.slice(o.fin);
  return out;
};

export async function renombrar(root: string, viejo: string, nuevo: string, o: { en?: string } = {}): Promise<{ archivos: { archivo: string; cambios: number }[] }> {
  if (!/^[A-Za-z_$][\w$]*$/.test(viejo) || !/^[A-Za-z_$][\w$]*$/.test(nuevo)) throw new Error("los nombres tienen que ser identificadores (letras, números, _ o $)");
  const z = makeZoner(root);
  const filtro = o.en ? picomatch(o.en, { dot: true }) : () => true;
  const planes: { rel: string; antes: string; despues: string; n: number }[] = [];
  for (const rel of listFiles(z).filter((f) => filtro(f))) {
    const lang = langFor(rel);
    if (!lang?.grammar || !["typescript", "tsx", "javascript", "python"].includes(lang.id)) continue;
    if (z.zoneOf(path.join(root, rel)) === "protegida") continue;
    const antes = fs.readFileSync(path.join(root, rel), "utf8");
    if (!antes.includes(viejo)) continue;
    if ((await ocurrencias(antes, lang.grammar, nuevo)).length) throw new Error(`${nuevo} ya existe en ${rel}: renombrar ahí podría capturar otra variable. Elige otro nombre`);
    const oc = await ocurrencias(antes, lang.grammar, viejo);
    if (!oc.length) continue;
    const despues = reemplazar(antes, oc, nuevo);
    // Verificación: deshacer el reemplazo devuelve exactamente el original.
    const vuelta = reemplazar(despues, await ocurrencias(despues, lang.grammar, nuevo), viejo);
    if (vuelta !== antes) throw new Error(`no pude verificar el renombre en ${rel}: lo dejo sin tocar`);
    if (z.isRoja(path.join(root, rel))) throw new Error(`${rel} es línea roja: renómbralo tú a mano`);
    planes.push({ rel, antes, despues, n: oc.length });
  }
  for (const p of planes) {
    asentar(root, p.rel, p.antes, { origen: "humano" });
    fs.writeFileSync(path.join(root, p.rel), p.despues);
    asentar(root, p.rel, p.despues, { origen: "herramienta", autor: `renombrar ${viejo}→${nuevo}` });
  }
  return { archivos: planes.map((p) => ({ archivo: p.rel, cambios: p.n })) };
}
