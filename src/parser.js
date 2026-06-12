"use strict";
// Recursive-descent parser: tokens -> AST. `for` is desugared to `while`, so
// every backend only has to handle one loop form.
const { lex, TranspileError } = require("./lexer");

const TYPES = new Set(["int", "float", "bool", "string", "void"]);

function parse(src) {
  const toks = lex(src);
  let p = 0;

  const cur = () => toks[p];
  const at = (kind, value) => cur().kind === kind && (value === undefined || cur().value === value);
  const next = () => toks[p++];
  function expect(kind, value) {
    if (!at(kind, value)) {
      const c = cur();
      throw new TranspileError(`expected ${value ?? kind} but found '${c.value ?? c.kind}'`, c.line, c.col);
    }
    return next();
  }
  const isOp = (v) => at("op", v);
  const eatOp = (v) => { if (isOp(v)) { next(); return true; } return false; };

  function parseProgram() {
    const funcs = [];
    const structs = [];
    while (!at("eof")) {
      if (at("kw", "struct")) structs.push(parseStruct());
      else funcs.push(parseFunc());
    }
    return { kind: "Program", funcs, structs };
  }

  // struct Point { x: int; y: int; }
  function parseStruct() {
    expect("kw", "struct");
    const name = expect("id").value;
    expect("op", "{");
    const fields = [];
    while (!isOp("}")) {
      const fn = expect("id").value;
      expect("op", ":");
      const ft = parseType();
      expect("op", ";");
      fields.push({ name: fn, type: ft });
    }
    expect("op", "}");
    return { kind: "Struct", name, fields };
  }

  function parseType() {
    if (cur().kind === "kw" && TYPES.has(cur().value)) {
      let t = next().value;
      while (isOp("[")) { next(); expect("op", "]"); t += "[]"; } // array type, e.g. int[]
      return t;
    }
    if (cur().kind === "id") { // struct type — the checker validates it
      let t = next().value;
      while (isOp("[")) { next(); expect("op", "]"); t += "[]"; } // Point[]
      return t;
    }
    const c = cur();
    throw new TranspileError(`expected a type, found '${c.value ?? c.kind}'`, c.line, c.col);
  }

  function parseFunc() {
    expect("kw", "func");
    const name = expect("id").value;
    expect("op", "(");
    const params = [];
    if (!isOp(")")) {
      do {
        const pn = expect("id").value;
        expect("op", ":");
        params.push({ name: pn, type: parseType() });
      } while (eatOp(","));
    }
    expect("op", ")");
    expect("op", ":");
    const ret = parseType();
    const body = parseBlock();
    return { kind: "Func", name, params, ret, body };
  }

  function parseBlock() {
    expect("op", "{");
    const stmts = [];
    while (!isOp("}")) stmts.push(parseStmt());
    expect("op", "}");
    return { kind: "Block", stmts };
  }

  function parseStmt() {
    if (at("kw", "let")) return parseLet();
    if (at("kw", "if")) return parseIf();
    if (at("kw", "while")) return parseWhile();
    if (at("kw", "for")) return parseFor();
    if (at("kw", "return")) return parseReturn();
    if (at("kw", "print")) return parsePrint();
    if (at("kw", "break")) { next(); expect("op", ";"); return { kind: "Break" }; }
    if (at("kw", "continue")) { next(); expect("op", ";"); return { kind: "Continue" }; }

    // assignment (to a variable or an array element) or a bare expression
    const lhs = parseExpr();
    if (isOp("=")) {
      next();
      const rhs = parseExpr();
      expect("op", ";");
      if (lhs.kind === "Var") return { kind: "Assign", name: lhs.name, expr: rhs };
      if (lhs.kind === "Index") return { kind: "IndexAssign", arr: lhs.arr, idx: lhs.idx, expr: rhs };
      if (lhs.kind === "Field") return { kind: "FieldAssign", obj: lhs.obj, name: lhs.name, expr: rhs };
      throw new TranspileError("invalid assignment target");
    }
    expect("op", ";");
    return { kind: "ExprStmt", expr: lhs };
  }

  function parseLet() {
    expect("kw", "let");
    const name = expect("id").value;
    expect("op", ":");
    const type = parseType();
    expect("op", "=");
    const expr = parseExpr();
    expect("op", ";");
    return { kind: "Let", name, type, expr };
  }

  function parseIf() {
    expect("kw", "if");
    expect("op", "(");
    const cond = parseExpr();
    expect("op", ")");
    const then = parseBlock();
    let els = null;
    if (at("kw", "else")) {
      next();
      els = at("kw", "if") ? { kind: "Block", stmts: [parseIf()] } : parseBlock();
    }
    return { kind: "If", cond, then, els };
  }

  function parseWhile() {
    expect("kw", "while");
    expect("op", "(");
    const cond = parseExpr();
    expect("op", ")");
    return { kind: "While", cond, body: parseBlock() };
  }

  // for(init; cond; post) body — a real For node, so backends can emit native
  // loops and `continue` still runs the post step.
  function parseFor() {
    expect("kw", "for");
    expect("op", "(");
    const init = at("kw", "let") ? parseLetNoSemi() : parseAssignNoSemi();
    expect("op", ";");
    const cond = parseExpr();
    expect("op", ";");
    const post = parseAssignNoSemi();
    expect("op", ")");
    const body = parseBlock();
    return { kind: "For", init, cond, post, body };
  }

  function parseLetNoSemi() {
    expect("kw", "let");
    const name = expect("id").value;
    expect("op", ":");
    const type = parseType();
    expect("op", "=");
    return { kind: "Let", name, type, expr: parseExpr() };
  }
  function parseAssignNoSemi() {
    const name = expect("id").value;
    expect("op", "=");
    return { kind: "Assign", name, expr: parseExpr() };
  }

  function parseReturn() {
    expect("kw", "return");
    let expr = null;
    if (!isOp(";")) expr = parseExpr();
    expect("op", ";");
    return { kind: "Return", expr };
  }

  function parsePrint() {
    expect("kw", "print");
    expect("op", "(");
    const expr = parseExpr();
    expect("op", ")");
    expect("op", ";");
    return { kind: "Print", expr };
  }

  // expression precedence (low -> high); ?: sits above || and is right-assoc
  function parseExpr() {
    const c = parseOr();
    if (isOp("?")) {
      next();
      const t = parseExpr();
      expect("op", ":");
      const f = parseExpr();
      return { kind: "Cond", c, t, f };
    }
    return c;
  }
  function bin(sub, ops) {
    return () => {
      let left = sub();
      while (cur().kind === "op" && ops.includes(cur().value)) {
        const op = next().value;
        left = { kind: "Bin", op, l: left, r: sub() };
      }
      return left;
    };
  }
  const parseMul = bin(() => parseUnary(), ["*", "/", "%"]);
  const parseAdd = bin(parseMul, ["+", "-"]);
  const parseRel = bin(parseAdd, ["<", ">", "<=", ">="]);
  const parseEq = bin(parseRel, ["==", "!="]);
  const parseAnd = bin(parseEq, ["&&"]);
  const parseOr = bin(parseAnd, ["||"]);

  function parseUnary() {
    if (isOp("-") || isOp("!")) {
      const op = next().value;
      return { kind: "Un", op, e: parseUnary() };
    }
    return parsePrimary();
  }

  // primary with postfix array indexing and field access: a[i], p.x, a[i].y, …
  function parsePrimary() {
    let e = parseBase();
    while (isOp("[") || isOp(".")) {
      if (eatOp(".")) {
        e = { kind: "Field", obj: e, name: expect("id").value };
        continue;
      }
      next();
      const idx = parseExpr();
      expect("op", "]");
      e = { kind: "Index", arr: e, idx };
    }
    return e;
  }

  function parseBase() {
    const c = cur();
    if (c.kind === "int") { next(); return { kind: "Int", value: c.value }; }
    if (c.kind === "float") { next(); return { kind: "Float", value: c.value }; }
    if (c.kind === "str") { next(); return { kind: "Str", value: c.value }; }
    if (at("kw", "true")) { next(); return { kind: "Bool", value: true }; }
    if (at("kw", "false")) { next(); return { kind: "Bool", value: false }; }
    // numeric casts: int(x) / float(x)
    if ((at("kw", "int") || at("kw", "float")) && toks[p + 1].kind === "op" && toks[p + 1].value === "(") {
      const to = next().value;
      next();
      const inner = parseExpr();
      expect("op", ")");
      return { kind: "Cast", to, e: inner };
    }
    if (isOp("(")) { next(); const e = parseExpr(); expect("op", ")"); return e; }
    if (isOp("[")) { // array literal: [e1, e2, ...]
      next();
      const elems = [];
      if (!isOp("]")) { do { elems.push(parseExpr()); } while (eatOp(",")); }
      expect("op", "]");
      return { kind: "Array", elems };
    }
    if (c.kind === "id") {
      next();
      if (isOp("(")) { // call (or a builtin: len / array)
        next();
        const args = [];
        if (!isOp(")")) { do { args.push(parseExpr()); } while (eatOp(",")); }
        expect("op", ")");
        if (c.value === "len" && args.length === 1) return { kind: "Len", arr: args[0] };
        if (c.value === "array" && args.length === 1) return { kind: "NewArray", size: args[0] };
        if (c.value === "substr" && args.length === 3) return { kind: "Substr", s: args[0], start: args[1], end: args[2] }; // end-exclusive
        return { kind: "Call", name: c.value, args };
      }
      return { kind: "Var", name: c.value };
    }
    throw new TranspileError(`unexpected '${c.value ?? c.kind}'`, c.line, c.col);
  }

  return parseProgram();
}

module.exports = { parse };
