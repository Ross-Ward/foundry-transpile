"use strict";
// JavaScript backend. Integer division is normalised with Math.trunc so it
// matches C/Go/Python semantics (JS '/' is otherwise floating point).

const { usesFloatPrint, renameReserved } = require("./util");

const RESERVED = new Set(("break case catch class const continue debugger default delete do else enum export extends " +
  "finally for function if import in instanceof let new return static super switch this throw try typeof var void " +
  "while with yield await null true false undefined NaN Infinity Math console").split(" "));

const FLOAT_HELPER =
  'function __f(x) {\n  let s = x.toFixed(6).replace(/0+$/, "");\n  return s.endsWith(".") ? s + "0" : s;\n}';

function emitJS(program) {
  renameReserved(program, RESERVED);
  const out = [];
  if (usesFloatPrint(program)) out.push(FLOAT_HELPER);
  for (const f of program.funcs) out.push(emitFunc(f));
  out.push("main();");
  return out.join("\n\n") + "\n";
}

function emitFunc(f) {
  const params = f.params.map((p) => p.name).join(", ");
  return `function ${f.name}(${params}) {\n${emitBlock(f.body, 1)}}`;
}

function emitBlock(block, depth) {
  return block.stmts.map((s) => emitStmt(s, depth)).join("\n") + (block.stmts.length ? "\n" : "");
}

function emitStmt(s, d) {
  const pad = "  ".repeat(d);
  switch (s.kind) {
    case "Let": return `${pad}let ${s.name} = ${E(s.expr)};`;
    case "Assign": return `${pad}${s.name} = ${E(s.expr)};`;
    case "Print": {
      if (s.expr.type === "float") return `${pad}console.log(__f(${E(s.expr)}));`;
      // + 0 turns negative zero into 0 (JS: -6 % 6 is -0, and console.log shows it)
      if (s.expr.type === "int") return `${pad}console.log(${E(s.expr)} + 0);`;
      return `${pad}console.log(${E(s.expr)});`;
    }
    case "IndexAssign": return `${pad}${E(s.arr)}[${E(s.idx)}] = ${E(s.expr)};`;
    case "FieldAssign": return `${pad}${E(s.obj)}.${s.name} = ${E(s.expr)};`;
    case "Return": return `${pad}return${s.expr ? " " + E(s.expr) : ""};`;
    case "ExprStmt": return `${pad}${E(s.expr)};`;
    case "While": return `${pad}while (${E(s.cond)}) {\n${emitBlock(s.body, d + 1)}${pad}}`;
    case "For": return `${pad}for (${clause(s.init)}; ${E(s.cond)}; ${clause(s.post)}) {\n${emitBlock(s.body, d + 1)}${pad}}`;
    case "Break": return `${pad}break;`;
    case "Continue": return `${pad}continue;`;
    case "If": {
      let out = `${pad}if (${E(s.cond)}) {\n${emitBlock(s.then, d + 1)}${pad}}`;
      if (s.els) out += ` else {\n${emitBlock(s.els, d + 1)}${pad}}`;
      return out;
    }
    case "Block": return `${pad}{\n${emitBlock(s, d + 1)}${pad}}`; // braced scope (e.g. a desugared for)
    default: throw new Error(`js: unknown stmt ${s.kind}`);
  }
}

// render a statement as a for-clause (no padding, no trailing semicolon)
function clause(s) {
  return emitStmt(s, 0).replace(/;$/, "");
}

function E(e) {
  switch (e.kind) {
    case "Int": return String(e.value);
    case "Float": return String(e.value);
    case "Str": return JSON.stringify(e.value);
    case "Bool": return e.value ? "true" : "false";
    case "Var": return e.name;
    case "Un": return `(${e.op}${E(e.e)})`;
    case "Call": return `${e.name}(${e.args.map(E).join(", ")})`;
    case "Bin": {
      const op = mapOp(e.op);
      const l = E(e.l), r = E(e.r);
      if (e.op === "/" && e.type === "int") return `Math.trunc(${l} / ${r})`;
      return `(${l} ${op} ${r})`;
    }
    case "Array": return `[${e.elems.map(E).join(", ")}]`;
    case "NewArray": return `new Array(${E(e.size)}).fill(0)`;
    case "Index": return `${E(e.arr)}[${E(e.idx)}]`;
    case "Len": return `${E(e.arr)}.length`;
    case "StructLit": return `{ ${e.fieldNames.map((f, i) => `${f}: ${E(e.args[i])}`).join(", ")} }`;
    case "Field": return `${E(e.obj)}.${e.name}`;
    case "Cond": return `(${E(e.c)} ? ${E(e.t)} : ${E(e.f)})`;
    case "Substr": return `${E(e.s)}.substring(${E(e.start)}, ${E(e.end)})`;
    case "Cast": return e.to === "int" ? `Math.trunc(${E(e.e)})` : `(${E(e.e)})`; // JS numbers are already floats
    default: throw new Error(`js: unknown expr ${e.kind}`);
  }
}

function mapOp(op) { return op === "==" ? "===" : op === "!=" ? "!==" : op; }

module.exports = { emitJS };
