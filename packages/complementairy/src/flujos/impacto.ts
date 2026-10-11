import fs from "node:fs";
import path from "node:path";
import { parse } from "../nucleo/comments.js";
import { leerIndice, actualizarIndice, type EntradaIndice } from "../proyecto/indice.js";
import { langFor } from "../nucleo/lang.js";
import { medir } from "../proyecto/metricas.js";
import { cargarNotas, guardarNotas, mensaje } from "../proyecto/notas.js";
import { notaPara } from "../proyecto/notasFuncion.js";
import { conBloqueo } from "../proyecto/ocupado.js";
import { recorrerCasos } from "./tests.js";

/**
 * Avisos de impacto (sin IA): al guardar, si cambió una función que OTRAS usan, se avisa en las
 * notas de esas funciones ("⚠ cambió normalize, revisa") y se vuelven a probar sus casos de test.
 */
export interface Impacto {
  funcion: string;
  archivo: string;
  afectadas: { archivo: string; clave: string }[];
}

export async function actualizarConImpacto(root: string, rel: string): Promise<Impacto[]> {
  const antes = leerIndice(root).archivos[rel]?.funciones ?? [];
  const idx = await actualizarIndice(root, [rel]);
  const ahora = idx.archivos[rel]?.funciones ?? [];
  const cambiadas = ahora.filter((f) => {
    const previa = antes.find((x) => x.clave === f.clave);
    return previa && previa.huella !== f.huella && f.llamadaPor.length;
  });
  const out: Impacto[] = [];
  for (const f of cambiadas) {
    const afectadas = f.llamadaPor.map((x) => ({ archivo: x.slice(0, x.lastIndexOf(":")), clave: x.slice(x.lastIndexOf(":") + 1) }));
    out.push({ funcion: f.nombre, archivo: rel, afectadas });
  }
  // Las notas de las funciones afectadas avisan (y sus casos de test se vuelven a probar).
  const porArchivo = new Map<string, { clave: string; cambio: EntradaIndice }[]>();
  for (const i of out) for (const a of i.afectadas) porArchivo.set(a.archivo, [...(porArchivo.get(a.archivo) ?? []), { clave: a.clave, cambio: cambiadas.find((c) => c.nombre === i.funcion)! }]);
  for (const [archivo, lista] of porArchivo) {
    await conBloqueo(root, archivo, "avisando impacto", async () => {
      const lang = langFor(archivo);
      const src = fs.readFileSync(path.join(root, archivo), "utf8");
      const notas = cargarNotas(root, archivo, src);
      const funciones = lang ? medir(src, await parse(src, lang)).funciones : [];
      for (const { clave, cambio } of lista) {
        // Si la función que la usa no tenía nota, se crea (si no, el aviso no se vería en ninguna parte).
        const linea = idx.archivos[archivo]?.funciones.find((f) => f.clave === clave)?.linea ?? 1;
        const n = notaPara(notas, archivo, funciones, src, { linea, funcion: clave, origen: "impacto" });
        const ya = (n.impacto ?? []).filter((x) => x.funcion !== cambio.nombre);
        if (!n.hilo.length) n.hilo.push(mensaje("ia", `⚠ \`${cambio.nombre}\` (${rel}) cambió y esta función la usa: revisa que siga funcionando igual.`));
        n.impacto = [...ya, { funcion: cambio.nombre, archivo: rel, fecha: new Date().toISOString() }];
        n.estado = "abierta";
        n.actualizada = new Date().toISOString();
      }
      guardarNotas(root, archivo, notas);
    }).catch(() => undefined);
    if (archivo !== rel) await recorrerCasos(root, archivo).catch(() => undefined);
  }
  return out;
}
