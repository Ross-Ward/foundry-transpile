"use strict";
// Dart backend. Statically typed and class-based, so structs map to classes
// with `Point(this.x, this.y);` constructors (reference semantics for free)
// and arrays to List<T>. Integer division is ~/ (Dart's / always yields
// double) and % is EUCLIDEAN in Dart (-7 % 3 == 2), so the truncating
// .remainder() is used instead. Strings have no < (compareTo), `$` must be
// escaped in string literals, and bools print as true/false natively.

const { usesFloatPrint, usesIntMod, renameReserved } = require("./util");

const RESERVED = new Set(("abstract as assert async await base break case catch class const continue covariant default " +
  "deferred do dynamic else enum export extends extension external factory final finally for get hide if implements " +
  "import in interface is late library mixin new null of on operator out part required rethrow return sealed set show " +
  "static super switch sync this throw true false try type typedef var void when while with yield int double bool " +
  "String List print num Object identical main_").split(" "));

const DT = { int: "int", float: "double", bool: "bool", string: "String", void: "void" };
const T = (t) => DT[t] ?? (t.endsWith("[]") ? `List<${T(t.slice(0, -2))}>` : t);

const FLOAT_HELPER =
  "String __f(double x) {\n" +
  "  var s = x.toStringAsFixed(6);\n" +
  "  while (s.endsWith('0')) {\n    s = s.substring(0, s.length - 1);\n  }\n" +
  "  if (s.endsWith('.')) {\n    s += '0';\n  }\n  return s;\n}";

// Dart's % is euclidean (-7 % 3 == 2) and int.remainder() returns num, so the
// truncating remainder is its own int-typed helper.
const MOD_HELPER = "int __m(int a, int b) {\n  return a - (a ~/ b) * b;\n}";

function emitDart(program) {
  renameReserved(program, RESERVED);
  const out = [];
  if (usesFloatPrint(program)) out.push(FLOAT_HELPER);
  if (usesIntMod(program)) out.push(MOD_HELPER);
  for (const st of program.structs || []) {
    const fields = st.fields.map((f) => `  ${T(f.type)} ${f.name};`).join("\n");
    const ctor = `  ${st.name}(${st.fields.map((f) => `this.${f.name}`).join(", ")});`;
    out.push(`class ${st.name} {\n${fields}\n${ctor}\n}`);
  }
  for (const f of program.funcs) out.push(emitFunc(f));
  return out.join("\n\n") + "\n";
}

function emitFunc(f) {
  const params = f.params.map((p) => `${T(p.type)} ${p.name}`).join(", ");
  const head = f.name === "main" ? "void main()" : `${T(f.ret)} ${f.name}(${params})`;
  return `${head} {\n${emitBlock(f.body, 1)}}`;
}

function emitBlock(block, d) {
  return block.stmts.map((s) => emitStmt(s, d)).join("\n") + (block.stmts.length ? "\n" : "");
}

function emitStmt(s, d) {
  const pad = "  ".repeat(d);
  switch (s.kind) {
    case "Let": return `${pad}${T(s.type)} ${s.name} = ${E(s.expr)};`;
    case "Assign": return `${pad}${s.name} = ${E(s.expr)};`;
    case "Print": return `${pad}print(${s.expr.type === "float" ? `__f(${E(s.expr)})` : E(s.expr)});`;
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
    case "Block": return `${pad}{\n${emitBlock(s, d + 1)}${pad}}`;
    default: throw new Error(`dart: unknown stmt ${s.kind}`);
  }
}

function clause(s) {
  return emitStmt(s, 0).replace(/;$/, "");
}

function E(e) {
  switch (e.kind) {
    case "Int": return String(e.value);
    case "Float": return e.value % 1 === 0 ? `${e.value}.0` : String(e.value);
    case "Str": return dartString(e.value);
    case "Bool": return e.value ? "true" : "false";
    case "Var": return e.name;
    case "Un": return `(${e.op}${E(e.e)})`;
    case "Call": return `${e.name}(${e.args.map(E).join(", ")})`;
    case "Bin": {
      // String + only accepts String; toString() covers int/float/bool
      if (e.op === "+" && e.type === "string") {
        const s = (n) => (n.type === "string" ? E(n) : `(${E(n)}).toString()`);
        return `(${s(e.l)} + ${s(e.r)})`;
      }
      if (["<", ">", "<=", ">="].includes(e.op) && e.l.type === "string")
        return `(${E(e.l)}.compareTo(${E(e.r)}) ${e.op} 0)`; // no < on String
      if (e.op === "/" && e.type === "int") return `(${E(e.l)} ~/ ${E(e.r)})`; // / always yields double
      if (e.op === "%" && e.type === "int") return `__m(${E(e.l)}, ${E(e.r)})`; // % is euclidean
      return `(${E(e.l)} ${e.op} ${E(e.r)})`;
    }
    case "Array": return `<${T(e.type.slice(0, -2))}>[${e.elems.map(E).join(", ")}]`;
    case "NewArray": return `List<int>.filled(${E(e.size)}, 0)`;
    case "Index": return `${E(e.arr)}[${E(e.idx)}]`;
    case "Len": return `${E(e.arr)}.length`;
    case "StructLit": return `${e.name}(${e.args.map(E).join(", ")})`;
    case "Field": return `${E(e.obj)}.${e.name}`;
    case "Cond": return `(${E(e.c)} ? ${E(e.t)} : ${E(e.f)})`;
    case "Substr": return `${E(e.s)}.substring(${E(e.start)}, ${E(e.end)})`;
    case "Cast": // truncate() truncates toward zero
      return e.to === "int" ? `(${E(e.e)}).truncate()` : `(${E(e.e)}).toDouble()`;
    default: throw new Error(`dart: unknown expr ${e.kind}`);
  }
}

function dartString(s) {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/\n/g, "\\n").replace(/\t/g, "\\t") + '"';
}

module.exports = { emitDart };
