#!/usr/bin/env node
// Source boundaries (#335): the backend never imports the frontend. Files in
// server/ and shared/ may import shared/, node built-ins and npm packages;
// shared/ additionally stays free of three and the DOM so it loads unchanged
// in the browser (GitHub Pages) and in Node (room server, tools). client/ and
// tools/ may import anything. Exits 1 on the first broken rule.
//
//   node tools/check-boundaries.mjs
import fs from "node:fs";
import path from "node:path";

const CORE = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const IMPORT = /\b(?:import|export)\s[^"']*?from\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;
const problems = [];

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sources(full);
    return /\.m?js$/.test(e.name) ? [full] : [];
  });
}

for (const layer of ["server", "shared"]) {
  for (const file of sources(path.join(CORE, layer))) {
    const rel = path.relative(CORE, file);
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(IMPORT)) {
      const spec = (m[1] || m[2]).split("?")[0];
      if (spec.startsWith(".")) {
        const target = path.relative(CORE, path.resolve(path.dirname(file), spec));
        if (target.startsWith(`client${path.sep}`)) problems.push(`${rel} imports ${target}`);
        if (layer === "shared" && !target.startsWith(`shared${path.sep}`)) problems.push(`${rel} imports ${target} (shared/ imports only shared/)`);
      } else if (layer === "shared" && !spec.startsWith("node:")) {
        problems.push(`${rel} imports package "${spec}" (shared/ has no dependencies)`);
      }
    }
    if (layer === "shared" && /\b(?:document|window)\./.test(text)) problems.push(`${rel} touches the DOM`);
  }
}

if (problems.length) {
  console.error(`boundaries: ${problems.length} problem(s)\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log("boundaries: ok (server/ and shared/ never import client/)");
