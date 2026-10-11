/**
 * `cai ia evaluar`: se mide, no se supone. Corre un set dorado de casos etiquetados (los de abajo + tus
 * rebates al decisor) contra cada decisor de la cadena y mide acierto, CALIBRACIÓN (Brier: una confianza
 * de 0,9 debería acertar ~90 %) y latencia. Un decisor que no alcanza la precisión mínima queda marcado y
 * la cadena lo salta (~/.cai/evaluaciones.json).
 */
import fs from "node:fs";
import path from "node:path";
import type { Config } from "../proyecto/config.js";
import { home } from "../proyecto/profile.js";
import { escribirJson, leerJson } from "../proyecto/almacen.js";
import { decidirCon, type Caso } from "./decisor.js";
import { comoDato } from "./decisor.js";

export interface CasoDorado {
  texto: string;
  /** Lo que debería responder el decisor. */
  vago: boolean;
  amplio?: boolean;
  temas?: number;
}

export const DORADO: CasoDorado[] = [
  { texto: "haz que el botón de editar alterne", vago: true },
  { texto: "mejora el buscador", vago: true },
  { texto: "arregla eso", vago: true },
  { texto: "que funcione bien el login", vago: true },
  { texto: "optimiza todo el backend y de paso agrega tests a todo", vago: true, amplio: true },
  { texto: "rehaz la aplicación entera en otro framework", vago: false, amplio: true },
  { texto: "Añade un campo booleano `editable` a la tabla `users`, exponlo en `GET /api/users/:id` y renderiza `EditButton` según ese campo", vago: false, amplio: false, temas: 1 },
  { texto: "En src/billing/invoice.ts, calcularTotal debe lanzar un RangeError si el cupón supera el total", vago: false, amplio: false, temas: 1 },
  { texto: "agrega exportar a PDF, arregla que el buscador se cuelga y cambia el color del tema oscuro", vago: false, temas: 3 },
  { texto: "renombra la función `getUsr` a `obtenerUsuario` en src/api/users.ts y actualiza sus llamadas", vago: false, amplio: false, temas: 1 },
  { texto: "que la función slugNota quite tildes, pase a minúsculas y cambie espacios por guiones", vago: false, amplio: false, temas: 1 },
  { texto: "lo que me dijiste antes", vago: true },
];

export interface Evaluacion {
  ref: string;
  fecha: string;
  casos: number;
  acierto: number;
  brier: number;
  msMedio: number;
  aprobado: boolean;
}

const archivo = () => path.join(home(), "evaluaciones.json");
export const cargarEvaluaciones = () => leerJson<Record<string, Evaluacion>>(archivo(), () => ({}));

/** ¿La cadena puede usar este decisor? (sin evaluar = sí; evaluado bajo el mínimo = no). */
export function habilitado(ref: string, min = 0.8): boolean {
  const e = cargarEvaluaciones()[ref];
  return !e || e.acierto >= min;
}

function casosDe(root: string): CasoDorado[] {
  // Tus rebates: si rebatiste un "vago", ese texto NO era vago para ti.
  const f = path.join(root, ".cai", "cache", "rebates.jsonl");
  const propios: CasoDorado[] = [];
  try {
    for (const l of fs.readFileSync(f, "utf8").split("\n").filter(Boolean)) {
      const r = JSON.parse(l) as { que: string; texto: string; motivos: string[] };
      if (r.que === "pedido" && r.motivos.some((m) => /vago/.test(m))) propios.push({ texto: r.texto, vago: false });
    }
  } catch {
    /* sin rebates */
  }
  return [...DORADO, ...propios];
}

export async function evaluar(c: Config, root: string, refs: string[], min = 0.8): Promise<Evaluacion[]> {
  const out: Evaluacion[] = [];
  const casos = casosDe(root);
  for (const ref of refs) {
    let ok = 0;
    let brier = 0;
    let ms = 0;
    let n = 0;
    for (const caso of casos) {
      const q: Caso = {
        estado: `Un programador escribió este pedido para que una IA de programación lo implemente.\n${comoDato("pedido", caso.texto)}`,
        preguntas: { vago: { type: "noul", description: "true si NO dice concretamente qué cambiar, dónde o qué resultado se espera" } },
      };
      const ini = Date.now();
      try {
        const r = await decidirCon(c, ref, q, root);
        ms += Date.now() - ini;
        const v = r.vago;
        if (!v) continue;
        n++;
        const acierto = v.valor === caso.vago;
        if (acierto) ok++;
        const p = v.valor === true ? v.confianza : 1 - v.confianza; // prob. de "vago"
        brier += (p - (caso.vago ? 1 : 0)) ** 2;
      } catch {
        /* no disponible: no cuenta */
      }
    }
    if (!n) continue;
    const e: Evaluacion = { ref, fecha: new Date().toISOString(), casos: n, acierto: ok / n, brier: brier / n, msMedio: Math.round(ms / n), aprobado: ok / n >= min };
    out.push(e);
  }
  const todas = cargarEvaluaciones();
  for (const e of out) todas[e.ref] = e;
  escribirJson(archivo(), todas);
  return out;
}
