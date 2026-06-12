"use strict";
// Python backend. Indentation-based; integer division uses int(a / b) to
// truncate toward zero like the other targets. && || ! become and / or / not.

const { usesFloatPrint } = require("./util");

const FLOAT_HELPER =
  'def __f(x):\n    s = ("%.6f" % x).rstrip("0")\n    return s + "0" if s.endswith(".") else s';

function emitPython(program) {
  const out = [];
  if (usesFloatPrint(program)) out.push(FLOAT_HELPER);
  for (const st of program.structs || []) out.push(emitStruct(st));
  for (const f of program.funcs) out.push(emitFunc(f));
  out.push('if __name__ == "__main__":\n    main()');
  return out.join("\n\n\n") + "\n";
}

function emitStruct(st) {
  const params = st.fields.map((f) => f.name).join(", ");
  const assigns = st.fields.map((f) => `        self.${f.name} = ${f.name}`).join("\n");
  return `class ${st.name}:\n    def __init__(self${params ? ", " + params : ""}):\n${assigns || "        pass"}`;
}

function emitFunc(f) {
  const params = f.params.map((p) => p.name).join(", ");
  const body = emitBlock(f.body, 1);
  return `def ${f.name}(${params}):\n${body}`;
}

function emitBlock(block, depth) {
  if (block.stmts.length === 0) return "  ".repeat(depth) + "pass\n";
  return block.stmts.map((s) => emitStmt(s, depth)).join("\n") + "\n";
}

function emitStmt(s, d) {
  const pad = "    ".repeat(d);
  switch (s.kind) {
    case "Let": return `${pad}${s.name} = ${E(s.expr)}`;
    case "Assign": return `${pad}${s.name} = ${E(s.expr)}`;
    case "Print": return `${pad}print(${s.expr.type === "float" ? `__f(${E(s.expr)})` : E(s.expr)})`;
    case "IndexAssign": return `${pad}${E(s.arr)}[${E(s.idx)}] = ${E(s.expr)}`;
    case "FieldAssign": return `${pad}${E(s.obj)}.${s.name} = ${E(s.expr)}`;
    case "Return": return `${pad}return${s.expr ? " " + E(s.expr) : ""}`;
    case "ExprStmt": return `${pad}${E(s.expr)}`;
    case "While": return `${pad}while ${E(s.cond)}:\n${emitBlock(s.body, d + 1)}`.replace(/\n$/, "");
    case "If": return emitIf(s, d, "if");
    case "Block": return emitBlock(s, d).replace(/\n$/, "");
    default: throw new Error(`py: unknown stmt ${s.kind}`);
  }
}

// Collapse a desugared `else { if ... }` chain back into idiomatic elif.
function emitIf(s, d, kw) {
  const pad = "    ".repeat(d);
  let out = `${pad}${kw} ${E(s.cond)}:\n${emitBlock(s.then, d + 1)}`.replace(/\n$/, "");
  if (s.els) {
    if (s.els.kind === "Block" && s.els.stmts.length === 1 && s.els.stmts[0].kind === "If") {
      out += "\n" + emitIf(s.els.stmts[0], d, "elif");
    } else {
      out += `\n${pad}else:\n${emitBlock(s.els, d + 1)}`.replace(/\n$/, "");
    }
  }
  return out;
}

function E(e) {
  switch (e.kind) {
    case "Int": return String(e.value);
    case "Float": return String(e.value);
    case "Str": return JSON.stringify(e.value); // valid Python string literal for our escapes
    case "Bool": return e.value ? "True" : "False";
    case "Var": return e.name;
    case "Un": return e.op === "!" ? `(not ${E(e.e)})` : `(${e.op}${E(e.e)})`;
    case "Call": return `${e.name}(${e.args.map(E).join(", ")})`;
    case "Bin": {
      // string concatenation: convert non-string operands with str()
      if (e.op === "+" && e.type === "string") {
        const s = (n) => (n.type === "string" ? E(n) : `str(${E(n)})`);
        return `(${s(e.l)} + ${s(e.r)})`;
      }
      const l = E(e.l), r = E(e.r);
      if (e.op === "/" && e.type === "int") return `int(${l} / ${r})`;
      return `(${l} ${mapOp(e.op)} ${r})`;
    }
    case "Array": return `[${e.elems.map(E).join(", ")}]`;
    case "NewArray": return `([0] * (${E(e.size)}))`;
    case "Index": return `${E(e.arr)}[${E(e.idx)}]`;
    case "Len": return `len(${E(e.arr)})`;
    case "StructLit": return `${e.name}(${e.args.map(E).join(", ")})`;
    case "Field": return `${E(e.obj)}.${e.name}`;
    default: throw new Error(`py: unknown expr ${e.kind}`);
  }
}

function mapOp(op) { return op === "&&" ? "and" : op === "||" ? "or" : op; }

module.exports = { emitPython };
