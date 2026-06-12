"use strict";
// JavaScript-subset frontend: parses real JS syntax into the same IR the
// MiniLang frontend produces, then runs type inference to fill in the types the
// statically-typed backends (C, Go) need. Real JS has no type annotations, so
// `infer.js` reconstructs them from how values are used.
//
// Subset: function declarations, let/const/var, assignment (incl. += -= *= /=
// and ++ --), if/else-if/else, while, C-style for, return, console.log, calls,
// recursion, integer/string/bool expressions. (Phase 2a is integer-numeric; see
// README for what's deferred.)
const { TranspileError } = require("../lexer");
const { inferTypes } = require("../infer");

// ---- tokenizer -------------------------------------------------------------
const KEYWORDS = new Set(["function", "let", "const", "var", "return", "if", "else", "while", "for", "true", "false", "class", "new", "this", "break", "continue"]);
const OPS = [
  "===", "!==", "==", "!=", "<=", ">=", "+=", "-=", "*=", "/=", "&&", "||", "++", "--",
  "+", "-", "*", "/", "%", "=", "<", ">", "!", "(", ")", "{", "}", "[", "]", ",", ";", ".", "?", ":",
];

function tokenize(src) {
  const toks = [];
  let i = 0, line = 1, col = 1;
  const peek = (k = 0) => src[i + k];
  const adv = () => { const c = src[i++]; if (c === "\n") { line++; col = 1; } else col++; return c; };

  while (i < src.length) {
    const c = peek();
    if (c === " " || c === "\t" || c === "\r" || c === "\n") { adv(); continue; }
    if (c === "/" && peek(1) === "/") { while (i < src.length && peek() !== "\n") adv(); continue; }
    if (c === "/" && peek(1) === "*") { adv(); adv(); while (i < src.length && !(peek() === "*" && peek(1) === "/")) adv(); adv(); adv(); continue; }

    const sl = line, sc = col;
    if (/[0-9]/.test(c)) {
      let s = "";
      while (i < src.length && /[0-9]/.test(peek())) s += adv();
      if (peek() === "." && /[0-9]/.test(peek(1))) { s += adv(); while (i < src.length && /[0-9]/.test(peek())) s += adv(); toks.push({ kind: "float", value: parseFloat(s), line: sl, col: sc }); }
      else toks.push({ kind: "int", value: parseInt(s, 10), line: sl, col: sc });
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let s = "";
      while (i < src.length && /[A-Za-z0-9_$]/.test(peek())) s += adv();
      toks.push({ kind: KEYWORDS.has(s) ? "kw" : "id", value: s, line: sl, col: sc });
      continue;
    }
    if (c === '"' || c === "'") {
      const q = adv(); let s = "";
      while (i < src.length && peek() !== q) {
        let ch = adv();
        if (ch === "\\") { const e = adv(); ch = e === "n" ? "\n" : e === "t" ? "\t" : e === "\\" ? "\\" : e; }
        s += ch;
      }
      if (peek() !== q) throw new TranspileError("unterminated string", sl, sc);
      adv();
      toks.push({ kind: "str", value: s, line: sl, col: sc });
      continue;
    }
    let matched = null;
    for (const op of OPS) { if (src.startsWith(op, i)) { matched = op; break; } }
    if (matched) { for (let k = 0; k < matched.length; k++) adv(); toks.push({ kind: "op", value: matched, line: sl, col: sc }); continue; }
    throw new TranspileError(`unexpected character '${c}'`, sl, sc);
  }
  toks.push({ kind: "eof", value: null, line, col });
  return toks;
}

// ---- parser ----------------------------------------------------------------
function jsParse(src) {
  const toks = tokenize(src);
  let p = 0;
  const cur = () => toks[p];
  const at = (kind, value) => cur().kind === kind && (value === undefined || cur().value === value);
  const next = () => toks[p++];
  const isOp = (v) => at("op", v);
  const eatOp = (v) => { if (isOp(v)) { next(); return true; } return false; };
  function expect(kind, value) {
    if (!at(kind, value)) { const c = cur(); throw new TranspileError(`expected ${value ?? kind} but found '${c.value ?? c.kind}'`, c.line, c.col); }
    return next();
  }

  function program() {
    const funcs = [];
    const structs = [];
    while (!at("eof")) {
      if (at("kw", "function")) funcs.push(func());
      else if (at("kw", "class")) structs.push(classDecl());
      else stmt(); // discard top-level statements like `main();` — the IR's
                   // entry point is implicit and each backend re-emits the call
    }
    return { kind: "Program", funcs, structs };
  }

  // class Name { constructor(a, b) { this.a = a; this.b = b; } }  ->  Struct.
  // The IR constructs structs positionally, so the i-th field must be assigned
  // straight from the i-th constructor parameter. Field types are inferred from
  // `new Name(...)` call sites.
  function classDecl() {
    expect("kw", "class");
    const name = expect("id").value;
    expect("op", "{");
    expect("id", "constructor");
    expect("op", "(");
    const params = [];
    if (!isOp(")")) do { params.push(expect("id").value); } while (eatOp(","));
    expect("op", ")");
    expect("op", "{");
    const fields = [];
    while (!isOp("}")) {
      expect("kw", "this"); expect("op", ".");
      const fn = expect("id").value;
      expect("op", "=");
      const v = expect("id").value;
      expect("op", ";");
      if (v !== params[fields.length])
        throw new TranspileError(`constructor of '${name}' must assign its parameters to fields in order (this.${fn} = ${params[fields.length] ?? "?"})`);
      fields.push({ name: fn, type: null });
    }
    expect("op", "}");
    expect("op", "}");
    if (fields.length !== params.length)
      throw new TranspileError(`constructor of '${name}' must assign every parameter to a field`);
    return { kind: "Struct", name, fields };
  }

  function func() {
    expect("kw", "function");
    const name = expect("id").value;
    expect("op", "(");
    const params = [];
    if (!isOp(")")) do { params.push({ name: expect("id").value, type: null }); } while (eatOp(","));
    expect("op", ")");
    return { kind: "Func", name, params, ret: null, body: block() };
  }

  function block() {
    expect("op", "{");
    const stmts = [];
    while (!isOp("}")) stmts.push(stmt());
    expect("op", "}");
    return { kind: "Block", stmts };
  }

  function stamp(t0, node) {
    if (node && node.line == null && t0.line != null) { node.line = t0.line; node.col = t0.col; }
    return node;
  }
  function stmt() { return stamp(cur(), stmtRaw()); }
  function expr() { return stamp(cur(), exprRaw()); }

  function stmtRaw() {
    if (at("kw", "let") || at("kw", "const") || at("kw", "var")) return letStmt();
    if (at("kw", "return")) return returnStmt();
    if (at("kw", "if")) return ifStmt();
    if (at("kw", "while")) return whileStmt();
    if (at("kw", "for")) return forStmt();
    if (at("kw", "break")) { next(); expect("op", ";"); return { kind: "Break" }; }
    if (at("kw", "continue")) { next(); expect("op", ";"); return { kind: "Continue" }; }
    // console.log(...)
    if (at("id", "console") && toks[p + 1].kind === "op" && toks[p + 1].value === ".") {
      next(); expect("op", "."); const m = expect("id").value;
      if (m !== "log") throw new TranspileError(`only console.log is supported, not console.${m}`);
      expect("op", "("); const e = expr(); expect("op", ")"); expect("op", ";");
      return { kind: "Print", expr: e };
    }
    return simpleStmt(true);
  }

  // parse an lvalue/expression, then any assignment that follows. Handles
  // `x = e`, `a[i] = e`, `x += e`, and `x++`. semi controls a trailing ';'.
  function simpleStmt(semi) {
    const e = expr();
    let node;
    if (isOp("=")) {
      next(); const rhs = expr();
      if (e.kind === "Var") node = { kind: "Assign", name: e.name, expr: rhs };
      else if (e.kind === "Index") node = { kind: "IndexAssign", arr: e.arr, idx: e.idx, expr: rhs };
      else if (e.kind === "Field") node = { kind: "FieldAssign", obj: e.obj, name: e.name, expr: rhs };
      else throw new TranspileError("invalid assignment target");
    } else if (["+=", "-=", "*=", "/="].some((o) => isOp(o))) {
      const op = next().value, rhs = expr();
      if (e.kind === "Var") node = { kind: "Assign", name: e.name, expr: { kind: "Bin", op: op[0], l: { kind: "Var", name: e.name }, r: rhs } };
      else if (e.kind === "Field") node = { kind: "FieldAssign", obj: e.obj, name: e.name, expr: { kind: "Bin", op: op[0], l: e, r: rhs } };
      else throw new TranspileError("invalid compound-assignment target");
    } else if (isOp("++") || isOp("--")) {
      const op = next().value;
      const one = { kind: "Int", value: 1 };
      if (e.kind === "Var") node = { kind: "Assign", name: e.name, expr: { kind: "Bin", op: op === "++" ? "+" : "-", l: { kind: "Var", name: e.name }, r: one } };
      else if (e.kind === "Field") node = { kind: "FieldAssign", obj: e.obj, name: e.name, expr: { kind: "Bin", op: op === "++" ? "+" : "-", l: e, r: one } };
      else throw new TranspileError("invalid ++/-- target");
    } else {
      node = { kind: "ExprStmt", expr: e };
    }
    if (semi) expect("op", ";");
    return node;
  }

  function letStmt() {
    next(); // let/const/var
    const name = expect("id").value;
    expect("op", "=");
    const e = expr();
    expect("op", ";");
    return { kind: "Let", name, type: null, expr: e };
  }

  function returnStmt() {
    expect("kw", "return");
    let e = null;
    if (!isOp(";")) e = expr();
    expect("op", ";");
    return { kind: "Return", expr: e };
  }

  function ifStmt() {
    expect("kw", "if"); expect("op", "(");
    const cond = expr(); expect("op", ")");
    const then = block();
    let els = null;
    if (at("kw", "else")) { next(); els = at("kw", "if") ? { kind: "Block", stmts: [ifStmt()] } : block(); }
    return { kind: "If", cond, then, els };
  }

  function whileStmt() {
    expect("kw", "while"); expect("op", "(");
    const cond = expr(); expect("op", ")");
    return { kind: "While", cond, body: block() };
  }

  // for(init; cond; update) body — a real For node (continue must run update)
  function forStmt() {
    expect("kw", "for"); expect("op", "(");
    const init = (at("kw", "let") || at("kw", "const") || at("kw", "var")) ? letNoSemi() : simpleStmt(false);
    expect("op", ";");
    const cond = expr(); expect("op", ";");
    const upd = simpleStmt(false);
    expect("op", ")");
    const body = block();
    return { kind: "For", init, cond, post: upd, body };
  }

  function letNoSemi() {
    next(); const name = expect("id").value; expect("op", "=");
    return { kind: "Let", name, type: null, expr: expr() };
  }

  // expressions (low -> high precedence); ?: above ||, right-assoc
  function exprRaw() {
    const c = orExpr();
    if (isOp("?")) {
      next();
      const t = expr();
      expect("op", ":");
      const f = expr();
      return { kind: "Cond", c, t, f };
    }
    return c;
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
  const mul = binLevel(() => unary(), ["*", "/", "%"]);
  const add = binLevel(mul, ["+", "-"]);
  const rel = binLevel(add, ["<", ">", "<=", ">="]);
  const eq = binLevel(rel, ["==", "!=", "===", "!=="], (o) => (o === "===" ? "==" : o === "!==" ? "!=" : o));
  const and = binLevel(eq, ["&&"]);
  const orExpr = binLevel(and, ["||"]);

  function unary() {
    if (isOp("-") || isOp("!")) { const op = next().value; return { kind: "Un", op, e: unary() }; }
    return primary();
  }

  // primary with postfix:  a[i],  a.length (array length),  p.field
  function primary() {
    let e = primaryBase();
    for (;;) {
      if (isOp("[")) { next(); const idx = expr(); expect("op", "]"); e = { kind: "Index", arr: e, idx }; }
      else if (isOp(".")) {
        next(); const m = expect("id").value;
        if (isOp("(")) { // method call — only a small set is supported
          next(); const args = [];
          if (!isOp(")")) do { args.push(expr()); } while (eatOp(","));
          expect("op", ")");
          if (m === "substring" && args.length === 2) { e = { kind: "Substr", s: e, start: args[0], end: args[1] }; continue; }
          if (m === "trunc" && e.kind === "Var" && e.name === "Math" && args.length === 1) { e = { kind: "Cast", to: "int", e: args[0] }; continue; }
          throw new TranspileError(`unsupported method .${m}()`);
        }
        e = m === "length" ? { kind: "Len", arr: e } : { kind: "Field", obj: e, name: m };
      }
      else break;
    }
    return e;
  }

  function primaryBase() {
    const c = cur();
    if (c.kind === "int") { next(); return { kind: "Int", value: c.value }; }
    if (c.kind === "float") { next(); return { kind: "Float", value: c.value }; }
    if (c.kind === "str") { next(); return { kind: "Str", value: c.value }; }
    if (at("kw", "true")) { next(); return { kind: "Bool", value: true }; }
    if (at("kw", "false")) { next(); return { kind: "Bool", value: false }; }
    if (at("kw", "new")) { // new Name(args) -> constructor Call (checker -> StructLit)
      next();
      const name = expect("id").value;
      expect("op", "(");
      const args = [];
      if (!isOp(")")) do { args.push(expr()); } while (eatOp(","));
      expect("op", ")");
      return { kind: "Call", name, args };
    }
    if (isOp("(")) { next(); const e = expr(); expect("op", ")"); return e; }
    if (isOp("[")) { // array literal
      next(); const elems = [];
      if (!isOp("]")) do { elems.push(expr()); } while (eatOp(","));
      expect("op", "]");
      return { kind: "Array", elems };
    }
    if (c.kind === "id") {
      next();
      if (isOp("(")) {
        next(); const args = [];
        if (!isOp(")")) do { args.push(expr()); } while (eatOp(","));
        expect("op", ")");
        return { kind: "Call", name: c.value, args };
      }
      return { kind: "Var", name: c.value };
    }
    throw new TranspileError(`unexpected '${c.value ?? c.kind}'`, c.line, c.col);
  }

  return program();
}

// frontend entry: parse JS, then infer the types the IR/backends require.
function parse(src) {
  const ir = jsParse(src);
  inferTypes(ir);
  return ir;
}

module.exports = { parse };
