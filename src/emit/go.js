"use strict";
// Go backend. `while` becomes `for cond {}`; int/int division truncates in Go,
// so no special-casing. Types come from the checker's annotations.

const { usesFloatPrint } = require("./util");

const GT = { int: "int", float: "float64", bool: "bool", string: "string", "int[]": "[]int", "float[]": "[]float64", "string[]": "[]string" };
// structs get reference semantics (like every other target), hence *Name;
// Point[] is a slice of those references
const T = (t) => GT[t] || (t.endsWith("[]") ? "[]" + T(t.slice(0, -2)) : `*${t}`);

const FLOAT_HELPER =
  'func __f(x float64) string {\n' +
  '\ts := strings.TrimRight(strconv.FormatFloat(x, \'f\', 6, 64), "0")\n' +
  '\tif strings.HasSuffix(s, ".") {\n\t\ts += "0"\n\t}\n\treturn s\n}';

function emitGo(program) {
  const needFloat = usesFloatPrint(program);
  const imports = ['"fmt"'];
  if (needFloat) imports.push('"strconv"', '"strings"');
  const out = ["package main", "", `import (\n${imports.map((i) => "\t" + i).join("\n")}\n)`, ""];
  if (needFloat) out.push(FLOAT_HELPER, "");
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
    default: throw new Error(`go: unknown expr ${e.kind}`);
  }
}

function goString(s) {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t") + '"';
}

module.exports = { emitGo };
