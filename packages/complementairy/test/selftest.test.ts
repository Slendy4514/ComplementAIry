import { expect, test } from "vitest";
import { correrEscenario, escenarios } from "../src/selftest.js";

// Un test por escenario: vitest muestra cuál falló, por qué y cuánto tardó. Filtrar: CAI_SELFTEST="texto".
for (const c of escenarios(process.env.CAI_SELFTEST))
  test(c.name, async () => {
    const r = await correrEscenario(c);
    expect(r.error ?? "", "el escenario lanzó un error").toBe("");
    expect(r.ok, "el escenario devolvió false (usa esperar() para decir qué se esperaba)").toBe(true);
  }, 30_000);
