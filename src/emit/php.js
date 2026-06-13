"use strict";
// PHP backend (PHP 8). Dynamically typed with $variables, so no declarations.
// Structs become classes with constructor property promotion (object handles
// give reference semantics for free) — but PHP ARRAYS are value semantics
// (copy on assign/pass), so array-typed parameters are declared by-reference
// (&$a). Integer division is intdiv() (PHP's / always returns float); string
// equality uses ===/!== to dodge type juggling and ordering uses strcmp
// (PHP's < compares numeric-looking strings numerically). echo prints true as
// "1" and false as "", so booleans go through a ternary.

const { usesFloatPrint, renameReserved } = require("./util");

// vars are $-prefixed (immune to keywords); this set protects function/class names
const RESERVED = new Set(("abstract and array as break callable case catch class clone const continue declare default " +
  "do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile enum extends final finally fn for " +
  "foreach function global goto if implements include instanceof insteadof interface isset list match namespace new or " +
  "print private protected public readonly require return static switch throw trait try unset use var while xor yield " +
  "true false null int float string bool void iterable object mixed never intdiv strlen substr strcmp count " +
  // common builtin functions a program might plausibly collide with (PHP has one global function namespace)
  "join implode explode sort rsort usort key current next prev reset end max min abs pow floor ceil round trim sprintf " +
  "printf date time rand srand log exp sin cos tan sqrt str_repeat in_array array_sum array_fill range compact extract").split(" "));

const FLOAT_HELPER =
  'function __f(float $x): string {\n' +
  '    $s = rtrim(number_format($x, 6, ".", ""), "0");\n' +
  '    if (substr($s, -1) === ".") $s .= "0";\n' +
  '    return $s;\n}';

function emitPHP(program) {
  renameReserved(program, RESERVED);
  const out = ["<?php"];
  if (usesFloatPrint(program)) out.push(FLOAT_HELPER);
  for (const st of program.structs || []) {
    out.push(`class ${st.name} {\n    public function __construct(${st.fields.map((f) => `public $${f.name}`).join(", ")}) {}\n}`);
  }
  for (const f of program.funcs) out.push(emitFunc(f));
  out.push("main();");
  return out.join("\n\n") + "\n";
}

function emitFunc(f) {
  // arrays are copy-on-pass in PHP; declare array params by-reference so
  // in-place mutation through a function behaves like every other target
  const params = f.params.map((p) => `${p.type.endsWith("[]") ? "&" : ""}$${p.name}`).join(", ");
  return `function ${f.name}(${params}) {\n${emitBlock(f.body, 1)}}`;
}

function emitBlock(block, d) {
  return block.stmts.map((s) => emitStmt(s, d)).join("\n") + (block.stmts.length ? "\n" : "");
}

function emitStmt(s, d) {
  const pad = "    ".repeat(d);
  switch (s.kind) {
    case "Let": return `${pad}$${s.name} = ${E(s.expr)};`;
    case "Assign": return `${pad}$${s.name} = ${E(s.expr)};`;
    case "Print": {
      if (s.expr.type === "float") return `${pad}echo __f(${E(s.expr)}), "\\n";`;
      if (s.expr.type === "bool") return `${pad}echo (${E(s.expr)}) ? "true" : "false", "\\n";`; // echo true is "1"
      return `${pad}echo ${E(s.expr)}, "\\n";`;
    }
    case "IndexAssign": return `${pad}${E(s.arr)}[${E(s.idx)}] = ${E(s.expr)};`;
    case "FieldAssign": return `${pad}${E(s.obj)}->${s.name} = ${E(s.expr)};`;
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
    default: throw new Error(`php: unknown stmt ${s.kind}`);
  }
}

function clause(s) {
  return emitStmt(s, 0).replace(/;$/, "");
}

// render an expression for string concatenation (PHP's . coerces ints and
// floats, but booleans become "1"/"")
function asStr(n) {
  if (n.type === "bool") return `((${E(n)}) ? "true" : "false")`;
  return E(n);
}

function E(e) {
  switch (e.kind) {
    case "Int": return String(e.value);
    case "Float": return e.value % 1 === 0 ? `${e.value}.0` : String(e.value);
    case "Str": return phpString(e.value);
    case "Bool": return e.value ? "true" : "false";
    case "Var": return `$${e.name}`;
    case "Un": return `(${e.op}${E(e.e)})`;
    case "Call": return `${e.name}(${e.args.map(E).join(", ")})`;
    case "Bin": {
      if (e.op === "+" && e.type === "string") return `(${asStr(e.l)} . ${asStr(e.r)})`;
      if (e.l.type === "string") {
        if (e.op === "==") return `(${E(e.l)} === ${E(e.r)})`;
        if (e.op === "!=") return `(${E(e.l)} !== ${E(e.r)})`;
        if (["<", ">", "<=", ">="].includes(e.op)) return `(strcmp(${E(e.l)}, ${E(e.r)}) ${e.op} 0)`; // < juggles numeric strings
      }
      if (e.op === "/" && e.type === "int") return `intdiv(${E(e.l)}, ${E(e.r)})`; // / always yields float
      if (e.op === "==") return `(${E(e.l)} === ${E(e.r)})`;
      if (e.op === "!=") return `(${E(e.l)} !== ${E(e.r)})`;
      return `(${E(e.l)} ${e.op} ${E(e.r)})`;
    }
    case "Array": return `[${e.elems.map(E).join(", ")}]`;
    case "NewArray": return `array_fill(0, ${E(e.size)}, 0)`;
    case "Index": return `${E(e.arr)}[${E(e.idx)}]`;
    case "Len": return e.arr.type === "string" ? `strlen(${E(e.arr)})` : `count(${E(e.arr)})`;
    case "StructLit": return `new ${e.name}(${e.args.map(E).join(", ")})`;
    case "Field": return `${E(e.obj)}->${e.name}`;
    case "Cond": return `((${E(e.c)}) ? ${E(e.t)} : ${E(e.f)})`;
    case "Substr": return `substr(${E(e.s)}, ${E(e.start)}, (${E(e.end)}) - (${E(e.start)}))`;
    case "Cast": return e.to === "int" ? `(int)(${E(e.e)})` : `(float)(${E(e.e)})`; // (int) truncates toward zero
    default: throw new Error(`php: unknown expr ${e.kind}`);
  }
}

function phpString(s) {
  // single quotes: no $-interpolation, only \' and \\ are special
  return "'" + s.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
}

module.exports = { emitPHP };
