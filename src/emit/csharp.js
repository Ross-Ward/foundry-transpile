"use strict";
// C# backend. Static methods in a `Program` class; the entry `Main()` calls the
// user's `main()` (C# is case-sensitive, so the two never collide). String == is
// value equality in C#, so no special-casing. Integer division truncates.

const { usesFloatPrint } = require("./util");

const CS = { int: "int", float: "double", bool: "bool", string: "string", void: "void", "int[]": "int[]", "float[]": "double[]", "string[]": "string[]" };
const T = (t) => CS[t] || t; // struct -> its class name (class, for reference semantics)

const FLOAT_HELPER =
  "    static string __f(double x) {\n" +
  '        string s = x.ToString("F6", System.Globalization.CultureInfo.InvariantCulture).TrimEnd(\'0\');\n' +
  '        return s.EndsWith(".") ? s + "0" : s;\n    }\n';

function emitCSharp(program) {
  const structs = (program.structs || []).map(emitStruct).join("\n");
  const body = program.funcs.map(emitFunc).join("\n");
  const helper = usesFloatPrint(program) ? FLOAT_HELPER : "";
  return `using System;\n\nclass Program {\n${structs}${body}\n${helper}    static void Main() {\n        main();\n    }\n}\n`;
}

function emitStruct(st) {
  const fields = st.fields.map((f) => `        public ${CS[f.type]} ${f.name};`).join("\n");
  const params = st.fields.map((f) => `${CS[f.type]} ${f.name}`).join(", ");
  const inits = st.fields.map((f) => `this.${f.name} = ${f.name};`).join(" ");
  return `    class ${st.name} {\n${fields}\n        public ${st.name}(${params}) { ${inits} }\n    }\n`;
}

function emitFunc(f) {
  const params = f.params.map((p) => `${T(p.type)} ${p.name}`).join(", ");
  return `    static ${T(f.ret)} ${f.name}(${params}) {\n${emitBlock(f.body, 2)}    }\n`;
}

function emitBlock(block, d) {
  return block.stmts.map((s) => emitStmt(s, d)).join("\n") + (block.stmts.length ? "\n" : "");
}

function emitStmt(s, d) {
  const pad = "    ".repeat(d);
  switch (s.kind) {
    case "Let": return `${pad}${T(s.type)} ${s.name} = ${E(s.expr)};`;
    case "Assign": return `${pad}${s.name} = ${E(s.expr)};`;
    case "Print": return `${pad}Console.WriteLine(${s.expr.type === "float" ? `__f(${E(s.expr)})` : E(s.expr)});`;
    case "IndexAssign": return `${pad}${E(s.arr)}[${E(s.idx)}] = ${E(s.expr)};`;
    case "FieldAssign": return `${pad}${E(s.obj)}.${s.name} = ${E(s.expr)};`;
    case "Return": return `${pad}return${s.expr ? " " + E(s.expr) : ""};`;
    case "ExprStmt": return `${pad}${E(s.expr)};`;
    case "While": return `${pad}while (${E(s.cond)}) {\n${emitBlock(s.body, d + 1)}${pad}}`;
    case "If": {
      let out = `${pad}if (${E(s.cond)}) {\n${emitBlock(s.then, d + 1)}${pad}}`;
      if (s.els) out += ` else {\n${emitBlock(s.els, d + 1)}${pad}}`;
      return out;
    }
    case "Block": return `${pad}{\n${emitBlock(s, d + 1)}${pad}}`;
    default: throw new Error(`csharp: unknown stmt ${s.kind}`);
  }
}

function E(e) {
  switch (e.kind) {
    case "Int": return String(e.value);
    case "Float": return e.value % 1 === 0 ? `${e.value}.0` : String(e.value);
    case "Str": return csString(e.value);
    case "Bool": return e.value ? "true" : "false";
    case "Var": return e.name;
    case "Un": return `(${e.op}${E(e.e)})`;
    case "Call": return `${e.name}(${e.args.map(E).join(", ")})`;
    case "Bin": return `(${E(e.l)} ${e.op} ${E(e.r)})`;
    case "Array": return `new ${CS[e.type.slice(0, -2)]}[]{${e.elems.map(E).join(", ")}}`;
    case "NewArray": return `new ${CS[e.type.slice(0, -2)]}[${E(e.size)}]`;
    case "Index": return `${E(e.arr)}[${E(e.idx)}]`;
    case "Len": return `${E(e.arr)}.Length`;
    case "StructLit": return `new ${e.name}(${e.args.map(E).join(", ")})`;
    case "Field": return `${E(e.obj)}.${e.name}`;
    default: throw new Error(`csharp: unknown expr ${e.kind}`);
  }
}

function csString(s) {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t") + '"';
}

module.exports = { emitCSharp };
