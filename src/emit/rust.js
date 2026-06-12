"use strict";
// Rust backend. int -> i64, float -> f64. Rust needs `let mut` for any variable
// that is later reassigned, so we pre-scan each function for mutated names. The
// user's `main` becomes Rust's `fn main`. Integer division truncates natively.

const { usesFloatPrint } = require("./util");

// string -> String (owned) so concatenation via format! type-checks; literals
// become "...".to_string().
const RT = { int: "i64", float: "f64", bool: "bool", string: "String", void: "", "int[]": "Vec<i64>", "float[]": "Vec<f64>", "string[]": "Vec<String>" };
const T = (t) => RT[t] ?? t; // struct -> its own name

// Like Vecs, structs are owned values passed by &mut (reference semantics
// everywhere else; the checker rejects aliasing so the two models agree).
let STRUCTS = new Set();
const isRef = (t) => !!t && (t.endsWith("[]") || STRUCTS.has(t));

const FLOAT_HELPER =
  "fn __f(x: f64) -> String {\n" +
  '    let mut s = format!("{:.6}", x);\n' +
  "    while s.ends_with('0') { s.pop(); }\n" +
  "    if s.ends_with('.') { s.push('0'); }\n    s\n}";

function emitRust(program) {
  STRUCTS = new Set((program.structs || []).map((st) => st.name));
  const out = [];
  if (usesFloatPrint(program)) out.push(FLOAT_HELPER);
  for (const st of program.structs || []) {
    out.push(`struct ${st.name} {\n${st.fields.map((fl) => `    ${fl.name}: ${RT[fl.type]},`).join("\n")}\n}`);
  }
  for (const f of program.funcs) out.push(emitFunc(f).replace(/\n$/, ""));
  return out.join("\n\n") + "\n";
}

function emitFunc(f) {
  const mut = new Set();
  collectMutated(f.body, mut);
  // Vec and struct values are move-by-value, so both are passed by &mut;
  // everything else by value, with `mut` when the binding is reassigned.
  const params = f.params.map((p) => {
    if (isRef(p.type)) return `${p.name}: &mut ${T(p.type)}`;
    return `${mut.has(p.name) ? "mut " : ""}${p.name}: ${T(p.type)}`;
  }).join(", ");
  const head = f.name === "main"
    ? "fn main()"
    : `fn ${f.name}(${params})${f.ret === "void" ? "" : " -> " + T(f.ret)}`;
  return `${head} {\n${emitBlock(f.body, 1, mut)}}\n`;
}

function collectMutated(node, set) {
  if (!node || typeof node !== "object") return;
  if (node.kind === "Assign") set.add(node.name);
  if (node.kind === "IndexAssign" && node.arr.kind === "Var") set.add(node.arr.name); // a[i] = .. mutates a
  if (node.kind === "FieldAssign" && node.obj.kind === "Var") set.add(node.obj.name); // p.x = .. mutates p
  // arrays and structs are passed as &mut, so such argument variables must be `mut`
  if (node.kind === "Call") for (const a of node.args) if (a.kind === "Var" && isRef(a.type)) set.add(a.name);
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (Array.isArray(v)) v.forEach((x) => collectMutated(x, set));
    else if (v && typeof v === "object") collectMutated(v, set);
  }
}

function emitBlock(block, d, mut) {
  return block.stmts.map((s) => emitStmt(s, d, mut)).join("\n") + (block.stmts.length ? "\n" : "");
}

function emitStmt(s, d, mut) {
  const pad = "    ".repeat(d);
  switch (s.kind) {
    case "Let": return `${pad}let ${mut.has(s.name) ? "mut " : ""}${s.name}: ${T(s.type)} = ${E(s.expr)};`;
    case "Assign": return `${pad}${s.name} = ${E(s.expr)};`;
    case "Print": return `${pad}println!("{}", ${s.expr.type === "float" ? `__f(${E(s.expr)})` : E(s.expr)});`;
    case "IndexAssign": return `${pad}${E(s.arr)}[(${E(s.idx)}) as usize] = ${E(s.expr)};`;
    case "FieldAssign": return `${pad}${E(s.obj)}.${s.name} = ${E(s.expr)};`;
    case "Return": return `${pad}return${s.expr ? " " + E(s.expr) : ""};`;
    case "ExprStmt": return `${pad}${E(s.expr)};`;
    case "While": return `${pad}while ${E(s.cond)} {\n${emitBlock(s.body, d + 1, mut)}${pad}}`;
    case "If": {
      let out = `${pad}if ${E(s.cond)} {\n${emitBlock(s.then, d + 1, mut)}${pad}}`;
      if (s.els) out += ` else {\n${emitBlock(s.els, d + 1, mut)}${pad}}`;
      return out;
    }
    case "Block": return `${pad}{\n${emitBlock(s, d + 1, mut)}${pad}}`;
    default: throw new Error(`rust: unknown stmt ${s.kind}`);
  }
}

function E(e) {
  switch (e.kind) {
    case "Int": return String(e.value);
    case "Float": return e.value % 1 === 0 ? `${e.value}.0` : String(e.value);
    case "Str": return `${rustString(e.value)}.to_string()`;
    case "Bool": return e.value ? "true" : "false";
    case "Var": return e.name;
    case "Un": return `(${e.op}${E(e.e)})`;
    case "Call": return `${e.name}(${e.args.map((a) => (isRef(a.type) ? `&mut ${E(a)}` : E(a))).join(", ")})`;
    case "Bin":
      // string concatenation via format!, which Displays any operand type
      if (e.op === "+" && e.type === "string") return `format!("{}{}", ${E(e.l)}, ${E(e.r)})`;
      return `(${E(e.l)} ${e.op} ${E(e.r)})`;
    case "Array": return `vec![${e.elems.map(E).join(", ")}]`;
    case "NewArray": return `vec![0i64; (${E(e.size)}) as usize]`;
    case "Index": {
      const ix = `${E(e.arr)}[(${E(e.idx)}) as usize]`;
      return e.type === "string" ? `${ix}.clone()` : ix; // String moves out of an index
    }
    case "Len": return `(${E(e.arr)}.len() as i64)`;
    case "StructLit": return `${e.name} { ${e.fieldNames.map((f, i) => `${f}: ${E(e.args[i])}`).join(", ")} }`;
    case "Field": {
      const fa = `${E(e.obj)}.${e.name}`;
      return e.type === "string" ? `${fa}.clone()` : fa; // String moves out of a field
    }
    default: throw new Error(`rust: unknown expr ${e.kind}`);
  }
}

function rustString(s) {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t") + '"';
}

module.exports = { emitRust };
