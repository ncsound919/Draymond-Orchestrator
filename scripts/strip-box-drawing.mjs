#!/usr/bin/env node
// Strip box-drawing chars that crash Next 16.3 Turbopack's code-frame renderer.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";

const ROOTS = ["src", "scripts"];
const SKIP = new Set(["node_modules", ".next", ".git", "data", "agents"]);
const EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css", ".scss", ".json", ".md", ".mdx"]);
// Only the chars that actually trigger the panic per the Next 16.3 trace.
const BAD = /[------------------------------------------]/g;

let changed = 0;
for (const root of ROOTS) {
  function walk(dir) {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      const s = statSync(p);
      if (s.isDirectory()) {
        if (!SKIP.has(e)) walk(p);
        continue;
      }
      if (!EXTS.has(extname(p))) continue;
      const raw = readFileSync(p, "utf8");
      if (!BAD.test(raw)) continue;
      const fixed = raw.replace(BAD, "-");
      writeFileSync(p, fixed, "utf8");
      changed++;
      console.log(p);
    }
  }
  try { walk(root); } catch (e) { console.error("skip", root, e.message); }
}
console.log("files rewritten:", changed);
