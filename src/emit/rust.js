"use strict";
// Rust backend. int -> i64, float -> f64. Rust needs `let mut` for any variable
// that is later reassigned, so we pre-scan each function for mutated names. The
// user's `main` becomes Rust's `fn main`. Integer division truncates natively.

const { usesFloatPrint, renameReserved } = require("./util");

const RESERVED = new Set(("as break const continue crate dyn else enum extern false fn for if impl in let loop match " +
  "mod move mut pub ref return self Self static struct super trait true type unsafe use where while async await " +
  "abstract become box do final macro override priv typeof unsized virtual yield try gen String Vec vec").split(" "));

// string -> String (owned) so concatenation via format! type-checks; literals
// become "...".to_string().
const RT = { int: "i64", float: "f64", bool: "bool", string: "String", void: "", "int[]": "Vec<i64>", "float[]": "Vec<f64>", "string[]": "Vec<String>" };
const T = (t) => RT[t] ?? (t.endsWith("[]") ? `Vec<${T(t.slice(0, -2))}>` : t); // struct -> its name; Point[] -> Vec<Point>

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
  renameReserved(program, RESERVED);
  STRUCTS = new Set((program.structs || []).map((st) => st.name));
  const out = [];
  if (usesFloatPrint(program)) out.push(FLOAT_HELPER);
  for (const st of program.structs || []) {
    out.push(`struct ${st.name} {\n${st.fields.map((fl) => `    ${fl.name}: ${T(fl.type)},`).join("\n")}\n}`);
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

// the variable at the root of an lvalue chain: xs[i].inner.x -> xs
function rootVar(n) {
  while (n && (n.kind === "Index" || n.kind === "Field")) n = n.kind === "Index" ? n.arr : n.obj;
  return n && n.kind === "Var" ? n.name : null;
}

function collectMutated(node, set) {
  if (!node || typeof node !== "object") return;
  if (node.kind === "Assign") set.add(node.name);
  if (node.kind === "IndexAssign") { const r = rootVar(node.arr); if (r) set.add(r); } // a[i] = .. mutates a
  if (node.kind === "FieldAssign") { const r = rootVar(node.obj); if (r) set.add(r); } // p.x = .. mutates p
  // arrays and structs are passed as &mut, so the argument's root variable must be `mut`
  if (node.kind === "Call") for (const a of node.args) if (isRef(a.type)) { const r = rootVar(a); if (r) set.add(r); }
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (Array.isArray(v)) v.forEach((x) => collectMutated(x, set));
    else if (v && typeof v === "object") collectMutated(v, set);
  }
}

function emitBlock(block, d, mut, loop) {
  return block.stmts.map((s) => emitStmt(s, d, mut, loop)).join("\n") + (block.stmts.length ? "\n" : "");
}

// `loop` carries the enclosing For's post statement (Rust has no 3-clause
// for, so `continue` must run the post step explicitly first).
function emitStmt(s, d, mut, loop) {
  const pad = "    ".repeat(d);
  switch (s.kind) {
    case "Let": return `${pad}let ${mut.has(s.name) ? "mut " : ""}${s.name}: ${T(s.type)} = ${E(s.expr)};`;
    case "Assign": return `${pad}${s.name} = ${E(s.expr)};`;
    case "Print": return `${pad}println!("{}", ${s.expr.type === "float" ? `__f(${E(s.expr)})` : E(s.expr)});`;
    case "IndexAssign": return `${pad}${E(s.arr)}[(${E(s.idx)}) as usize] = ${E(s.expr)};`;
    case "FieldAssign": return `${pad}${E(s.obj)}.${s.name} = ${E(s.expr)};`;
    case "Return": return `${pad}return${s.expr ? " " + E(s.expr) : ""};`;
    case "ExprStmt": return `${pad}${E(s.expr)};`;
    case "While": return `${pad}while ${E(s.cond)} {\n${emitBlock(s.body, d + 1, mut, null)}${pad}}`;
    case "For":
      return `${pad}{\n${emitStmt(s.init, d + 1, mut, null)}\n` +
        `${pad}    while ${E(s.cond)} {\n` +
        emitBlock(s.body, d + 2, mut, { post: s.post }) +
        `${emitStmt(s.post, d + 2, mut, null)}\n${pad}    }\n${pad}}`;
    case "Break": return `${pad}break;`;
    case "Continue":
      if (loop && loop.post) return `${emitStmt(loop.post, d, mut, null)}\n${pad}continue;`;
      return `${pad}continue;`;
    case "If": {
      let out = `${pad}if ${E(s.cond)} {\n${emitBlock(s.then, d + 1, mut, loop)}${pad}}`;
      if (s.els) out += ` else {\n${emitBlock(s.els, d + 1, mut, loop)}${pad}}`;
      return out;
    }
    case "Block": return `${pad}{\n${emitBlock(s, d + 1, mut, loop)}${pad}}`;
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
    case "Call": return `${e.name}(${e.args.map((a) => {
      if (isRef(a.type)) return `&mut ${E(a)}`;
      // a string variable passed by value would move; the caller may still use it
      if (a.type === "string" && a.kind === "Var") return `${E(a)}.clone()`;
      return E(a);
    }).join(", ")})`;
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
    case "Cond": return `(if ${E(e.c)} { ${E(e.t)} } else { ${E(e.f)} })`;
    case "Substr": return `${E(e.s)}[(${E(e.start)}) as usize..(${E(e.end)}) as usize].to_string()`;
    case "Cast": return e.to === "int" ? `((${E(e.e)}) as i64)` : `((${E(e.e)}) as f64)`; // as i64 truncates toward zero
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
