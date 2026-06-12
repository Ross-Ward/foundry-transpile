"use strict";
// Lua backend (5.4). Dynamically typed, so no declarations. `//` is floor
// division in Lua, so integer division goes through a truncate-toward-zero
// helper to match the other targets; floats print through the canonical helper;
// `..` concatenates (Lua coerces numbers). `!=` -> `~=`, `&&/||/!` -> and/or/not.
const { usesFloatPrint, usesIntDiv, usesArray } = require("./util");

const FLOAT_HELPER =
  "local function __f(x)\n" +
  '  local s = (string.format("%.6f", x):gsub("0+$", ""))\n' +
  '  if s:sub(-1) == "." then s = s .. "0" end\n' +
  "  return s\nend";

const IDIV_HELPER =
  "local function __idiv(a, b)\n" +
  "  local q = a // b\n" +
  "  if (a % b ~= 0) and ((a < 0) ~= (b < 0)) then q = q + 1 end\n" +
  "  return q\nend";

const ZEROS_HELPER =
  "local function __zeros(n)\n  local t = {}\n  for i = 1, n do t[i] = 0 end\n  return t\nend";

function emitLua(program) {
  const out = [];
  if (usesFloatPrint(program)) out.push(FLOAT_HELPER);
  if (usesIntDiv(program)) out.push(IDIV_HELPER);
  if (usesArray(program)) out.push(ZEROS_HELPER);
  for (const f of program.funcs) out.push(emitFunc(f));
  out.push("main()");
  return out.join("\n\n") + "\n";
}

function emitFunc(f) {
  const params = f.params.map((p) => p.name).join(", ");
  return `function ${f.name}(${params})\n${emitBlock(f.body, 1)}end`;
}

function emitBlock(block, d) {
  return block.stmts.map((s) => emitStmt(s, d)).join("\n") + (block.stmts.length ? "\n" : "");
}

function emitStmt(s, d) {
  const pad = "  ".repeat(d);
  switch (s.kind) {
    case "Let": return `${pad}local ${s.name} = ${E(s.expr)}`;
    case "Assign": return `${pad}${s.name} = ${E(s.expr)}`;
    case "Print": return `${pad}print(${s.expr.type === "float" ? `__f(${E(s.expr)})` : E(s.expr)})`;
    case "IndexAssign": return `${pad}${E(s.arr)}[(${E(s.idx)}) + 1] = ${E(s.expr)}`;
    case "FieldAssign": return `${pad}${E(s.obj)}.${s.name} = ${E(s.expr)}`;
    case "Return": return `${pad}return${s.expr ? " " + E(s.expr) : ""}`;
    case "ExprStmt": return `${pad}${E(s.expr)}`;
    case "While": return `${pad}while ${E(s.cond)} do\n${emitBlock(s.body, d + 1)}${pad}end`;
    case "If": return emitIf(s, d);
    case "Block": return `${pad}do\n${emitBlock(s, d + 1)}${pad}end`; // scoped block (Lua)
    default: throw new Error(`lua: unknown stmt ${s.kind}`);
  }
}

function emitIf(s, d) {
  const pad = "  ".repeat(d);
  let out = `${pad}if ${E(s.cond)} then\n${emitBlock(s.then, d + 1)}`;
  let els = s.els;
  while (els && els.kind === "Block" && els.stmts.length === 1 && els.stmts[0].kind === "If") {
    const e = els.stmts[0];
    out += `${pad}elseif ${E(e.cond)} then\n${emitBlock(e.then, d + 1)}`;
    els = e.els;
  }
  if (els) out += `${pad}else\n${emitBlock(els, d + 1)}`;
  out += `${pad}end`;
  return out;
}

function E(e) {
  switch (e.kind) {
    case "Int": return String(e.value);
    case "Float": return e.value % 1 === 0 ? `${e.value}.0` : String(e.value);
    case "Str": return luaString(e.value);
    case "Bool": return e.value ? "true" : "false";
    case "Var": return e.name;
    case "Un": return e.op === "!" ? `(not ${E(e.e)})` : `(${e.op}${E(e.e)})`;
    case "Call": return `${e.name}(${e.args.map(E).join(", ")})`;
    case "Bin": {
      if (e.op === "+" && e.type === "string") return `(${E(e.l)} .. ${E(e.r)})`; // Lua coerces numbers
      if (e.op === "/" && e.type === "int") return `__idiv(${E(e.l)}, ${E(e.r)})`;
      return `(${E(e.l)} ${mapOp(e.op)} ${E(e.r)})`;
    }
    case "Array": return `{${e.elems.map(E).join(", ")}}`;
    case "NewArray": return `__zeros(${E(e.size)})`;
    case "Index": return `${E(e.arr)}[(${E(e.idx)}) + 1]`; // Lua tables are 1-indexed
    case "Len": return `#${E(e.arr)}`;
    case "StructLit": return `{${e.fieldNames.map((f, i) => `${f} = ${E(e.args[i])}`).join(", ")}}`;
    case "Field": return `${E(e.obj)}.${e.name}`;
    default: throw new Error(`lua: unknown expr ${e.kind}`);
  }
}

function mapOp(op) { return op === "!=" ? "~=" : op === "&&" ? "and" : op === "||" ? "or" : op; }

function luaString(s) {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t") + '"';
}

module.exports = { emitLua };
