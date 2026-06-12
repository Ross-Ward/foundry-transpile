"use strict";
// Python-subset frontend: parses real Python into the shared IR, then runs the
// same type inference the JavaScript frontend uses. The hard part is Python's
// significant whitespace — the tokenizer emits INDENT / DEDENT / NEWLINE tokens
// (like CPython's own tokenizer) so the parser can stay a normal recursive
// descent.
//
// Subset: def, assignment (first one declares; += -= *= update), if/elif/else,
// while, `for i in range(...)`, return, print(), and/or/not, // (int division),
// recursion, int/string/bool expressions. Names are function-scoped, matching
// Python (see README for the block-scope caveat).
const { TranspileError } = require("../lexer");
const { inferTypes } = require("../infer");

const KEYWORDS = new Set(["def", "return", "if", "elif", "else", "while", "for", "in", "and", "or", "not", "True", "False", "pass", "class", "break", "continue"]);
const OPS = ["==", "!=", "<=", ">=", "//", "+=", "-=", "*=", "+", "-", "*", "/", "%", "=", "<", ">", "(", ")", "[", "]", ",", ":", "."];

// ---- tokenizer with INDENT / DEDENT / NEWLINE ------------------------------
function tokenize(src) {
  const toks = [];
  const indents = [0];
  const lines = src.replace(/\r\n/g, "\n").split("\n");

  for (let ln = 0; ln < lines.length; ln++) {
    const raw = lines[ln];
    // measure indentation; skip blank / comment-only lines entirely
    let i = 0, indent = 0;
    while (i < raw.length && (raw[i] === " " || raw[i] === "\t")) { indent += raw[i] === "\t" ? 8 : 1; i++; }
    const rest = raw.slice(i);
    if (rest === "" || rest[0] === "#") continue;

    if (indent > indents[indents.length - 1]) { indents.push(indent); toks.push({ kind: "INDENT" }); }
    while (indent < indents[indents.length - 1]) { indents.pop(); toks.push({ kind: "DEDENT" }); }
    if (indent !== indents[indents.length - 1]) throw new TranspileError(`inconsistent indentation`, ln + 1, 1);

    // tokenize the line contents
    let j = 0;
    const peek = (k = 0) => rest[j + k];
    while (j < rest.length) {
      const c = peek();
      if (c === " " || c === "\t") { j++; continue; }
      if (c === "#") break; // rest of line is a comment
      const col = i + j + 1;
      if (/[0-9]/.test(c)) {
        let s = "";
        while (j < rest.length && /[0-9]/.test(peek())) s += rest[j++];
        if (peek() === "." && /[0-9]/.test(peek(1))) { s += rest[j++]; while (j < rest.length && /[0-9]/.test(peek())) s += rest[j++]; toks.push({ kind: "float", value: parseFloat(s), line: ln + 1, col }); }
        else toks.push({ kind: "int", value: parseInt(s, 10), line: ln + 1, col });
        continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        let s = "";
        while (j < rest.length && /[A-Za-z0-9_]/.test(peek())) s += rest[j++];
        toks.push({ kind: KEYWORDS.has(s) ? "kw" : "id", value: s, line: ln + 1, col });
        continue;
      }
      if (c === '"' || c === "'") {
        const q = rest[j++]; let s = "";
        while (j < rest.length && peek() !== q) {
          let ch = rest[j++];
          if (ch === "\\") { const e = rest[j++]; ch = e === "n" ? "\n" : e === "t" ? "\t" : e === "\\" ? "\\" : e; }
          s += ch;
        }
        if (peek() !== q) throw new TranspileError("unterminated string", ln + 1, col);
        j++;
        toks.push({ kind: "str", value: s, line: ln + 1, col });
        continue;
      }
      let matched = null;
      for (const op of OPS) { if (rest.startsWith(op, j)) { matched = op; break; } }
      if (matched) { j += matched.length; toks.push({ kind: "op", value: matched, line: ln + 1, col }); continue; }
      throw new TranspileError(`unexpected character '${c}'`, ln + 1, col);
    }
    toks.push({ kind: "NEWLINE" });
  }
  while (indents.length > 1) { indents.pop(); toks.push({ kind: "DEDENT" }); }
  toks.push({ kind: "eof" });
  return toks;
}

// ---- parser ----------------------------------------------------------------
function pyParse(src) {
  const toks = tokenize(src);
  let p = 0;
  let declared = new Set();
  const cur = () => toks[p];
  const at = (kind, value) => cur().kind === kind && (value === undefined || cur().value === value);
  const next = () => toks[p++];
  const isOp = (v) => at("op", v);
  function expect(kind, value) {
    if (!at(kind, value)) { const c = cur(); throw new TranspileError(`expected ${value ?? kind} but found '${c.value ?? c.kind}'`, c.line || 0, c.col || 0); }
    return next();
  }

  function program() {
    const funcs = [];
    const structs = [];
    while (!at("eof")) {
      if (at("kw", "def")) funcs.push(def());
      else if (at("kw", "class")) structs.push(classDecl());
      else { stmt(); } // discard top-level statements like `main()`
    }
    return { kind: "Program", funcs, structs };
  }

  // class Name:                       -> Struct. Positional IR construction
  //     def __init__(self, a, b):        means the i-th field must be assigned
  //         self.a = a                    straight from the i-th parameter;
  //         self.b = b                    field types come from call sites.
  function classDecl() {
    expect("kw", "class");
    const name = expect("id").value;
    expect("op", ":");
    expect("NEWLINE"); expect("INDENT");
    expect("kw", "def");
    const ctor = expect("id").value;
    if (ctor !== "__init__") throw new TranspileError(`class '${name}' may only define __init__, not '${ctor}'`);
    expect("op", "(");
    const self = expect("id").value;
    if (self !== "self") throw new TranspileError(`__init__ of '${name}' must take self first`);
    const params = [];
    while (eatOp(",")) params.push(expect("id").value);
    expect("op", ")"); expect("op", ":");
    expect("NEWLINE"); expect("INDENT");
    const fields = [];
    while (!at("DEDENT")) {
      const s = expect("id").value;
      if (s !== "self") throw new TranspileError(`__init__ of '${name}' may only contain self.field = param lines`);
      expect("op", ".");
      const fn = expect("id").value;
      expect("op", "=");
      const v = expect("id").value;
      expect("NEWLINE");
      if (v !== params[fields.length])
        throw new TranspileError(`__init__ of '${name}' must assign its parameters to fields in order (self.${fn} = ${params[fields.length] ?? "?"})`);
      fields.push({ name: fn, type: null });
    }
    expect("DEDENT"); expect("DEDENT");
    if (fields.length !== params.length)
      throw new TranspileError(`__init__ of '${name}' must assign every parameter to a field`);
    return { kind: "Struct", name, fields };
  }

  function def() {
    expect("kw", "def");
    const name = expect("id").value;
    expect("op", "(");
    const params = [];
    if (!isOp(")")) do { params.push({ name: expect("id").value, type: null }); } while (eatOp(","));
    expect("op", ")");
    expect("op", ":");
    declared = new Set(params.map((p) => p.name));
    return { kind: "Func", name, params, ret: null, body: suite() };
  }

  function eatOp(v) { if (isOp(v)) { next(); return true; } return false; }

  function suite() {
    expect("NEWLINE");
    expect("INDENT");
    const stmts = [];
    while (!at("DEDENT")) {
      const s = stmt();
      if (s) stmts.push(s);
    }
    expect("DEDENT");
    return { kind: "Block", stmts };
  }

  function stamp(t0, node) {
    if (node && node.line == null && t0.line != null) { node.line = t0.line; node.col = t0.col; }
    return node;
  }
  function stmt() { return stamp(cur(), stmtRaw()); }
  function expr() { return stamp(cur(), exprRaw()); }

  function stmtRaw() {
    if (at("kw", "pass")) { next(); expect("NEWLINE"); return null; }
    if (at("kw", "break")) { next(); expect("NEWLINE"); return { kind: "Break" }; }
    if (at("kw", "continue")) { next(); expect("NEWLINE"); return { kind: "Continue" }; }
    if (at("kw", "return")) return returnStmt();
    if (at("kw", "if")) return ifStmt();
    if (at("kw", "while")) return whileStmt();
    if (at("kw", "for")) return forStmt();
    if (at("id", "print") && toks[p + 1].kind === "op" && toks[p + 1].value === "(") {
      next(); expect("op", "("); const e = expr(); expect("op", ")"); expect("NEWLINE");
      return { kind: "Print", expr: e };
    }
    // assignment (variable, with first-assignment declaring, or array element) or expression
    const e = expr();
    if (isOp("=")) {
      next(); const rhs = expr(); expect("NEWLINE");
      if (e.kind === "Var") {
        if (declared.has(e.name)) return { kind: "Assign", name: e.name, expr: rhs };
        declared.add(e.name);
        return { kind: "Let", name: e.name, type: null, expr: rhs };
      }
      if (e.kind === "Index") return { kind: "IndexAssign", arr: e.arr, idx: e.idx, expr: rhs };
      if (e.kind === "Field") return { kind: "FieldAssign", obj: e.obj, name: e.name, expr: rhs };
      throw new TranspileError("invalid assignment target");
    }
    if (["+=", "-=", "*="].some((o) => isOp(o))) {
      const op = next().value, rhs = expr(); expect("NEWLINE");
      if (e.kind === "Var") return { kind: "Assign", name: e.name, expr: { kind: "Bin", op: op[0], l: { kind: "Var", name: e.name }, r: rhs } };
      if (e.kind === "Field") return { kind: "FieldAssign", obj: e.obj, name: e.name, expr: { kind: "Bin", op: op[0], l: e, r: rhs } };
      throw new TranspileError("invalid compound-assignment target");
    }
    expect("NEWLINE");
    return { kind: "ExprStmt", expr: e };
  }

  function returnStmt() {
    expect("kw", "return");
    let e = null;
    if (!at("NEWLINE")) e = expr();
    expect("NEWLINE");
    return { kind: "Return", expr: e };
  }

  function ifStmt() {
    expect("kw", "if");
    const cond = expr(); expect("op", ":");
    const then = suite();
    return { kind: "If", cond, then, els: elifElse() };
  }
  function elifElse() {
    if (at("kw", "elif")) {
      next();
      const cond = expr(); expect("op", ":");
      const then = suite();
      return { kind: "Block", stmts: [{ kind: "If", cond, then, els: elifElse() }] };
    }
    if (at("kw", "else")) { next(); expect("op", ":"); return suite(); }
    return null;
  }

  function whileStmt() {
    expect("kw", "while");
    const cond = expr(); expect("op", ":");
    return { kind: "While", cond, body: suite() };
  }

  // for i in range(a[, b[, step]]):  =>  { i = start; while i < stop { ...; i = i + step } }
  function forStmt() {
    expect("kw", "for");
    const name = expect("id").value;
    expect("kw", "in");
    if (!at("id", "range")) throw new TranspileError("only `for x in range(...)` is supported");
    next(); expect("op", "(");
    const args = [expr()];
    while (eatOp(",")) args.push(expr());
    expect("op", ")"); expect("op", ":");
    const body = suite();

    let start, stop, step;
    if (args.length === 1) { start = { kind: "Int", value: 0 }; stop = args[0]; step = { kind: "Int", value: 1 }; }
    else if (args.length === 2) { start = args[0]; stop = args[1]; step = { kind: "Int", value: 1 }; }
    else { start = args[0]; stop = args[1]; step = args[2]; }

    declared.add(name);
    return {
      kind: "For",
      init: { kind: "Let", name, type: null, expr: start },
      cond: { kind: "Bin", op: "<", l: { kind: "Var", name }, r: stop },
      post: { kind: "Assign", name, expr: { kind: "Bin", op: "+", l: { kind: "Var", name }, r: step } },
      body,
    };
  }

  // expressions; `a if c else b` (conditional expression) above or
  function exprRaw() {
    const t = orExpr();
    if (at("kw", "if")) {
      next();
      const c = orExpr();
      expect("kw", "else");
      const f = expr();
      return { kind: "Cond", c, t, f };
    }
    return t;
  }
  function binLevel(sub, ops, map) {
    return () => {
      let left = sub();
      while (cur().kind === "op" && ops.includes(cur().value)) {
        const raw = next().value;
        left = { kind: "Bin", op: map ? map(raw) : raw, l: left, r: sub() };
      }
      return left;
    };
  }
  const mul = binLevel(() => unary(), ["*", "/", "//", "%"], (o) => (o === "//" ? "/" : o));
  const add = binLevel(mul, ["+", "-"]);
  const cmp = binLevel(add, ["==", "!=", "<", ">", "<=", ">="]);
  function notExpr() { if (at("kw", "not")) { next(); return { kind: "Un", op: "!", e: notExpr() }; } return cmp(); }
  function parseAnd() { let l = notExpr(); while (at("kw", "and")) { next(); l = { kind: "Bin", op: "&&", l, r: notExpr() }; } return l; }
  function orExpr() { let l = parseAnd(); while (at("kw", "or")) { next(); l = { kind: "Bin", op: "||", l, r: parseAnd() }; } return l; }

  function unary() {
    if (isOp("-")) { next(); return { kind: "Un", op: "-", e: unary() }; }
    return primary();
  }

  function primary() {
    let e = primaryBase();
    while (isOp("[") || isOp(".")) {
      if (eatOp(".")) { e = { kind: "Field", obj: e, name: expect("id").value }; continue; }
      next(); const idx = expr();
      if (eatOp(":")) { // slice: s[a:b] -> substr (end-exclusive, like Python)
        const end = expr();
        expect("op", "]");
        e = { kind: "Substr", s: e, start: idx, end };
        continue;
      }
      expect("op", "]");
      e = { kind: "Index", arr: e, idx };
    }
    return e;
  }
  function primaryBase() {
    const c = cur();
    if (c.kind === "int") { next(); return { kind: "Int", value: c.value }; }
    if (c.kind === "float") { next(); return { kind: "Float", value: c.value }; }
    if (c.kind === "str") { next(); return { kind: "Str", value: c.value }; }
    if (at("kw", "True")) { next(); return { kind: "Bool", value: true }; }
    if (at("kw", "False")) { next(); return { kind: "Bool", value: false }; }
    if (isOp("(")) { next(); const e = expr(); expect("op", ")"); return e; }
    if (isOp("[")) { next(); const elems = []; if (!isOp("]")) do { elems.push(expr()); } while (eatOp(",")); expect("op", "]"); return { kind: "Array", elems }; }
    if (c.kind === "id") {
      next();
      if (isOp("(")) {
        next(); const args = [];
        if (!isOp(")")) do { args.push(expr()); } while (eatOp(","));
        expect("op", ")");
        if (c.value === "len" && args.length === 1) return { kind: "Len", arr: args[0] }; // builtin
        if ((c.value === "int" || c.value === "float") && args.length === 1) return { kind: "Cast", to: c.value, e: args[0] };
        return { kind: "Call", name: c.value, args };
      }
      return { kind: "Var", name: c.value };
    }
    throw new TranspileError(`unexpected '${c.value ?? c.kind}'`, c.line || 0, c.col || 0);
  }

  return program();
}

function parse(src) {
  const ir = pyParse(src);
  inferTypes(ir);
  return ir;
}

module.exports = { parse };
