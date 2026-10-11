import { expect, test } from "vitest";
import { correrEscenario, escenarios, type Case } from "../../src/cli/selftest.js";

/** Área de cada escenario del selftest (el primero que coincide; lo demás va a "otros"). */
const AREAS: [string, RegExp][] = [
  ["garantias", /\[seg\]|\bhook\b|\bbash\b|snapshot|cuarentena|zona|protegid|solo comentarios|symlink|directiv/i],
  ["programar", /programar|construir|porci[oó]n|repertorio|orden|probador/i],
  ["pruebas", /\btests?\b|predic|sandbox|\bgate\b|mutaci|aislad|check/i],
  ["notas", /\bnota|responder|verificar|qued[oó] lista|r[aá]pida|gu[ií]a l[ií]nea/i],
  ["proyecto", /panorama|plano|decisi|chat|entender|idea|tarea|[ií]ndice|memoria|estructura|conocer|correcci|objetivo|sesi[oó]n|hoy|deuda/i],
  ["guia", /gu[ií]a|tutor|@ia|escal|pista|snippet|acompa|perfil|modo/i],
];

export function areaDe(nombre: string): string {
  return AREAS.find(([, re]) => re.test(nombre))?.[0] ?? "otros";
}

export function correrArea(area: string): void {
  const lista: Case[] = escenarios(process.env.CAI_SELFTEST).filter((c) => areaDe(c.name) === area);
  if (!lista.length) test.skip(`(sin escenarios de ${area})`, () => {});
  for (const c of lista)
    test(c.name, async () => {
      const r = await correrEscenario(c);
      expect(r.error ?? "", "el escenario lanzó un error").toBe("");
      expect(r.ok, "el escenario devolvió false (usa esperar() para decir qué se esperaba)").toBe(true);
    }, 30_000);
}
