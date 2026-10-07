import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Zoner } from "./config.js";

/** Archivos del proyecto (relativos, con /). Usa git si hay repo (respeta .gitignore). */
export function listFiles(z: Zoner): string[] {
  let files: string[];
  try {
    const out = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
      cwd: z.root,
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 256 * 1024 * 1024,
    });
    files = out.toString("utf8").split("\0").filter(Boolean);
  } catch {
    files = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(path.join(z.root, dir), { withFileTypes: true })) {
        const r = dir ? `${dir}/${e.name}` : e.name;
        if (z.isIgnored(r) || z.isIgnored(r + "/x")) continue;
        if (e.isDirectory()) walk(r);
        else if (e.isFile()) files.push(r);
      }
    };
    walk("");
  }
  return files.filter((f) => !z.isIgnored(f));
}

