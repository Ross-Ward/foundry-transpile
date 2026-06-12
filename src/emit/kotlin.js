"use strict";
// Kotlin backend (9th target, JVM). The user's `main` is Kotlin's `fun main`.
// Structs become classes with a `var` primary constructor (reference semantics
// for free). Kotlin params are vals, so any reassigned param is shadowed with
// `var p = p` at the top of the function. `$` must be escaped in string
// literals (template syntax), and `int + string` needs .toString() on the left
// (String.plus(Any) only works string-first).

const { usesFloatPrint, renameReserved } = require("./util");

const RESERVED = new Set(("as break class continue do else false for fun if in interface is null object package " +
  "return super this throw true try typealias typeof val var when while by catch constructor delegate dynamic field " +
  "file finally get import init param property receiver set setparam where it println String Int Double Boolean " +
  "IntArray DoubleArray Array run to until step downTo").split(" "));

const KT = { int: "Int", float: "Double", bool: "Boolean", string: "String", void: "", "int[]": "IntArray", "float[]": "DoubleArray", "string[]": "Array<String>" };
const T = (t) => KT[t] ?? (t.endsWith("[]") ? `Array<${T(t.slice(0, -2))}>` : t); // struct -> its class name

const FLOAT_HELPER =
  "fun __f(x: Double): String {\n" +
  '    var s = String.format(java.util.Locale.US, "%.6f", x).trimEnd(\'0\')\n' +
  '    if (s.endsWith(".")) s += "0"\n' +
  "    return s\n}";

function emitKotlin(program) {
  renameReserved(program, RESERVED);
  const out = [];
  if (usesFloatPrint(program)) out.push(FLOAT_HELPER);
  for (const st of program.structs || []) {
    out.push(`class ${st.name}(${st.fields.map((fl) => `var ${fl.name}: ${T(fl.type)}`).join(", ")})`);
  }
  for (const f of program.funcs) out.push(emitFunc(f));
  return out.join("\n\n") + "\n";
}

function emitFunc(f) {
  const reassigned = new Set();
  collectReassigned(f.body, reassigned);
  const params = f.params.map((p) => `${p.name}: ${T(p.type)}`).join(", ");
  const head = f.name === "main"
    ? "fun main()"
    : `fun ${f.name}(${params})${f.ret === "void" ? "" : ": " + T(f.ret)}`;
  // Kotlin params are immutable; shadow the reassigned ones
  const shadows = f.params
    .filter((p) => reassigned.has(p.name))
    .map((p) => `    var ${p.name} = ${p.name}`)
    .join("\n");
  return `${head} {\n${shadows ? shadows + "\n" : ""}${emitBlock(f.body, 1)}}`;
}

function collectReassigned(node, set) {
  if (!node || typeof node !== "object") return;
  if (node.kind === "Assign") set.add(node.name);
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (Array.isArray(v)) v.forEach((x) => collectReassigned(x, set));
    else if (v && typeof v === "object") collectReassigned(v, set);
  }
}

function emitBlock(block, d, loop) {
  return block.stmts.map((s) => emitStmt(s, d, loop)).join("\n") + (block.stmts.length ? "\n" : "");
}

// `loop` carries the enclosing For's post statement (Kotlin has no 3-clause
// for, so `continue` must run the post step explicitly first).
function emitStmt(s, d, loop) {
  const pad = "    ".repeat(d);
  switch (s.kind) {
    case "Let": return `${pad}var ${s.name}: ${T(s.type)} = ${E(s.expr)}`;
    case "Assign": return `${pad}${s.name} = ${E(s.expr)}`;
    case "Print": return `${pad}println(${s.expr.type === "float" ? `__f(${E(s.expr)})` : E(s.expr)})`;
    case "IndexAssign": return `${pad}${E(s.arr)}[${E(s.idx)}] = ${E(s.expr)}`;
    case "FieldAssign": return `${pad}${E(s.obj)}.${s.name} = ${E(s.expr)}`;
    case "Return": return `${pad}return${s.expr ? " " + E(s.expr) : ""}`;
    case "ExprStmt": return `${pad}${E(s.expr)}`;
    case "While": return `${pad}while (${E(s.cond)}) {\n${emitBlock(s.body, d + 1, null)}${pad}}`;
    case "For":
      return `${pad}run {\n${emitStmt(s.init, d + 1, null)}\n` +
        `${pad}    while (${E(s.cond)}) {\n` +
        emitBlock(s.body, d + 2, { post: s.post }) +
        `${emitStmt(s.post, d + 2, null)}\n${pad}    }\n${pad}}`;
    case "Break": return `${pad}break`;
    case "Continue":
      if (loop && loop.post) return `${emitStmt(loop.post, d, null)}\n${pad}continue`;
      return `${pad}continue`;
    case "If": {
      let out = `${pad}if (${E(s.cond)}) {\n${emitBlock(s.then, d + 1, loop)}${pad}}`;
      if (s.els) out += ` else {\n${emitBlock(s.els, d + 1, loop)}${pad}}`;
      return out;
    }
    case "Block": return `${pad}run {\n${emitBlock(s, d + 1, loop)}${pad}}`; // scoped block (bare {} is a lambda)
    default: throw new Error(`kotlin: unknown stmt ${s.kind}`);
  }
}

function E(e) {
  switch (e.kind) {
    case "Int": return String(e.value);
    case "Float": return e.value % 1 === 0 ? `${e.value}.0` : String(e.value);
    case "Str": return ktString(e.value);
    case "Bool": return e.value ? "true" : "false";
    case "Var": return e.name;
    case "Un": return `(${e.op}${E(e.e)})`;
    case "Call": return `${e.name}(${e.args.map(E).join(", ")})`;
    case "Bin": {
      // string concatenation: String.plus(Any) works string-first only
      if (e.op === "+" && e.type === "string") {
        const l = e.l.type === "string" ? E(e.l) : `${E(e.l)}.toString()`;
        return `(${l} + ${E(e.r)})`;
      }
      return `(${E(e.l)} ${e.op} ${E(e.r)})`;
    }
    case "Array": {
      const et = e.type.slice(0, -2);
      const ctor = et === "int" ? "intArrayOf" : et === "float" ? "doubleArrayOf" : "arrayOf";
      return `${ctor}(${e.elems.map(E).join(", ")})`;
    }
    case "NewArray": return `IntArray(${E(e.size)})`;
    case "Index": return `${E(e.arr)}[${E(e.idx)}]`;
    case "Len": return e.arr.type === "string" ? `${E(e.arr)}.length` : `${E(e.arr)}.size`;
    case "Substr": return `${E(e.s)}.substring(${E(e.start)}, ${E(e.end)})`;
    case "Cast": return e.to === "int" ? `(${E(e.e)}).toInt()` : `(${E(e.e)}).toDouble()`; // toInt() truncates toward zero
    case "StructLit": return `${e.name}(${e.args.map(E).join(", ")})`;
    case "Field": return `${E(e.obj)}.${e.name}`;
    case "Cond": return `(if (${E(e.c)}) ${E(e.t)} else ${E(e.f)})`;
    default: throw new Error(`kotlin: unknown expr ${e.kind}`);
  }
}

function ktString(s) {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/\n/g, "\\n").replace(/\t/g, "\\t") + '"';
}

module.exports = { emitKotlin };
