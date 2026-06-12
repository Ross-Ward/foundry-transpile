"use strict";
// C backend. Static types come straight from the checker's annotations.
// Integer division needs no special-casing: int/int already truncates in C.

const { usesFloatPrint, usesStringConcat, usesArray, usesStringEq } = require("./util");

const CT = { int: "int", float: "double", bool: "bool", string: "const char*", void: "void", "int[]": "IntSlice", "float[]": "FloatSlice", "string[]": "StrSlice" };
const T = (t) => CT[t] || `${t}*`; // structs are malloc'd pointers (reference semantics)

// Stored strings must be duplicated out of the rotating concat buffers
// (array elements and struct fields outlive them).
const DUP_HELPER = [
  "#include <stdlib.h>",
  "#include <string.h>",
  "",
  "static const char *__dups(const char *v) {",
  "    size_t n = strlen(v) + 1; char *r = (char *)malloc(n); memcpy(r, v, n); return r;",
  "}",
].join("\n");

// C has no array type, so int[] becomes an IntSlice (pointer + length). Literals
// are filled by a varargs constructor; `array(n)` is calloc-zeroed. (Memory is
// never freed — fine for the short-lived programs a transpiler emits.)
const ARRAY_RUNTIME = [
  "#include <stdlib.h>",
  "#include <stdarg.h>",
  "#include <string.h>",
  "",
  "typedef struct { int *data; int len; } IntSlice;",
  "static IntSlice __arr(int n, ...) {",
  "    IntSlice s; s.len = n; s.data = (int *)malloc(sizeof(int) * (n > 0 ? n : 1));",
  "    va_list ap; va_start(ap, n);",
  "    for (int i = 0; i < n; i++) s.data[i] = va_arg(ap, int);",
  "    va_end(ap);",
  "    return s;",
  "}",
  "static IntSlice __newarr(int n) {",
  "    IntSlice s; s.len = n; s.data = (int *)calloc(n > 0 ? n : 1, sizeof(int));",
  "    return s;",
  "}",
  "typedef struct { double *data; int len; } FloatSlice;",
  "static FloatSlice __arrf(int n, ...) {",
  "    FloatSlice s; s.len = n; s.data = (double *)malloc(sizeof(double) * (n > 0 ? n : 1));",
  "    va_list ap; va_start(ap, n);",
  "    for (int i = 0; i < n; i++) s.data[i] = va_arg(ap, double);",
  "    va_end(ap);",
  "    return s;",
  "}",
  "typedef struct { const char **data; int len; } StrSlice;",
  "static StrSlice __arrs(int n, ...) {",
  "    StrSlice s; s.len = n; s.data = (const char **)malloc(sizeof(char *) * (n > 0 ? n : 1));",
  "    va_list ap; va_start(ap, n);",
  "    for (int i = 0; i < n; i++) s.data[i] = __dups(va_arg(ap, const char *));",
  "    va_end(ap);",
  "    return s;",
  "}",
].join("\n");

// C has no string type or string concatenation, so we ship a tiny runtime: a
// rotating pool of buffers feeds __concat / __str_int / __fmt. The pool is large
// enough for all the temporaries in a single expression.
const RUNTIME = [
  "#include <string.h>",
  "",
  "static char __bufs[64][512];",
  "static int __bi = 0;",
  "static char *__buf(void) { char *b = __bufs[__bi]; __bi = (__bi + 1) % 64; return b; }",
  "static const char *__fmt(double x) {",
  "    char *b = __buf();",
  '    snprintf(b, 512, "%.6f", x);',
  "    int n = (int)strlen(b);",
  "    while (n > 0 && b[n - 1] == '0') b[--n] = 0;",
  "    if (n > 0 && b[n - 1] == '.') { b[n++] = '0'; b[n] = 0; }",
  "    return b;",
  "}",
  "static const char *__str_int(int v) { char *b = __buf(); snprintf(b, 512, \"%d\", v); return b; }",
  "static const char *__concat(const char *a, const char *b) { char *r = __buf(); snprintf(r, 512, \"%s%s\", a, b); return r; }",
].join("\n");

function emitC(program) {
  const structs = program.structs || [];
  const out = ["#include <stdio.h>", "#include <stdbool.h>"];
  if (usesStringEq(program)) out.push("#include <string.h>"); // strcmp
  if (usesFloatPrint(program) || usesStringConcat(program)) out.push(RUNTIME);
  if (usesArray(program) || structs.length) out.push(DUP_HELPER);
  if (usesArray(program)) out.push(ARRAY_RUNTIME);
  for (const st of structs) out.push(emitStruct(st));
  out.push("");

  // forward declarations so call order never matters
  for (const f of program.funcs) {
    if (f.name === "main") continue;
    out.push(`${T(f.ret)} ${f.name}(${paramList(f)});`);
  }
  out.push("");

  for (const f of program.funcs) out.push(emitFunc(f));
  return out.join("\n") + "\n";
}

function emitStruct(st) {
  const fields = st.fields.map((f) => `${CT[f.type]} ${f.name};`).join(" ");
  const params = st.fields.map((f) => `${CT[f.type]} ${f.name}`).join(", ");
  const inits = st.fields
    .map((f) => `s->${f.name} = ${f.type === "string" ? `__dups(${f.name})` : f.name};`)
    .join(" ");
  return [
    `typedef struct { ${fields} } ${st.name};`,
    `static ${st.name} *__new_${st.name}(${params || "void"}) {`,
    `    ${st.name} *s = (${st.name} *)malloc(sizeof(${st.name}));`,
    `    ${inits}`,
    `    return s;`,
    `}`,
  ].join("\n");
}

function paramList(f) {
  if (f.params.length === 0) return "void";
  return f.params.map((p) => `${T(p.type)} ${p.name}`).join(", ");
}

function emitFunc(f) {
  if (f.name === "main") {
    return `int main(void) {\n${emitBlock(f.body, 1)}    return 0;\n}\n`;
  }
  return `${T(f.ret)} ${f.name}(${paramList(f)}) {\n${emitBlock(f.body, 1)}}\n`;
}

function emitBlock(block, d) {
  return block.stmts.map((s) => emitStmt(s, d)).join("\n") + (block.stmts.length ? "\n" : "");
}

function emitStmt(s, d) {
  const pad = "    ".repeat(d);
  switch (s.kind) {
    case "Let": return `${pad}${T(s.type)} ${s.name} = ${E(s.expr)};`;
    case "Assign": return `${pad}${s.name} = ${E(s.expr)};`;
    case "Print": return `${pad}${printf(s.expr)}`;
    case "IndexAssign": {
      const v = s.expr.type === "string" ? `__dups(${E(s.expr)})` : E(s.expr);
      return `${pad}${E(s.arr)}.data[${E(s.idx)}] = ${v};`;
    }
    case "FieldAssign": {
      const v = s.expr.type === "string" ? `__dups(${E(s.expr)})` : E(s.expr);
      return `${pad}${E(s.obj)}->${s.name} = ${v};`;
    }
    case "Return": return `${pad}return${s.expr ? " " + E(s.expr) : ""};`;
    case "ExprStmt": return `${pad}${E(s.expr)};`;
    case "While": return `${pad}while (${E(s.cond)}) {\n${emitBlock(s.body, d + 1)}${pad}}`;
    case "If": {
      let out = `${pad}if (${E(s.cond)}) {\n${emitBlock(s.then, d + 1)}${pad}}`;
      if (s.els) out += ` else {\n${emitBlock(s.els, d + 1)}${pad}}`;
      return out;
    }
    case "Block": return `${pad}{\n${emitBlock(s, d + 1)}${pad}}`;
    default: throw new Error(`c: unknown stmt ${s.kind}`);
  }
}

function printf(e) {
  if (e.type === "float") return `printf("%s\\n", __fmt(${E(e)}));`; // canonical float text
  if (e.type === "bool") return `printf("%s\\n", ${E(e)} ? "true" : "false");`; // %d would say 1/0
  const fmt = { int: "%d", string: "%s" }[e.type];
  return `printf("${fmt}\\n", ${E(e)});`;
}

// Render an expression as a C string (for concatenation).
function asStr(n) {
  if (n.type === "string") return E(n);
  if (n.type === "int") return `__str_int(${E(n)})`;
  if (n.type === "float") return `__fmt(${E(n)})`;
  if (n.type === "bool") return `(${E(n)} ? "true" : "false")`;
  return E(n);
}

function E(e) {
  switch (e.kind) {
    case "Int": return String(e.value);
    case "Float": return e.value % 1 === 0 ? `${e.value}.0` : String(e.value);
    case "Str": return cString(e.value);
    case "Bool": return e.value ? "true" : "false";
    case "Var": return e.name;
    case "Un": return `(${e.op}${E(e.e)})`;
    case "Call": return `${e.name}(${e.args.map(E).join(", ")})`;
    case "Bin":
      if (e.op === "+" && e.type === "string") return `__concat(${asStr(e.l)}, ${asStr(e.r)})`;
      if ((e.op === "==" || e.op === "!=") && e.l.type === "string")
        return `(strcmp(${E(e.l)}, ${E(e.r)}) ${e.op} 0)`;
      return `(${E(e.l)} ${e.op} ${E(e.r)})`;
    case "Array": {
      const et = e.type.slice(0, -2);
      const ctor = et === "float" ? "__arrf" : et === "string" ? "__arrs" : "__arr";
      return `${ctor}(${e.elems.length}${e.elems.length ? ", " + e.elems.map(E).join(", ") : ""})`;
    }
    case "NewArray": return `__newarr(${E(e.size)})`;
    case "Index": return `${E(e.arr)}.data[${E(e.idx)}]`;
    case "Len": return `${E(e.arr)}.len`;
    case "StructLit": return `__new_${e.name}(${e.args.map(E).join(", ")})`;
    case "Field": return `${E(e.obj)}->${e.name}`;
    default: throw new Error(`c: unknown expr ${e.kind}`);
  }
}

function cString(s) {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t") + '"';
}

module.exports = { emitC };
