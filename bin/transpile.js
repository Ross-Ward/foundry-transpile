#!/usr/bin/env node
"use strict";
// CLI:  transpile --from mini --to c program.ml
//       transpile --to python program.ml > program.py
//       cat program.ml | transpile --to go
const fs = require("fs");
const { transpile, sources, targets } = require("../src/index");

function main(argv) {
  let from = "mini", to = null, file = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--from" || a === "-f") from = argv[++i];
    else if (a === "--to" || a === "-t") to = argv[++i];
    else if (a === "-h" || a === "--help") return usage(0);
    else file = a;
  }
  if (!to) { process.stderr.write("error: --to <language> is required\n"); return usage(1); }

  const source = file ? fs.readFileSync(file, "utf8") : fs.readFileSync(0, "utf8");
  try {
    process.stdout.write(transpile(source, { from, to }));
  } catch (e) {
    process.stderr.write(`transpile error: ${e.message}\n`);
    process.exit(1);
  }
}

function usage(code) {
  process.stderr.write(
    `usage: transpile --to <lang> [--from <lang>] [file]\n` +
    `  sources: ${sources.join(", ")}\n` +
    `  targets: ${targets.join(", ")}\n`
  );
  process.exit(code);
}

main(process.argv.slice(2));
