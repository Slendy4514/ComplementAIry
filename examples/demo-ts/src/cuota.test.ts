import { expect, test } from "vitest";
import { calcularCuota } from "./cuota.js";

test("sin interés divide en partes iguales", () => {
  expect(calcularCuota(1200, 0, 12)).toBe(100);
});
