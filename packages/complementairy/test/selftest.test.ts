import { expect, test } from "vitest";
import { runSelftest } from "../src/selftest.js";

test("todas las garantías de ComplementAIry se cumplen", async () => {
  const lines: string[] = [];
  const ok = await runSelftest((s) => lines.push(s));
  expect(lines.filter((l) => l.startsWith("✗"))).toEqual([]);
  expect(ok).toBe(true);
}, 60_000);
