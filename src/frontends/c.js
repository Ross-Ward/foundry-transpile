"use strict";
// C-subset frontend: parses real C into the shared IR. C is statically typed, so
// types come straight from declarations (no inference). `#...` preprocessor
// lines are skipped, `printf(...)` maps to print (its format string is split
// into literals + values and rebuilt as a concatenation), and `int main()` is
// mapped to the IR's void `main` with its `return 0;` dropped.
//
// Types: int, double(->float), bool, const char*/char*(->string), void.
// Arrays: `T a[] = {...}` / `T a[n]` declarations, `T a[]` / `T*` parameters
// (decayed pointers ARE the array in this subset), indexing, index assignment,
// and the `sizeof(a) / sizeof(a[0])` length idiom (-> Len).
const { TranspileError } = require("../lexer");

const KEYWORDS = new Set(["int", "double", "bool", "char", "void", "const", "if", "else", "while", "for", "return", "true", "false", "struct"]);
const OPS = [
  "==", "!=", "<=", ">=", "+=", "-=", "*=", "/=", "&&", "||", "++", "--", "->",
  "+", "-", "*", "/", "%", "=", "<", ">", "!", "&", "(", ")", "{", "}", "[", "]", ",", ";", ".",
];

function tokenize(src) {
  const toks = [];
  let i = 0, line = 1, col = 1, atLineStart = true;
  const peek = (k = 0) => src[i + k];
  const adv = () => { const c = src[i++]; if (c === "\n") { line++; col = 1; atLineStart = true; } else { col++; if (c !== " " && c !== "\t") atLineStart = false; } return c; };
  while (i < src.length) {
    const c = peek();
    if (c === "\n" || c === "\r") { adv(); continue; }
    if (c === " " || c === "\t") { adv(); continue; }
    if (atLineStart && c === "#") { while (i < src.length && peek() !== "\n") adv(); continue; } // preprocessor
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
    if (/[A-Za-z_]/.test(c)) {
      let s = "";
      while (i < src.length && /[A-Za-z0-9_]/.test(peek())) s += adv();
      toks.push({ kind: KEYWORDS.has(s) ? "kw" : "id", value: s, line: sl, col: sc });
      continue;
    }
    if (c === '"') {
      adv(); let s = "";
      while (i < src.length && peek() !== '"') { let ch = adv(); if (ch === "\\") { const e = adv(); ch = e === "n" ? "\n" : e === "t" ? "\t" : e === "\\" ? "\\" : e === '"' ? '"' : e; } s += ch; }
      if (peek() !== '"') throw new TranspileError("unterminated string", sl, sc);
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

function cParse(src) {
  const toks = tokenize(src);
  let p = 0;
  let inMain = false;
  const cur = () => toks[p];
  const at = (kind, value) => cur().kind === kind && (value === undefined || cur().value === value);
  const next = () => toks[p++];
  const isOp = (v) => at("op", v);
  const eatOp = (v) => { if (isOp(v)) { next(); return true; } return false; };
  function expect(kind, value) {
    if (!at(kind, value)) { const c = cur(); throw new TranspileError(`expected ${value ?? kind} but found '${c.value ?? c.kind}'`, c.line, c.col); }
    return next();
  }

  const structNames = new Set();
  function isTypeStart() { return at("kw", "int") || at("kw", "double") || at("kw", "bool") || at("kw", "char") || at("kw", "void") || at("kw", "const") || at("kw", "struct"); }
  function parseType() {
    if (at("kw", "const")) next();
    if (at("kw", "struct")) { // struct Name (value) / struct Name * (the reference) — same IR type
      next();
      const sn = expect("id").value;
      if (!structNames.has(sn)) throw new TranspileError(`unknown struct '${sn}'`);
      eatOp("*");
      return sn;
    }
    const base = expect("kw").value;
    if (base === "char") { expect("op", "*"); return "string"; }
    let t;
    if (base === "double") t = "float";
    else if (base === "int" || base === "bool" || base === "void") t = base;
    else throw new TranspileError(`unsupported type '${base}'`);
    if (eatOp("*")) { // `int*` / `double*` — a decayed array
      if (t === "void") throw new TranspileError("void* is not supported");
      t = t + "[]";
    }
    return t;
  }
  function defaultValue(t) {
    return t === "float" ? { kind: "Float", value: 0 } : t === "bool" ? { kind: "Bool", value: false } : t === "string" ? { kind: "Str", value: "" } : { kind: "Int", value: 0 };
  }

  function program() {
    const funcs = [];
    const structs = [];
    while (!at("eof")) {
      // `struct Name {` is a declaration; `struct Name` elsewhere is a type use
      if (at("kw", "struct") && toks[p + 2] && toks[p + 2].kind === "op" && toks[p + 2].value === "{") structs.push(structDecl());
      else funcs.push(func());
    }
    return { kind: "Program", funcs, structs };
  }

  // struct Point { int x; int y; };
  function structDecl() {
    expect("kw", "struct");
    const name = expect("id").value;
    structNames.add(name); // visible to its own fields' parse and everything after
    expect("op", "{");
    const fields = [];
    while (!isOp("}")) {
      const ft = parseType();
      const fn = expect("id").value;
      expect("op", ";");
      fields.push({ name: fn, type: ft });
    }
    expect("op", "}");
    expect("op", ";");
    return { kind: "Struct", name, fields };
  }

  function func() {
    const ret = parseType();
    const name = expect("id").value;
    expect("op", "(");
    const params = [];
    if (!isOp(")")) {
      if (at("kw", "void") && toks[p + 1].kind === "op" && toks[p + 1].value === ")") { next(); } // (void)
      else do {
        let t = parseType();
        const pn = expect("id").value;
        if (eatOp("[")) { expect("op", "]"); if (!t.endsWith("[]")) t = t + "[]"; } // `int a[]` param
        params.push({ name: pn, type: t });
      } while (eatOp(","));
    }
    expect("op", ")");
    const isMain = name === "main";
    inMain = isMain;
    const body = block();
    inMain = false;
    // C's `int main` becomes the IR's void main
    return { kind: "Func", name, params, ret: isMain ? "void" : ret, body };
  }

  function block() {
    expect("op", "{");
    const stmts = [];
    while (!isOp("}")) { const s = stmt(); if (s) stmts.push(s); }
    expect("op", "}");
    return { kind: "Block", stmts };
  }

  function stmt() {
    if (isTypeStart()) return declStmt();
    if (at("kw", "return")) return returnStmt();
    if (at("kw", "if")) return ifStmt();
    if (at("kw", "while")) return whileStmt();
    if (at("kw", "for")) return forStmt();
    if (at("id", "printf")) return printfStmt();
    return simpleStmt(true);
  }

  function declStmt() {
    const node = declNoSemi();
    expect("op", ";");
    return node;
  }
  function declNoSemi() {
    const t = parseType();
    const name = expect("id").value;
    if (isOp("[")) return arrayDecl(t, name);
    if (structNames.has(t)) { // struct Point p = {3, 4};
      expect("op", "=");
      expect("op", "{");
      const args = [];
      if (!isOp("}")) do { args.push(expr()); } while (eatOp(","));
      expect("op", "}");
      return { kind: "Let", name, type: t, expr: { kind: "Call", name: t, args } }; // checker -> StructLit
    }
    let e;
    if (eatOp("=")) e = expr();
    else e = defaultValue(t);
    return { kind: "Let", name, type: t, expr: e };
  }

  // `T name[size]` / `T name[] = {…}` / `T name[size] = {…}`
  function arrayDecl(t, name) {
    expect("op", "[");
    let size = null;
    if (!isOp("]")) size = expr();
    expect("op", "]");
    const arrT = t + "[]";
    if (eatOp("=")) {
      expect("op", "{");
      const elems = [];
      if (!isOp("}")) do { elems.push(expr()); } while (eatOp(","));
      expect("op", "}");
      return { kind: "Let", name, type: arrT, expr: { kind: "Array", elems } };
    }
    if (t === "int") { // zero-filled, any size expression
      if (!size) throw new TranspileError(`array '${name}' needs a size or an initializer`);
      return { kind: "Let", name, type: arrT, expr: { kind: "NewArray", size } };
    }
    // non-int zero-fill: expand a literal size into a literal of defaults
    if (!size || size.kind !== "Int") throw new TranspileError(`array '${name}' needs a literal size or an initializer`);
    const elems = Array.from({ length: size.value }, () => defaultValue(t));
    return { kind: "Let", name, type: arrT, expr: { kind: "Array", elems } };
  }

  function simpleStmt(semi) {
    if (at("id") && isAssignAhead()) {
      const name = next().value;
      const node = assignOp(name);
      if (semi) expect("op", ";");
      return node;
    }
    const e = expr();
    // `a[i] = …` / `p->x += …` / `v.y++` — the lvalue parsed as an expression
    if ((e.kind === "Index" || e.kind === "Field") && cur().kind === "op" && ["=", "+=", "-=", "*=", "/=", "++", "--"].includes(cur().value)) {
      const op = next().value;
      let rhs;
      if (op === "++" || op === "--") rhs = { kind: "Bin", op: op === "++" ? "+" : "-", l: e, r: { kind: "Int", value: 1 } };
      else if (op === "=") rhs = expr();
      else rhs = { kind: "Bin", op: op[0], l: e, r: expr() };
      if (semi) expect("op", ";");
      if (e.kind === "Index") return { kind: "IndexAssign", arr: e.arr, idx: e.idx, expr: rhs };
      return { kind: "FieldAssign", obj: e.obj, name: e.name, expr: rhs };
    }
    if (semi) expect("op", ";");
    return { kind: "ExprStmt", expr: e };
  }
  function isAssignAhead() {
    const t1 = toks[p + 1];
    return t1.kind === "op" && ["=", "+=", "-=", "*=", "/=", "++", "--"].includes(t1.value);
  }
  function assignOp(name) {
    const op = next().value;
    if (op === "++" || op === "--") return { kind: "Assign", name, expr: { kind: "Bin", op: op === "++" ? "+" : "-", l: { kind: "Var", name }, r: { kind: "Int", value: 1 } } };
    const rhs = expr();
    if (op === "=") return { kind: "Assign", name, expr: rhs };
    return { kind: "Assign", name, expr: { kind: "Bin", op: op[0], l: { kind: "Var", name }, r: rhs } };
  }

  function returnStmt() {
    expect("kw", "return");
    let e = null;
    if (!isOp(";")) e = expr();
    expect("op", ";");
    if (inMain) return null; // drop `return 0;` — IR main is void
    return { kind: "Return", expr: e };
  }

  function ifStmt() {
    expect("kw", "if"); expect("op", "(");
    const cond = expr(); expect("op", ")");
    const then = blockOrStmt();
    let els = null;
    if (at("kw", "else")) { next(); els = at("kw", "if") ? { kind: "Block", stmts: [ifStmt()] } : blockOrStmt(); }
    return { kind: "If", cond, then, els };
  }
  function whileStmt() {
    expect("kw", "while"); expect("op", "(");
    const cond = expr(); expect("op", ")");
    return { kind: "While", cond, body: blockOrStmt() };
  }
  function blockOrStmt() {
    if (isOp("{")) return block();
    const s = stmt();
    return { kind: "Block", stmts: s ? [s] : [] };
  }
  function forStmt() {
    expect("kw", "for"); expect("op", "(");
    const init = isTypeStart() ? declNoSemi() : simpleStmt(false);
    expect("op", ";");
    const cond = expr(); expect("op", ";");
    const upd = simpleStmt(false);
    expect("op", ")");
    const body = blockOrStmt();
    return { kind: "Block", stmts: [init, { kind: "While", cond, body: { kind: "Block", stmts: [...body.stmts, upd] } }] };
  }

  // printf("fmt", args...) -> Print of (literals + values) concatenated
  function printfStmt() {
    expect("id", "printf");
    expect("op", "(");
    const fmt = expect("str").value;
    const args = [];
    while (eatOp(",")) args.push(expr());
    expect("op", ")"); expect("op", ";");
    return { kind: "Print", expr: buildFromFormat(fmt, args) };
  }

  function buildFromFormat(fmt, args) {
    let f = fmt.endsWith("\n") ? fmt.slice(0, -1) : fmt; // Print adds the newline
    const parts = [];
    let lit = "", ai = 0;
    for (let i = 0; i < f.length; i++) {
      if (f[i] === "%" && i + 1 < f.length) {
        const spec = f[i + 1];
        if (spec === "%") { lit += "%"; i++; continue; }
        if ("digfsc".includes(spec)) {
          if (lit) { parts.push({ kind: "Str", value: lit }); lit = ""; }
          if (ai < args.length) parts.push(args[ai++]);
          i++;
          continue;
        }
      }
      lit += f[i];
    }
    if (lit) parts.push({ kind: "Str", value: lit });
    if (parts.length === 0) return { kind: "Str", value: "" };
    return parts.reduce((l, r) => ({ kind: "Bin", op: "+", l, r }));
  }

  function expr() { return orExpr(); }
  function binLevel(sub, ops) {
    return () => {
      let left = sub();
      while (cur().kind === "op" && ops.includes(cur().value)) { const op = next().value; left = { kind: "Bin", op, l: left, r: sub() }; }
      return left;
    };
  }
  const mul = binLevel(() => unary(), ["*", "/", "%"]);
  const add = binLevel(mul, ["+", "-"]);
  const rel = binLevel(add, ["<", ">", "<=", ">="]);
  const eq = binLevel(rel, ["==", "!="]);
  const and = binLevel(eq, ["&&"]);
  const orExpr = binLevel(and, ["||"]);
  function unary() {
    if (isOp("-") || isOp("!")) { const op = next().value; return { kind: "Un", op, e: unary() }; }
    if (isOp("&")) { next(); return unary(); } // &v — address-of is identity in the IR's reference model
    return primary();
  }
  function primary() {
    const c = cur();
    if (c.kind === "int") { next(); return { kind: "Int", value: c.value }; }
    if (c.kind === "float") { next(); return { kind: "Float", value: c.value }; }
    if (c.kind === "str") { next(); return { kind: "Str", value: c.value }; }
    if (at("kw", "true")) { next(); return { kind: "Bool", value: true }; }
    if (at("kw", "false")) { next(); return { kind: "Bool", value: false }; }
    if (isOp("(")) { next(); const e = expr(); expect("op", ")"); return e; }
    if (c.kind === "id") {
      next();
      // only the length idiom `sizeof(a) / sizeof(a[0])` is supported -> Len
      if (c.value === "sizeof" && isOp("(")) {
        next(); const arr = expr(); expect("op", ")");
        if (!eatOp("/")) throw new TranspileError("sizeof is only supported as sizeof(a) / sizeof(a[0])", c.line, c.col);
        expect("id", "sizeof"); expect("op", "(");
        expr(); // the a[0] divisor — its value is implied by the idiom
        expect("op", ")");
        return { kind: "Len", arr };
      }
      let node;
      if (isOp("(")) { next(); const args = []; if (!isOp(")")) do { args.push(expr()); } while (eatOp(",")); expect("op", ")"); node = { kind: "Call", name: c.value, args }; }
      else node = { kind: "Var", name: c.value };
      for (;;) {
        if (isOp("[")) { next(); const idx = expr(); expect("op", "]"); node = { kind: "Index", arr: node, idx }; continue; }
        if (isOp(".") || isOp("->")) { next(); node = { kind: "Field", obj: node, name: expect("id").value }; continue; } // v.x and p->x are the same Field
        break;
      }
      return node;
    }
    throw new TranspileError(`unexpected '${c.value ?? c.kind}'`, c.line, c.col);
  }

  return program();
}

module.exports = { parse: cParse };
