"use strict";
// TypeScript-subset frontend: real TS syntax (function, let/const, console.log,
// ===) with type annotations. Because the parameter and return types are written
// down, this frontend needs no inference for them — it fills the IR types
// directly and only infers un-annotated local `let`s from their initializers.
//
// Accepted annotation types: int, float, number (->int), bool/boolean, string,
// void. Subset mirrors the JS frontend plus `: T` annotations.
const { TranspileError } = require("../lexer");

const TYPE_MAP = { int: "int", float: "float", number: "int", bool: "bool", boolean: "bool", string: "string", void: "void" };
const KEYWORDS = new Set(["function", "let", "const", "var", "return", "if", "else", "while", "for", "true", "false"]);
const OPS = [
  "===", "!==", "==", "!=", "<=", ">=", "+=", "-=", "*=", "/=", "&&", "||", "++", "--",
  "+", "-", "*", "/", "%", "=", "<", ">", "!", "(", ")", "{", "}", "[", "]", ",", ";", ":", ".",
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
      while (i < src.length && peek() !== q) { let ch = adv(); if (ch === "\\") { const e = adv(); ch = e === "n" ? "\n" : e === "t" ? "\t" : e === "\\" ? "\\" : e; } s += ch; }
      if (peek() !== q) throw new TranspileError("unterminated string", sl, sc);
      adv(); toks.push({ kind: "str", value: s, line: sl, col: sc }); continue;
    }
    let m = null;
    for (const op of OPS) { if (src.startsWith(op, i)) { m = op; break; } }
    if (m) { for (let k = 0; k < m.length; k++) adv(); toks.push({ kind: "op", value: m, line: sl, col: sc }); continue; }
    throw new TranspileError(`unexpected character '${c}'`, sl, sc);
  }
  toks.push({ kind: "eof", value: null, line, col });
  return toks;
}

function tsParse(src) {
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
  function typeName() {
    const t = expect("id").value;
    if (!(t in TYPE_MAP)) throw new TranspileError(`unknown type '${t}'`);
    let ty = TYPE_MAP[t];
    while (isOp("[")) { next(); expect("op", "]"); ty += "[]"; } // array type: int[] / number[]
    return ty;
  }

  function program() {
    const funcs = [];
    while (!at("eof")) { if (at("kw", "function")) funcs.push(func()); else stmt(); }
    return { kind: "Program", funcs };
  }

  function func() {
    expect("kw", "function");
    const name = expect("id").value;
    expect("op", "(");
    const params = [];
    if (!isOp(")")) do {
      const pn = expect("id").value;
      expect("op", ":");
      params.push({ name: pn, type: typeName() });
    } while (eatOp(","));
    expect("op", ")");
    expect("op", ":");          // return type is required
    const ret = typeName();
    return { kind: "Func", name, params, ret, body: block() };
  }

  function block() {
    expect("op", "{");
    const stmts = [];
    while (!isOp("}")) stmts.push(stmt());
    expect("op", "}");
    return { kind: "Block", stmts };
  }

  function stmt() {
    if (at("kw", "let") || at("kw", "const") || at("kw", "var")) return letStmt();
    if (at("kw", "return")) return returnStmt();
    if (at("kw", "if")) return ifStmt();
    if (at("kw", "while")) return whileStmt();
    if (at("kw", "for")) return forStmt();
    if (at("id", "console") && toks[p + 1].kind === "op" && toks[p + 1].value === ".") {
      next(); expect("op", "."); const m = expect("id").value;
      if (m !== "log") throw new TranspileError(`only console.log is supported, not console.${m}`);
      expect("op", "("); const e = expr(); expect("op", ")"); expect("op", ";");
      return { kind: "Print", expr: e };
    }
    return simpleStmt(true);
  }

  function simpleStmt(semi) {
    const e = expr();
    let node;
    if (isOp("=")) {
      next(); const rhs = expr();
      if (e.kind === "Var") node = { kind: "Assign", name: e.name, expr: rhs };
      else if (e.kind === "Index") node = { kind: "IndexAssign", arr: e.arr, idx: e.idx, expr: rhs };
      else throw new TranspileError("invalid assignment target");
    } else if (["+=", "-=", "*=", "/="].some((o) => isOp(o))) {
      const op = next().value, rhs = expr();
      if (e.kind !== "Var") throw new TranspileError("invalid compound-assignment target");
      node = { kind: "Assign", name: e.name, expr: { kind: "Bin", op: op[0], l: { kind: "Var", name: e.name }, r: rhs } };
    } else if (isOp("++") || isOp("--")) {
      const op = next().value;
      if (e.kind !== "Var") throw new TranspileError("invalid ++/-- target");
      node = { kind: "Assign", name: e.name, expr: { kind: "Bin", op: op === "++" ? "+" : "-", l: { kind: "Var", name: e.name }, r: { kind: "Int", value: 1 } } };
    } else {
      node = { kind: "ExprStmt", expr: e };
    }
    if (semi) expect("op", ";");
    return node;
  }

  function letStmt() {
    next();
    const name = expect("id").value;
    let type = null;
    if (eatOp(":")) type = typeName();   // annotation optional on locals
    expect("op", "=");
    const e = expr();
    expect("op", ";");
    return { kind: "Let", name, type, expr: e };
  }
  function letNoSemi() {
    next();
    const name = expect("id").value;
    let type = null;
    if (eatOp(":")) type = typeName();
    expect("op", "=");
    return { kind: "Let", name, type, expr: expr() };
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
  function forStmt() {
    expect("kw", "for"); expect("op", "(");
    const init = (at("kw", "let") || at("kw", "const") || at("kw", "var")) ? letNoSemi() : simpleStmt(false);
    expect("op", ";");
    const cond = expr(); expect("op", ";");
    const upd = simpleStmt(false);
    expect("op", ")");
    const body = block();
    return { kind: "Block", stmts: [init, { kind: "While", cond, body: { kind: "Block", stmts: [...body.stmts, upd] } }] };
  }

  function expr() { return orExpr(); }
  function binLevel(sub, ops, map) {
    return () => {
      let left = sub();
      while (cur().kind === "op" && ops.includes(cur().value)) { const raw = next().value; left = { kind: "Bin", op: map ? map(raw) : raw, l: left, r: sub() }; }
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
  function primary() {
    let e = primaryBase();
    for (;;) {
      if (isOp("[")) { next(); const idx = expr(); expect("op", "]"); e = { kind: "Index", arr: e, idx }; }
      else if (isOp(".")) { next(); const m = expect("id").value; if (m !== "length") throw new TranspileError(`only .length is supported, not .${m}`); e = { kind: "Len", arr: e }; }
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
    if (isOp("(")) { next(); const e = expr(); expect("op", ")"); return e; }
    if (isOp("[")) { next(); const elems = []; if (!isOp("]")) do { elems.push(expr()); } while (eatOp(",")); expect("op", "]"); return { kind: "Array", elems }; }
    if (c.kind === "id") {
      next();
      if (isOp("(")) { next(); const args = []; if (!isOp(")")) do { args.push(expr()); } while (eatOp(",")); expect("op", ")"); return { kind: "Call", name: c.value, args }; }
      return { kind: "Var", name: c.value };
    }
    throw new TranspileError(`unexpected '${c.value ?? c.kind}'`, c.line, c.col);
  }

  return program();
}

// Fill un-annotated local `let` types from their initializers (params and
// returns are always annotated in this subset).
function fillLetTypes(program) {
  const funcs = new Map(program.funcs.map((f) => [f.name, f]));
  for (const f of program.funcs) {
    const env = new Map();
    for (const p of f.params) env.set(p.name, p.type);
    fillBlock(f.body, env, funcs);
  }
}
function fillBlock(block, env, funcs) {
  for (const s of block.stmts) {
    if (s.kind === "Let") { if (!s.type) s.type = typeOf(s.expr, env, funcs); env.set(s.name, s.type); }
    else if (s.kind === "If") { fillBlock(s.then, new Map(env), funcs); if (s.els) fillBlock(s.els, new Map(env), funcs); }
    else if (s.kind === "While") fillBlock(s.body, new Map(env), funcs);
    else if (s.kind === "Block") fillBlock(s, new Map(env), funcs);
  }
}
function typeOf(e, env, funcs) {
  switch (e.kind) {
    case "Int": return "int";
    case "Float": return "float";
    case "Str": return "string";
    case "Bool": return "bool";
    case "Var": return env.get(e.name) || "int";
    case "Un": return e.op === "!" ? "bool" : typeOf(e.e, env, funcs);
    case "Call": return (funcs.get(e.name) && funcs.get(e.name).ret) || "int";
    case "Bin": {
      const op = e.op;
      if (["<", ">", "<=", ">=", "==", "!=", "&&", "||"].includes(op)) return "bool";
      const lt = typeOf(e.l, env, funcs), rt = typeOf(e.r, env, funcs);
      if (op === "+" && (lt === "string" || rt === "string")) return "string";
      if (op === "%") return "int";
      return lt === "float" || rt === "float" ? "float" : "int";
    }
    default: return "int";
  }
}

function parse(src) {
  const ir = tsParse(src);
  fillLetTypes(ir);
  return ir;
}

module.exports = { parse };
