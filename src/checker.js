"use strict";
// Type checker / inference. Annotates every expression node with `.type`
// (int | float | bool | string) and validates the program. The annotations are
// what let the backends emit correct, target-faithful code (e.g. integer vs
// float division, static type declarations for C/Go).
const { TranspileError } = require("./lexer");

const NUMERIC = new Set(["int", "float"]);

const VALUE_TYPES = new Set(["int", "float", "bool", "string"]);

function check(program) {
  // struct declarations: name -> ordered field list (names first, so a field
  // may be another struct regardless of declaration order)
  const structs = new Map();
  for (const st of program.structs || []) {
    if (structs.has(st.name)) throw new TranspileError(`duplicate struct '${st.name}'`);
    structs.set(st.name, st.fields);
  }
  for (const st of program.structs || []) {
    const seen = new Set();
    for (const f of st.fields) {
      if (seen.has(f.name)) throw new TranspileError(`duplicate field '${f.name}' in struct '${st.name}'`);
      seen.add(f.name);
      if (!VALUE_TYPES.has(f.type) && !structs.has(f.type))
        throw new TranspileError(`struct field '${st.name}.${f.name}' must be a value type or a struct, got ${f.type}`);
      if (f.type === st.name) throw new TranspileError(`struct '${st.name}' cannot contain itself`);
    }
  }

  // collect function signatures first (so calls can refer to later funcs)
  const sigs = new Map();
  for (const f of program.funcs) {
    if (sigs.has(f.name)) throw new TranspileError(`duplicate function '${f.name}'`);
    if (structs.has(f.name)) throw new TranspileError(`'${f.name}' is both a struct and a function`);
    sigs.set(f.name, { params: f.params.map((p) => p.type), ret: f.ret });
  }
  if (!sigs.has("main")) throw new TranspileError("program needs a 'main' function");
  if (sigs.get("main").ret !== "void" || sigs.get("main").params.length !== 0)
    throw new TranspileError("'main' must take no parameters and return void");

  for (const f of program.funcs) checkFunc(f, sigs, structs);
  return program;
}

function validType(t, structs) {
  const base = t.endsWith("[]") ? t.slice(0, -2) : t;
  if (t.endsWith("[]")) return VALUE_TYPES.has(base) || structs.has(base);
  return VALUE_TYPES.has(t) || t === "void" || structs.has(t);
}

// Structs have reference semantics in every target except Rust, where they are
// owned values passed by &mut. Aliasing a struct (`let q = p`, `let q = xs[0]`,
// `let q = b.inner`) would behave differently across targets, so any read of an
// existing struct into a binding is rejected; construct a fresh one or pass it
// to a function instead.
function noAlias(expr, t, ctx, where) {
  if (ctx.structs.has(t) && ["Var", "Field", "Index"].includes(expr.kind))
    throw new TranspileError(`cannot alias a struct value in ${where}; construct a new one or pass it to a function`);
}

function checkFunc(func, sigs, structs) {
  for (const p of func.params)
    if (!validType(p.type, structs) || p.type === "void") throw new TranspileError(`bad type '${p.type}' for parameter '${p.name}'`);
  if (!validType(func.ret, structs)) throw new TranspileError(`bad return type '${func.ret}' for '${func.name}'`);
  const scopes = [new Map()];
  for (const p of func.params) scopes[0].set(p.name, p.type);
  checkBlock(func.body, { sigs, scopes, ret: func.ret, structs, loops: 0 });
}

function checkBlock(block, ctx) {
  ctx.scopes.push(new Map());
  for (const s of block.stmts) checkStmt(s, ctx);
  ctx.scopes.pop();
}

function lookup(ctx, name) {
  for (let i = ctx.scopes.length - 1; i >= 0; i--)
    if (ctx.scopes[i].has(name)) return ctx.scopes[i].get(name);
  return null;
}

// re-throw an unpositioned error with the nearest node's source location
function located(err, node) {
  if (err instanceof TranspileError && err.line == null && node && node.line != null)
    return new TranspileError(err.raw, node.line, node.col);
  return err;
}

function checkStmt(s, ctx) {
  try {
    checkStmtRaw(s, ctx);
  } catch (err) {
    throw located(err, s);
  }
}

function checkStmtRaw(s, ctx) {
  switch (s.kind) {
    case "Let": {
      if (!validType(s.type, ctx.structs) || s.type === "void") throw new TranspileError(`bad type '${s.type}' for '${s.name}'`);
      const t = infer(s.expr, ctx);
      if (t !== s.type) throw new TranspileError(`cannot assign ${t} to '${s.name}: ${s.type}'`);
      noAlias(s.expr, t, ctx, "let");
      ctx.scopes[ctx.scopes.length - 1].set(s.name, s.type);
      break;
    }
    case "Assign": {
      const vt = lookup(ctx, s.name);
      if (!vt) throw new TranspileError(`assignment to undeclared variable '${s.name}'`);
      const t = infer(s.expr, ctx);
      if (t !== vt) throw new TranspileError(`cannot assign ${t} to '${s.name}: ${vt}'`);
      noAlias(s.expr, t, ctx, "assignment");
      break;
    }
    case "FieldAssign": {
      const ot = infer(s.obj, ctx);
      const fields = ctx.structs.get(ot);
      if (!fields) throw new TranspileError(`cannot assign a field of a non-struct (${ot})`);
      const fld = fields.find((f) => f.name === s.name);
      if (!fld) throw new TranspileError(`struct '${ot}' has no field '${s.name}'`);
      const t = infer(s.expr, ctx);
      if (t !== fld.type) throw new TranspileError(`field '${ot}.${s.name}' is ${fld.type}, cannot assign ${t}`);
      noAlias(s.expr, t, ctx, "field assignment");
      break;
    }
    case "IndexAssign": {
      const arrT = infer(s.arr, ctx);
      if (!arrT.endsWith("[]")) throw new TranspileError(`cannot index a non-array (${arrT})`);
      if (infer(s.idx, ctx) !== "int") throw new TranspileError(`array index must be int`);
      const et = arrT.slice(0, -2);
      if (infer(s.expr, ctx) !== et) throw new TranspileError(`array element is ${et}`);
      noAlias(s.expr, et, ctx, "index assignment");
      break;
    }
    case "If":
      requireBool(infer(s.cond, ctx), "if");
      checkBlock(s.then, ctx);
      if (s.els) checkBlock(s.els, ctx);
      break;
    case "While":
      requireBool(infer(s.cond, ctx), "while");
      ctx.loops++;
      checkBlock(s.body, ctx);
      ctx.loops--;
      break;
    case "For": {
      ctx.scopes.push(new Map()); // the init variable scopes over cond/body/post
      checkStmt(s.init, ctx);
      requireBool(infer(s.cond, ctx), "for");
      ctx.loops++;
      checkBlock(s.body, ctx);
      ctx.loops--;
      checkStmt(s.post, ctx);
      ctx.scopes.pop();
      break;
    }
    case "Break":
      if (ctx.loops === 0) throw new TranspileError("break outside of a loop");
      break;
    case "Continue":
      if (ctx.loops === 0) throw new TranspileError("continue outside of a loop");
      break;
    case "Block":
      checkBlock(s, ctx);
      break;
    case "Return": {
      const t = s.expr ? infer(s.expr, ctx) : "void";
      if (t !== ctx.ret) throw new TranspileError(`return type ${t} does not match function return ${ctx.ret}`);
      if (s.expr) noAlias(s.expr, t, ctx, "return");
      break;
    }
    case "Print": {
      const t = infer(s.expr, ctx); // any printable value type
      if (t === "void") throw new TranspileError("cannot print a void value");
      if (ctx.structs.has(t)) throw new TranspileError(`cannot print a struct (${t}); print its fields`);
      break;
    }
    case "ExprStmt":
      infer(s.expr, ctx);
      break;
    default:
      throw new TranspileError(`unknown statement '${s.kind}'`);
  }
}

function requireBool(t, where) {
  if (t !== "bool") throw new TranspileError(`${where} condition must be bool, got ${t}`);
}

// Returns the type of an expression and stores it on the node as `.type`.
function infer(e, ctx) {
  try {
    e.type = inferRaw(e, ctx);
  } catch (err) {
    throw located(err, e);
  }
  return e.type;
}

function inferRaw(e, ctx) {
  switch (e.kind) {
    case "Int": return "int";
    case "Float": return "float";
    case "Str": return "string";
    case "Bool": return "bool";
    case "Var": {
      const t = lookup(ctx, e.name);
      if (!t) throw new TranspileError(`undefined variable '${e.name}'`);
      return t;
    }
    case "Un": {
      const t = infer(e.e, ctx);
      if (e.op === "-") { if (!NUMERIC.has(t)) throw new TranspileError(`unary - needs a number, got ${t}`); return t; }
      if (e.op === "!") { if (t !== "bool") throw new TranspileError(`! needs a bool, got ${t}`); return "bool"; }
      throw new TranspileError(`bad unary ${e.op}`);
    }
    case "Bin": {
      const lt = infer(e.l, ctx), rt = infer(e.r, ctx);
      const op = e.op;
      if (["+", "-", "*", "/", "%"].includes(op)) {
        // '+' is string concatenation when either side is a string; the other
        // side (int/float/bool) is converted to text by the backend.
        if (op === "+" && (lt === "string" || rt === "string")) {
          if (lt === "void" || rt === "void") throw new TranspileError(`cannot concatenate a void value`);
          return "string";
        }
        if (op === "%") { if (lt !== "int" || rt !== "int") throw new TranspileError(`% needs two ints`); return "int"; }
        if (NUMERIC.has(lt) && lt === rt) return lt; // no implicit int/float mixing
        throw new TranspileError(`operator ${op} needs two matching numbers, got ${lt} and ${rt}`);
      }
      if (["<", ">", "<=", ">="].includes(op)) {
        if (lt === rt && (NUMERIC.has(lt) || lt === "string")) return "bool";
        throw new TranspileError(`comparison ${op} needs two matching numbers/strings, got ${lt} and ${rt}`);
      }
      if (["==", "!="].includes(op)) {
        if (lt === rt && !ctx.structs.has(lt)) return "bool";
        throw new TranspileError(`${op} needs matching non-struct types, got ${lt} and ${rt}`);
      }
      if (["&&", "||"].includes(op)) {
        if (lt === "bool" && rt === "bool") return "bool";
        throw new TranspileError(`${op} needs two bools, got ${lt} and ${rt}`);
      }
      throw new TranspileError(`bad operator ${op}`);
    }
    case "StructLit": // a constructor inferred a second time (e.g. as elems[0] of an array literal)
      return e.name;
    case "Call": {
      // `Point(3, 4)` parses as a call; a struct name makes it a constructor
      const fields = ctx.structs.get(e.name);
      if (fields) {
        if (e.args.length !== fields.length)
          throw new TranspileError(`struct '${e.name}' has ${fields.length} fields, got ${e.args.length} values`);
        e.args.forEach((a, i) => {
          const at = infer(a, ctx);
          if (at !== fields[i].type) throw new TranspileError(`'${e.name}.${fields[i].name}' is ${fields[i].type}, got ${at}`);
        });
        e.kind = "StructLit";
        e.fieldNames = fields.map((f) => f.name); // for backends that init by name
        return e.name;
      }
      const sig = ctx.sigs.get(e.name);
      if (!sig) throw new TranspileError(`call to undefined function '${e.name}'`);
      if (e.args.length !== sig.params.length)
        throw new TranspileError(`'${e.name}' expects ${sig.params.length} args, got ${e.args.length}`);
      e.args.forEach((a, i) => {
        const at = infer(a, ctx);
        if (at !== sig.params[i]) throw new TranspileError(`'${e.name}' arg ${i + 1} expects ${sig.params[i]}, got ${at}`);
      });
      // void is allowed here (a call used as a statement); a value context that
      // receives `void` will fail its own type check, which is what we want.
      return sig.ret;
    }
    case "Array": {
      if (e.elems.length === 0) throw new TranspileError("empty array literal needs a type; use array(n)");
      const et = infer(e.elems[0], ctx);
      if (!VALUE_TYPES.has(et) && !ctx.structs.has(et)) throw new TranspileError(`bad array element type ${et}`);
      for (const el of e.elems) {
        if (infer(el, ctx) !== et) throw new TranspileError(`array elements must all be ${et}`);
        noAlias(el, et, ctx, "an array literal");
      }
      return et + "[]";
    }
    case "NewArray":
      if (infer(e.size, ctx) !== "int") throw new TranspileError(`array size must be int`);
      return "int[]"; // array(n) builds zero-filled int arrays
    case "Index": {
      const arrT = infer(e.arr, ctx);
      if (!arrT.endsWith("[]")) throw new TranspileError(`cannot index a non-array (${arrT})`);
      if (infer(e.idx, ctx) !== "int") throw new TranspileError(`array index must be int`);
      return arrT.slice(0, -2);
    }
    case "Len": {
      const t = infer(e.arr, ctx);
      if (!t.endsWith("[]") && t !== "string") throw new TranspileError(`len() needs an array or a string`);
      return "int";
    }
    case "Substr": {
      if (infer(e.s, ctx) !== "string") throw new TranspileError(`substr() needs a string`);
      if (infer(e.start, ctx) !== "int" || infer(e.end, ctx) !== "int")
        throw new TranspileError(`substr() bounds must be int`);
      return "string";
    }
    case "Cast": {
      const t = infer(e.e, ctx);
      if (!NUMERIC.has(t)) throw new TranspileError(`cannot cast ${t} to ${e.to}`);
      return e.to;
    }
    case "Field": {
      const ot = infer(e.obj, ctx);
      const fields = ctx.structs.get(ot);
      if (!fields) throw new TranspileError(`cannot access a field of a non-struct (${ot})`);
      const fld = fields.find((f) => f.name === e.name);
      if (!fld) throw new TranspileError(`struct '${ot}' has no field '${e.name}'`);
      return fld.type;
    }
    case "Cond": {
      requireBool(infer(e.c, ctx), "conditional");
      const tt = infer(e.t, ctx), ft = infer(e.f, ctx);
      if (tt !== ft) throw new TranspileError(`conditional branches must match, got ${tt} and ${ft}`);
      if (tt === "void" || ctx.structs.has(tt)) throw new TranspileError(`conditional cannot produce ${tt}`);
      return tt;
    }
    default:
      throw new TranspileError(`unknown expression '${e.kind}'`);
  }
}

module.exports = { check };
