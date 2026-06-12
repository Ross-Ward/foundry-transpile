"use strict";
// Shared helpers for backends: walk the typed IR and detect which runtime
// helpers a program needs (canonical float printing, string concatenation).

function walk(node, fn) {
  if (!node || typeof node !== "object") return;
  fn(node);
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (Array.isArray(v)) v.forEach((x) => walk(x, fn));
    else if (v && typeof v === "object") walk(v, fn);
  }
}

// True if any `print` outputs a float — those need canonical formatting so every
// target prints e.g. 2.5 and 40.0 the same way (defaults differ wildly).
function usesFloatPrint(program) {
  let found = false;
  walk(program, (n) => { if (n.kind === "Print" && n.expr && n.expr.type === "float") found = true; });
  return found;
}

// True if any `+` is a string concatenation (result type string).
function usesStringConcat(program) {
  let found = false;
  walk(program, (n) => { if (n.kind === "Bin" && n.op === "+" && n.type === "string") found = true; });
  return found;
}

// True if any `/` is integer division (Lua's `//` floors, so it needs a
// truncate-toward-zero helper to match the other targets).
function usesIntDiv(program) {
  let found = false;
  walk(program, (n) => { if (n.kind === "Bin" && n.op === "/" && n.type === "int") found = true; });
  return found;
}

// True if any ==/!= compares strings (C needs strcmp — `==` on const char*
// compares pointers).
function usesStringEq(program) {
  let found = false;
  walk(program, (n) => { if (n.kind === "Bin" && (n.op === "==" || n.op === "!=") && n.l.type === "string") found = true; });
  return found;
}

// True if the program uses arrays anywhere (so a backend can emit its array
// runtime: an IntSlice struct in C, a zeros() helper in Lua).
function usesArray(program) {
  let found = false;
  walk(program, (n) => { if (["Array", "NewArray", "Index", "Len", "IndexAssign"].includes(n.kind)) found = true; });
  return found;
}

module.exports = { walk, usesFloatPrint, usesStringConcat, usesIntDiv, usesArray, usesStringEq };
