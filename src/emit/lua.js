"use strict";
// Lua backend (5.4). Dynamically typed, so no declarations. `//` is floor
// division in Lua, so integer division goes through a truncate-toward-zero
// helper to match the other targets; floats print through the canonical helper;
// `..` concatenates (Lua coerces numbers). `!=` -> `~=`, `&&/||/!` -> and/or/not.
const { usesFloatPrint, usesIntDiv, usesIntMod, usesArray, renameReserved } = require("./util");

const RESERVED = new Set(("and break do else elseif end false for function goto if in local nil not or repeat return " +
  "then true until while print string math table type pairs ipairs tostring tonumber select error pcall require").split(" "));

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

// Lua's % is floor-mod; the other targets truncate.
const IMOD_HELPER =
  "local function __imod(a, b)\n  return a - __idiv(a, b) * b\nend";

let LBL = 0; // unique continue-label counter (Lua has no continue; we use goto)

function emitLua(program) {
  renameReserved(program, RESERVED);
  LBL = 0;
  const out = [];
  if (usesFloatPrint(program)) out.push(FLOAT_HELPER);
  if (usesIntDiv(program) || usesIntMod(program)) out.push(IDIV_HELPER);
  if (usesIntMod(program)) out.push(IMOD_HELPER);
  if (usesArray(program)) out.push(ZEROS_HELPER);
  for (const f of program.funcs) out.push(emitFunc(f));
  out.push("main()");
  return out.join("\n\n") + "\n";
}

function emitFunc(f) {
  const params = f.params.map((p) => p.name).join(", ");
  return `function ${f.name}(${params})\n${emitBlock(f.body, 1)}end`;
}

function emitBlock(block, d, loop) {
  return block.stmts.map((s) => emitStmt(s, d, loop)).join("\n") + (block.stmts.length ? "\n" : "");
}

// true when this loop body has a `continue` of its own (inner loops own theirs)
function containsContinue(node) {
  if (!node || typeof node !== "object") return false;
  if (node.kind === "Continue") return true;
  if (node.kind === "While" || node.kind === "For") return false;
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (Array.isArray(v)) { if (v.some(containsContinue)) return true; }
    else if (v && typeof v === "object" && containsContinue(v)) return true;
  }
  return false;
}

// `loop` = {label, post}: continue becomes `post; goto label`, with the label
// emitted as the last statement of the loop body (Lua's relaxed-label rule).
function emitStmt(s, d, loop) {
  const pad = "  ".repeat(d);
  switch (s.kind) {
    case "Let": return `${pad}local ${s.name} = ${E(s.expr)}`;
    case "Assign": return `${pad}${s.name} = ${E(s.expr)}`;
    case "Print": return `${pad}print(${s.expr.type === "float" ? `__f(${E(s.expr)})` : E(s.expr)})`;
    case "IndexAssign": return `${pad}${E(s.arr)}[(${E(s.idx)}) + 1] = ${E(s.expr)}`;
    case "FieldAssign": return `${pad}${E(s.obj)}.${s.name} = ${E(s.expr)}`;
    case "Return": return `${pad}return${s.expr ? " " + E(s.expr) : ""}`;
    case "ExprStmt": return `${pad}${E(s.expr)}`;
    case "While": {
      const label = containsContinue(s.body) ? `__cont_${LBL++}` : null;
      const lbl = label ? `${pad}  ::${label}::\n` : "";
      return `${pad}while ${E(s.cond)} do\n${emitBlock(s.body, d + 1, { label, post: null })}${lbl}${pad}end`;
    }
    case "For": {
      const label = containsContinue(s.body) ? `__cont_${LBL++}` : null;
      const lbl = label ? `${pad}    ::${label}::\n` : "";
      return `${pad}do\n${emitStmt(s.init, d + 1, null)}\n` +
        `${pad}  while ${E(s.cond)} do\n` +
        emitBlock(s.body, d + 2, { label, post: s.post }) +
        `${emitStmt(s.post, d + 2, null)}\n${lbl}${pad}  end\n${pad}end`;
    }
    case "Break": return `${pad}break`;
    case "Continue": {
      const jump = `${pad}goto ${loop.label}`;
      return loop.post ? `${emitStmt(loop.post, d, null)}\n${jump}` : jump;
    }
    case "If": return emitIf(s, d, loop);
    case "Block": return `${pad}do\n${emitBlock(s, d + 1, loop)}${pad}end`; // scoped block (Lua)
    default: throw new Error(`lua: unknown stmt ${s.kind}`);
  }
}

function emitIf(s, d, loop) {
  const pad = "  ".repeat(d);
  let out = `${pad}if ${E(s.cond)} then\n${emitBlock(s.then, d + 1, loop)}`;
  let els = s.els;
  while (els && els.kind === "Block" && els.stmts.length === 1 && els.stmts[0].kind === "If") {
    const e = els.stmts[0];
    out += `${pad}elseif ${E(e.cond)} then\n${emitBlock(e.then, d + 1, loop)}`;
    els = e.els;
  }
  if (els) out += `${pad}else\n${emitBlock(els, d + 1, loop)}`;
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
      if (e.op === "+" && e.type === "string") { // Lua coerces numbers in .. but errors on booleans
        const s = (n) => (n.type === "bool" ? `(${E(n)} and "true" or "false")` : E(n));
        return `(${s(e.l)} .. ${s(e.r)})`;
      }
      if (e.op === "/" && e.type === "int") return `__idiv(${E(e.l)}, ${E(e.r)})`;
      if (e.op === "%" && e.type === "int") return `__imod(${E(e.l)}, ${E(e.r)})`; // truncating remainder
      return `(${E(e.l)} ${mapOp(e.op)} ${E(e.r)})`;
    }
    case "Array": return `{${e.elems.map(E).join(", ")}}`;
    case "NewArray": return `__zeros(${E(e.size)})`;
    case "Index": return `${E(e.arr)}[(${E(e.idx)}) + 1]`; // Lua tables are 1-indexed
    case "Len": return `#${E(e.arr)}`;
    case "StructLit": return `{${e.fieldNames.map((f, i) => `${f} = ${E(e.args[i])}`).join(", ")}}`;
    case "Field": return `${E(e.obj)}.${e.name}`;
    case "Cond": // `c and t or f` breaks when t is false, so use a real branch
      return `((function() if ${E(e.c)} then return ${E(e.t)} else return ${E(e.f)} end end)())`;
    case "Substr": return `string.sub(${E(e.s)}, (${E(e.start)}) + 1, ${E(e.end)})`; // 1-based, end-inclusive
    case "Cast": // math.modf's integral part truncates toward zero; keep int-ness
      return e.to === "int" ? `math.tointeger(math.modf(${E(e.e)}))` : `((${E(e.e)}) * 1.0)`;
    default: throw new Error(`lua: unknown expr ${e.kind}`);
  }
}

function mapOp(op) { return op === "!=" ? "~=" : op === "&&" ? "and" : op === "||" ? "or" : op; }

function luaString(s) {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t") + '"';
}

module.exports = { emitLua };
