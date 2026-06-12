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

// True if any comparison operator is applied to strings (C needs strcmp —
// comparing const char* compares pointers).
function usesStringEq(program) {
  const CMP = new Set(["==", "!=", "<", ">", "<=", ">="]);
  let found = false;
  walk(program, (n) => { if (n.kind === "Bin" && CMP.has(n.op) && n.l.type === "string") found = true; });
  return found;
}

// True if any % is integer modulo (Python's % and Lua's % are floor-mod;
// every other target truncates, so they need a helper for negative operands).
function usesIntMod(program) {
  let found = false;
  walk(program, (n) => { if (n.kind === "Bin" && n.op === "%" && n.type === "int") found = true; });
  return found;
}

// True if the program uses arrays anywhere (so a backend can emit its array
// runtime: an IntSlice struct in C, a zeros() helper in Lua).
function usesArray(program) {
  let found = false;
  walk(program, (n) => { if (["Array", "NewArray", "Index", "Len", "IndexAssign"].includes(n.kind)) found = true; });
  return found;
}

// Rename identifiers that collide with a target's reserved words or runtime
// names (name -> name_, repeated until free). `main` is never renamed — every
// backend maps it specially. Struct renames are mirrored into all type
// annotations. Mutates the program (each transpile() call parses fresh IR).
function renameReserved(program, reserved, mangle = (n) => n + "_") {
  const fix = (n) => {
    if (n === "main") return n;
    let r = n;
    while (reserved.has(r)) r = mangle(r);
    return r;
  };
  const structMap = new Map();
  for (const st of program.structs || []) {
    const f = fix(st.name);
    if (f !== st.name) structMap.set(st.name, f);
  }
  const remapT = (t) => {
    if (typeof t !== "string") return t;
    if (t.endsWith("[]")) { const b = t.slice(0, -2); return structMap.has(b) ? structMap.get(b) + "[]" : t; }
    return structMap.get(t) || t;
  };
  walk(program, (node) => {
    if (typeof node.name === "string" && node.kind) node.name = fix(node.name);
    if (typeof node.type === "string") node.type = remapT(node.type);
    if (typeof node.ret === "string") node.ret = remapT(node.ret);
    if (Array.isArray(node.params)) for (const p of node.params) { p.name = fix(p.name); p.type = remapT(p.type); }
    if (Array.isArray(node.fields)) for (const f of node.fields) { f.name = fix(f.name); f.type = remapT(f.type); }
    if (Array.isArray(node.fieldNames)) node.fieldNames = node.fieldNames.map(fix);
  });
  return program;
}

module.exports = { walk, usesFloatPrint, usesStringConcat, usesIntDiv, usesIntMod, usesArray, usesStringEq, renameReserved };
