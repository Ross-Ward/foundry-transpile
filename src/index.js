"use strict";
// foundry-transpile — a source-to-source transpiler built on a shared IR.
//
// Architecture: each SOURCE language has a frontend (text -> typed IR) and each
// TARGET language has a backend (IR -> text). Any frontend composes with any
// backend, so N frontends + M backends give N×M transpilations. The IR is the
// typed AST produced by the parser and annotated by the checker.
const { parse } = require("./parser");
const { parse: parseJS } = require("./frontends/javascript");
const { parse: parsePy } = require("./frontends/python");
const { parse: parseTS } = require("./frontends/typescript");
const { parse: parseC } = require("./frontends/c");
const { check } = require("./checker");
const { emitJS } = require("./emit/js");
const { emitPython } = require("./emit/python");
const { emitC } = require("./emit/c");
const { emitGo } = require("./emit/go");
const { emitJava } = require("./emit/java");
const { emitCSharp } = require("./emit/csharp");
const { emitRust } = require("./emit/rust");
const { emitLua } = require("./emit/lua");

// frontends: source language -> IR
const FRONTENDS = {
  mini: parse,
  js: parseJS,
  python: parsePy,
  ts: parseTS,
  c: parseC,
};

// backends: IR -> source language
const BACKENDS = {
  js: emitJS,
  python: emitPython,
  c: emitC,
  go: emitGo,
  java: emitJava,
  csharp: emitCSharp,
  rust: emitRust,
  lua: emitLua,
};

const FILE_EXT = { js: "js", python: "py", c: "c", go: "go", java: "java", csharp: "cs", rust: "rs", lua: "lua" };

/**
 * Transpile `source` from one language to another.
 * @param {string} source
 * @param {{from?: string, to: string}} opts
 * @returns {string} generated source code
 */
function transpile(source, opts) {
  const from = opts.from || "mini";
  const to = opts.to;
  const frontend = FRONTENDS[from];
  const backend = BACKENDS[to];
  if (!frontend) throw new Error(`unknown source language '${from}' (have: ${Object.keys(FRONTENDS).join(", ")})`);
  if (!backend) throw new Error(`unknown target language '${to}' (have: ${Object.keys(BACKENDS).join(", ")})`);

  const ir = check(frontend(source)); // parse -> type-check/annotate
  return backend(ir);
}

module.exports = {
  transpile,
  parse,
  check,
  sources: Object.keys(FRONTENDS),
  targets: Object.keys(BACKENDS),
  FILE_EXT,
};
