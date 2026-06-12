"use strict";
// Go backend. `while` becomes `for cond {}`; int/int division truncates in Go,
// so no special-casing. Types come from the checker's annotations.

const { walk, usesFloatPrint, renameReserved } = require("./util");

const RESERVED = new Set(("break case chan const continue default defer else fallthrough for func go goto if import " +
  "interface map package range return select struct switch type var int string bool float64 len cap make new append " +
  "copy nil true false fmt iota println print").split(" "));

const GT = { int: "int", float: "float64", bool: "bool", string: "string", "int[]": "[]int", "float[]": "[]float64", "string[]": "[]string" };
// structs get reference semantics (like every other target), hence *Name;
// Point[] is a slice of those references
const T = (t) => GT[t] || (t.endsWith("[]") ? "[]" + T(t.slice(0, -2)) : `*${t}`);

const FLOAT_HELPER =
  'func __f(x float64) string {\n' +
  '\ts := strings.TrimRight(strconv.FormatFloat(x, \'f\', 6, 64), "0")\n' +
  '\tif strings.HasSuffix(s, ".") {\n\t\ts += "0"\n\t}\n\treturn s\n}';

const TRUNC_HELPER = "func __trunc(x float64) int {\n\treturn int(x)\n}";

function emitGo(program) {
  renameReserved(program, RESERVED);
  const needFloat = usesFloatPrint(program);
  // Go rejects truncating CONSTANT conversions (int(7.9) is a compile error),
  // so float->int casts go through a function to force runtime semantics
  let needTrunc = false;
  walk(program, (n) => { if (n.kind === "Cast" && n.to === "int" && n.e && n.e.type === "float") needTrunc = true; });
  const imports = ['"fmt"'];
  if (needFloat) imports.push('"strconv"', '"strings"');
  const out = ["package main", "", `import (\n${imports.map((i) => "\t" + i).join("\n")}\n)`, ""];
  if (needFloat) out.push(FLOAT_HELPER, "");
  if (needTrunc) out.push(TRUNC_HELPER, "");
  for (const st of program.structs || []) {
    out.push(`type ${st.name} struct {\n${st.fields.map((fl) => `\t${fl.name} ${T(fl.type)}`).join("\n")}\n}\n`);
  }
  for (const f of program.funcs) out.push(emitFunc(f));
  return out.join("\n") + "\n";
}

function emitFunc(f) {
  const params = f.params.map((p) => `${p.name} ${T(p.type)}`).join(", ");
  const ret = f.ret === "void" ? "" : " " + T(f.ret);
  return `func ${f.name}(${params})${ret} {\n${emitBlock(f.body, 1)}}\n`;
}

function emitBlock(block, d) {
  return block.stmts.map((s) => emitStmt(s, d)).join("\n") + (block.stmts.length ? "\n" : "");
}

function emitStmt(s, d) {
  const pad = "\t".repeat(d);
  switch (s.kind) {
    case "Let": return `${pad}var ${s.name} ${T(s.type)} = ${E(s.expr)}`;
    case "Assign": return `${pad}${s.name} = ${E(s.expr)}`;
    case "Print": return `${pad}fmt.Println(${s.expr.type === "float" ? `__f(${E(s.expr)})` : E(s.expr)})`;
    case "IndexAssign": return `${pad}${E(s.arr)}[${E(s.idx)}] = ${E(s.expr)}`;
    case "FieldAssign": return `${pad}${E(s.obj)}.${s.name} = ${E(s.expr)}`;
    case "Return": return `${pad}return${s.expr ? " " + E(s.expr) : ""}`;
    case "ExprStmt": return `${pad}${E(s.expr)}`;
    case "While": return `${pad}for ${E(s.cond)} {\n${emitBlock(s.body, d + 1)}${pad}}`;
    case "For": {
      // a for-clause init must be a simple statement, so Let becomes :=
      const init = s.init.kind === "Let" ? `${s.init.name} := ${E(s.init.expr)}` : emitStmt(s.init, 0);
      return `${pad}for ${init}; ${E(s.cond)}; ${emitStmt(s.post, 0)} {\n${emitBlock(s.body, d + 1)}${pad}}`;
    }
    case "Break": return `${pad}break`;
    case "Continue": return `${pad}continue`;
    case "If": {
      let out = `${pad}if ${E(s.cond)} {\n${emitBlock(s.then, d + 1)}${pad}}`;
      if (s.els) out += ` else {\n${emitBlock(s.els, d + 1)}${pad}}`;
      return out;
    }
    case "Block": return `${pad}{\n${emitBlock(s, d + 1)}${pad}}`;
    default: throw new Error(`go: unknown stmt ${s.kind}`);
  }
}

function E(e) {
  switch (e.kind) {
    case "Int": return String(e.value);
    case "Float": return e.value % 1 === 0 ? `${e.value}.0` : String(e.value);
    case "Str": return goString(e.value);
    case "Bool": return e.value ? "true" : "false";
    case "Var": return e.name;
    case "Un": return `(${e.op}${E(e.e)})`;
    case "Call": return `${e.name}(${e.args.map(E).join(", ")})`;
    case "Bin": {
      // string concatenation: convert non-string operands with fmt.Sprint
      if (e.op === "+" && e.type === "string") {
        const s = (n) => (n.type === "string" ? E(n) : `fmt.Sprint(${E(n)})`);
        return `(${s(e.l)} + ${s(e.r)})`;
      }
      return `(${E(e.l)} ${e.op} ${E(e.r)})`;
    }
    case "Array": return `[]${T(e.type.slice(0, -2))}{${e.elems.map(E).join(", ")}}`;
    case "NewArray": return `make([]${T(e.type.slice(0, -2))}, ${E(e.size)})`;
    case "Index": return `${E(e.arr)}[${E(e.idx)}]`;
    case "Len": return `len(${E(e.arr)})`;
    case "StructLit": return `&${e.name}{${e.fieldNames.map((f, i) => `${f}: ${E(e.args[i])}`).join(", ")}}`;
    case "Field": return `${E(e.obj)}.${e.name}`;
    case "Cond": // Go has no ternary; an immediately-invoked closure is the expression form
      return `func() ${T(e.type)} { if ${E(e.c)} { return ${E(e.t)} }; return ${E(e.f)} }()`;
    case "Substr": return `${E(e.s)}[${E(e.start)}:${E(e.end)}]`;
    case "Cast": {
      if (e.to === "int") return e.e.type === "float" ? `__trunc(${E(e.e)})` : `(${E(e.e)})`;
      return e.e.type === "int" ? `float64(${E(e.e)})` : `(${E(e.e)})`;
    }
    default: throw new Error(`go: unknown expr ${e.kind}`);
  }
}

function goString(s) {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t") + '"';
}

module.exports = { emitGo };
