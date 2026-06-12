"use strict";
// Regenerates showcase/ — one flagship program (examples/showcase.ml, which the
// test suite also verifies) rendered to every target, so the gallery can never
// drift from what the transpiler actually emits.  Run: node tools/gen-showcase.js
const fs = require("fs");
const path = require("path");
const { transpile, targets, FILE_EXT } = require("../src");

const ROOT = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(ROOT, "examples", "showcase.ml"), "utf8");
const dir = path.join(ROOT, "showcase");
if (!fs.existsSync(dir)) fs.mkdirSync(dir);

fs.writeFileSync(path.join(dir, "showcase.ml"), src);
for (const t of targets) {
  fs.writeFileSync(path.join(dir, `showcase.${FILE_EXT[t]}`), transpile(src, { to: t }));
}
console.log(`showcase: regenerated ${targets.length} targets from examples/showcase.ml`);
