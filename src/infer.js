"use strict";
// Type inference for frontends whose source language is untyped (e.g. the
// JavaScript subset). It fills in the declared types the IR needs — function
// parameters, return types, and `let` bindings — so the statically-typed
// backends (C, Go) can emit valid code. After this runs, the regular
// `checker.js` validates the result, so any inference mistake surfaces as a
// type error rather than bad output.
//
// Strategy (pragmatic, monomorphic): parameter types come from how each param
// is *used* in its function body; local and return types are then inferred by a
// few forward passes to a fixpoint. Numbers default to int (see README for the
// deferred float-division case). Unresolved slots fall back to int.

const NUMERIC = new Set(["int", "float"]);

// struct declarations of the program being inferred (name -> Struct node).
// Untyped sources declare fields with type null; constructor call sites and
// field assignments fill them in during the fixpoint.
let STRUCTS = new Map();

function inferTypes(program) {
  const funcs = new Map(program.funcs.map((f) => [f.name, f]));
  STRUCTS = new Map((program.structs || []).map((st) => [st.name, st]));

  // 1. parameter types from usage
  for (const f of program.funcs)
    for (const p of f.params) p.type = scanParam(p.name, f.body);

  // 2. fixpoint: locals + return types (a few passes so call-return types settle)
  for (let pass = 0; pass < 4; pass++) {
    for (const f of program.funcs) {
      const env = new Map();
      for (const p of f.params) env.set(p.name, p.type || "int");
      const retTypes = [];
      inferBlock(f.body, env, funcs, retTypes);
      f.ret = joinTypes(retTypes) || "void";
    }
  }

  // 3. defaults for anything still unknown
  for (const f of program.funcs) {
    for (const p of f.params) if (!p.type) p.type = "int";
    if (!f.ret) f.ret = "void";
  }
  for (const st of STRUCTS.values()) for (const fl of st.fields) if (!fl.type) fl.type = "int";
  // final local pass with everything settled
  for (const f of program.funcs) {
    const env = new Map();
    for (const p of f.params) env.set(p.name, p.type);
    inferBlock(f.body, env, funcs, [], true);
  }
  return program;
}

function inferBlock(block, env, funcs, retTypes, finalize = false) {
  for (const s of block.stmts) inferStmt(s, env, funcs, retTypes, finalize);
}

function inferStmt(s, env, funcs, retTypes, finalize) {
  switch (s.kind) {
    case "Let": {
      const t = typeOf(s.expr, env, funcs);
      if (t) s.type = t;
      else if (finalize && !s.type) s.type = "int";
      env.set(s.name, s.type || "int");
      break;
    }
    case "Assign": {
      if (env.get(s.name) == null) { const t = typeOf(s.expr, env, funcs); if (t) env.set(s.name, t); }
      break;
    }
    case "If":
      inferBlock(s.then, new Map(env), funcs, retTypes, finalize);
      if (s.els) inferBlock(s.els, new Map(env), funcs, retTypes, finalize);
      break;
    case "While":
      inferBlock(s.body, new Map(env), funcs, retTypes, finalize);
      break;
    case "Block":
      inferBlock(s, new Map(env), funcs, retTypes, finalize);
      break;
    case "Return":
      if (s.expr) { const t = typeOf(s.expr, env, funcs); if (t) retTypes.push(t); }
      break;
    case "Print":
    case "ExprStmt":
      break;
  }
  refineCallArgs(s, env, funcs);
}

// Usage-based param scanning can only see that something is *an* array; the
// element type comes from call sites — a `string[]` argument upgrades the
// callee's `int[]` guess. Runs inside the fixpoint so it propagates.
function refineCallArgs(s, env, funcs) {
  // a field assignment types the field from the value assigned to it
  if (s.kind === "FieldAssign") {
    const st = STRUCTS.get(typeOf(s.obj, env, funcs));
    if (st) {
      const fl = st.fields.find((f) => f.name === s.name);
      const t = typeOf(s.expr, env, funcs);
      if (fl && !fl.type && t) fl.type = t;
    }
  }
  for (const root of [s.expr, s.cond, s.arr, s.idx, s.obj]) {
    if (!root) continue;
    walkExprs(root, (e) => {
      if (e.kind !== "Call") return;
      // a constructor call types the struct's fields from its arguments
      const st = STRUCTS.get(e.name);
      if (st) {
        e.args.forEach((a, i) => {
          const fl = st.fields[i];
          if (!fl || fl.type) return;
          const at = typeOf(a, env, funcs);
          if (at) fl.type = at;
        });
        return;
      }
      const f = funcs.get(e.name);
      if (!f) return;
      e.args.forEach((a, i) => {
        const p = f.params[i];
        if (!p) return;
        const at = typeOf(a, env, funcs);
        if (at && at.endsWith("[]") && (p.type == null || p.type.endsWith("[]"))) p.type = at;
        // a string or struct argument is stronger evidence than a usage-based
        // int guess (e.g. `x + tag` looks numeric until a call site disagrees)
        else if (at && (at === "string" || STRUCTS.has(at)) && (p.type == null || p.type === "int")) p.type = at;
      });
    });
  }
}

// Best-effort type of an expression; null when not yet known.
function typeOf(e, env, funcs) {
  switch (e.kind) {
    case "Int": return "int";
    case "Float": return "float";
    case "Str": return "string";
    case "Bool": return "bool";
    case "Var": return env.get(e.name) ?? null;
    case "Un": return e.op === "!" ? "bool" : (typeOf(e.e, env, funcs) || "int");
    case "Call": {
      if (STRUCTS.has(e.name)) return e.name; // constructor — the checker rewrites it
      return (funcs.get(e.name) && funcs.get(e.name).ret) || null;
    }
    case "Field": {
      const st = STRUCTS.get(typeOf(e.obj, env, funcs));
      if (!st) return null;
      const fl = st.fields.find((f) => f.name === e.name);
      return fl ? fl.type : null;
    }
    case "Bin": {
      const op = e.op;
      if (["<", ">", "<=", ">=", "==", "!=", "&&", "||"].includes(op)) return "bool";
      const lt = typeOf(e.l, env, funcs), rt = typeOf(e.r, env, funcs);
      if (op === "+" && (lt === "string" || rt === "string")) return "string";
      if (op === "%") return "int";
      if (lt === "float" || rt === "float") return "float";
      return "int"; // numeric default
    }
    case "Array": {
      const et = e.elems.length ? typeOf(e.elems[0], env, funcs) : null;
      return (et || "int") + "[]";
    }
    case "NewArray": return "int[]";
    case "Index": {
      const t = typeOf(e.arr, env, funcs);
      return t && t.endsWith("[]") ? t.slice(0, -2) : "int";
    }
    case "Len": return "int";
    default: return null;
  }
}

// Infer a parameter's type from how the function body uses it.
function scanParam(name, body) {
  let evidence = null; // "int[]" | "string" | "bool" | "int"
  const note = (t) => {
    if (evidence === "int[]") return; // array usage is the strongest signal
    if (t === "array") evidence = "int[]";
    else if (t === "string") evidence = "string";
    else if (t === "bool" && evidence !== "string") evidence = "bool";
    else if (t === "int" && evidence == null) evidence = "int";
  };
  const isName = (n) => n && n.kind === "Var" && n.name === name;
  const isStr = (n) => n && n.kind === "Str";

  walkExprs(body, (e) => {
    if ((e.kind === "Index" || e.kind === "Len") && isName(e.arr)) note("array");
    if (e.kind === "Un" && e.op === "!" && isName(e.e)) note("bool");
    if (e.kind === "Bin") {
      const { op, l, r } = e;
      const involves = isName(l) || isName(r);
      if (!involves) return;
      if (op === "&&" || op === "||") note("bool");
      else if (op === "+" && (isStr(l) || isStr(r))) note("string");
      else if (["+", "-", "*", "/", "%", "<", ">", "<=", ">="].includes(op)) note("int");
    }
  });
  return evidence; // may be null -> defaulted later
}

function walkExprs(node, fn) {
  if (!node || typeof node !== "object") return;
  if (node.kind && /^(Int|Float|Str|Bool|Var|Un|Bin|Call|Index|Len|Array|NewArray|Field)$/.test(node.kind)) fn(node);
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (Array.isArray(v)) v.forEach((x) => walkExprs(x, fn));
    else if (v && typeof v === "object") walkExprs(v, fn);
  }
}

function joinTypes(types) {
  const ts = [...new Set(types.filter(Boolean))];
  if (ts.length === 0) return null;
  if (ts.length === 1) return ts[0];
  if (ts.every((t) => NUMERIC.has(t))) return ts.includes("float") ? "float" : "int";
  return ts[0];
}

module.exports = { inferTypes };
