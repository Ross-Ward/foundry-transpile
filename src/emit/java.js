"use strict";
// Java backend. Everything goes in a `Program` class as static methods; the
// user's `main()` is overloaded alongside the JVM entry `main(String[])`.
// String == becomes .equals(). Integer division truncates natively.

const { usesFloatPrint } = require("./util");

const JT = { int: "int", float: "double", bool: "boolean", string: "String", void: "void", "int[]": "int[]", "float[]": "double[]", "string[]": "String[]" };
const T = (t) => JT[t] || t; // struct -> its class name

const FLOAT_HELPER =
  "    static String __f(double x) {\n" +
  '        String s = String.format(java.util.Locale.US, "%.6f", x).replaceAll("0+$", "");\n' +
  '        return s.endsWith(".") ? s + "0" : s;\n    }\n';

function emitJava(program) {
  const structs = (program.structs || []).map(emitStruct).join("\n");
  const body = program.funcs.map(emitFunc).join("\n");
  const helper = usesFloatPrint(program) ? FLOAT_HELPER : "";
  return `public class Program {\n${structs}${body}\n${helper}    public static void main(String[] args) {\n        main();\n    }\n}\n`;
}

function emitStruct(st) {
  const fields = st.fields.map((f) => `        ${T(f.type)} ${f.name};`).join("\n");
  const params = st.fields.map((f) => `${T(f.type)} ${f.name}`).join(", ");
  const inits = st.fields.map((f) => `this.${f.name} = ${f.name};`).join(" ");
  return `    static class ${st.name} {\n${fields}\n        ${st.name}(${params}) { ${inits} }\n    }\n`;
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
    case "Print": return `${pad}System.out.println(${s.expr.type === "float" ? `__f(${E(s.expr)})` : E(s.expr)});`;
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
    default: throw new Error(`java: unknown stmt ${s.kind}`);
  }
}

function E(e) {
  switch (e.kind) {
    case "Int": return String(e.value);
    case "Float": return (e.value % 1 === 0 ? `${e.value}.0` : String(e.value));
    case "Str": return javaString(e.value);
    case "Bool": return e.value ? "true" : "false";
    case "Var": return e.name;
    case "Un": return `(${e.op}${E(e.e)})`;
    case "Call": return `${e.name}(${e.args.map(E).join(", ")})`;
    case "Bin": {
      // Java compares String identity with ==, so route string equality to .equals
      if ((e.op === "==" || e.op === "!=") && e.l.type === "string") {
        const eq = `${E(e.l)}.equals(${E(e.r)})`;
        return e.op === "==" ? `(${eq})` : `(!${eq})`;
      }
      return `(${E(e.l)} ${e.op} ${E(e.r)})`;
    }
    case "Array": return `new ${T(e.type.slice(0, -2))}[]{${e.elems.map(E).join(", ")}}`;
    case "NewArray": return `new ${T(e.type.slice(0, -2))}[${E(e.size)}]`;
    case "Index": return `${E(e.arr)}[${E(e.idx)}]`;
    case "Len": return `${E(e.arr)}.length`;
    case "StructLit": return `new ${e.name}(${e.args.map(E).join(", ")})`;
    case "Field": return `${E(e.obj)}.${e.name}`;
    default: throw new Error(`java: unknown expr ${e.kind}`);
  }
}

function javaString(s) {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t") + '"';
}

module.exports = { emitJava };
