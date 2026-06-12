"use strict";
// Zig backend (zig 0.16). The hardest target: manual memory and strict types.
// Strings are []const u8 backed by an arena that is never freed (same stance
// as the C backend); structs are arena-created pointers (*Point) for reference
// semantics; arrays are heap slices copied out of comptime literals by a
// generic __arr helper. Zig's while has a continue-expression, so For maps to
// `while (cond) : (post)` and `continue` runs the post step natively. Locals
// are const unless reassigned (a never-mutated var is a compile error), and
// reassigned params get copied (zig params are immutable and shadowing is
// banned). Output goes through 0.16's explicit-Io API.

const { walk, renameReserved } = require("./util");

const RESERVED_WORDS = new Set(("addrspace align allowzero and anyframe anytype asm async await break callconv catch comptime " +
  "const continue defer else enum errdefer error export extern fn for if inline noalias noinline nosuspend opaque or " +
  "orelse packed pub resume return linksection struct suspend switch test threadlocal try union unreachable usingnamespace " +
  "var volatile while bool true false null undefined void type usize isize std io").split(" "));
// every iN/uN (i0, u7, i64, …) and fN is a primitive TYPE name in zig — an
// identifier like `i0` is a compile error, and even `i0_` is rejected as a
// malformed primitive, so these are escaped by PREFIX (v_i0), not suffix
const RESERVED = { has: (n) => RESERVED_WORDS.has(n) || /^[iu]\d[\d_]*$/.test(n) || /^f(16|32|64|80|128)$/.test(n) };

const ZT = { int: "i64", float: "f64", bool: "bool", string: "[]const u8", void: "void" };
const T = (t) => ZT[t] ?? (t.endsWith("[]") ? `[]${T(t.slice(0, -2))}` : `*${t}`);

// Runtime preamble. Unused module-level functions are legal in zig (lazy
// compilation), so everything ships unconditionally.
const PRELUDE = `const std = @import("std");

var __arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
const __alloc = __arena.allocator();
var __threaded: std.Io.Threaded = undefined;
var __io: std.Io = undefined;

fn __w(s: []const u8) void {
    std.Io.File.stdout().writeStreamingAll(__io, s) catch unreachable;
}

fn __istr(v: i64) []const u8 {
    return std.fmt.allocPrint(__alloc, "{d}", .{v}) catch unreachable;
}

fn __f(x: f64) []const u8 {
    const s = std.fmt.allocPrint(__alloc, "{d:.6}", .{x}) catch unreachable;
    var n = s.len;
    while (n > 0 and s[n - 1] == '0') n -= 1;
    if (n > 0 and s[n - 1] == '.') n += 1;
    return s[0..n];
}

fn __cat(a: []const u8, b: []const u8) []const u8 {
    return std.fmt.allocPrint(__alloc, "{s}{s}", .{ a, b }) catch unreachable;
}

fn __arr(comptime T: type, items: []const T) []T {
    const s = __alloc.alloc(T, items.len) catch unreachable;
    @memcpy(s, items);
    return s;
}

fn __zeros(n: i64) []i64 {
    const s = __alloc.alloc(i64, @intCast(n)) catch unreachable;
    @memset(s, 0);
    return s;
}`;

function emitZig(program) {
  renameReserved(program, RESERVED, (n) => "v_" + n);
  const out = [PRELUDE];
  for (const st of program.structs || []) {
    out.push(`const ${st.name} = struct { ${st.fields.map((f) => `${f.name}: ${T(f.type)}`).join(", ")} };`);
    const params = st.fields.map((f) => `${f.name}: ${T(f.type)}`).join(", ");
    const inits = st.fields.map((f) => `.${f.name} = ${f.name}`).join(", ");
    out.push([
      `fn __new_${st.name}(${params}) *${st.name} {`,
      `    const s = __alloc.create(${st.name}) catch unreachable;`,
      `    s.* = .{ ${inits} };`,
      `    return s;`,
      `}`,
    ].join("\n"));
  }
  for (const f of program.funcs) out.push(emitFunc(f));
  return out.join("\n\n") + "\n";
}

// the variable at the root of an lvalue chain: xs[i].inner.x -> xs
function rootVar(n) {
  while (n && (n.kind === "Index" || n.kind === "Field")) n = n.kind === "Index" ? n.arr : n.obj;
  return n && n.kind === "Var" ? n.name : null;
}

function collectAssigned(node, set) {
  if (!node || typeof node !== "object") return;
  if (node.kind === "Assign") set.add(node.name);
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (Array.isArray(v)) v.forEach((x) => collectAssigned(x, set));
    else if (v && typeof v === "object") collectAssigned(v, set);
  }
}

function collectUsed(node, set) {
  if (!node || typeof node !== "object") return;
  if (node.kind === "Var") set.add(node.name);
  if (node.kind === "Assign") set.add(node.name);
  if (node.kind === "IndexAssign") { const r = rootVar(node.arr); if (r) set.add(r); }
  if (node.kind === "FieldAssign") { const r = rootVar(node.obj); if (r) set.add(r); }
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (Array.isArray(v)) v.forEach((x) => collectUsed(x, set));
    else if (v && typeof v === "object") collectUsed(v, set);
  }
}

let MUT = new Set(); // names reassigned in the current function

function emitFunc(f) {
  MUT = new Set();
  collectAssigned(f.body, MUT);
  const used = new Set();
  collectUsed(f.body, used);

  // zig params are immutable and shadowing is banned: a reassigned param p
  // becomes parameter p__p with `var p = p__p;` up top; an unused one gets a
  // discard (unused parameters are compile errors).
  const prologue = [];
  const params = f.params.map((p) => {
    if (MUT.has(p.name)) { prologue.push(`    var ${p.name} = ${p.name}__p;`); return `${p.name}__p: ${T(p.type)}`; }
    if (!used.has(p.name)) prologue.push(`    _ = ${p.name};`);
    return `${p.name}: ${T(p.type)}`;
  }).join(", ");

  if (f.name === "main") {
    return `pub fn main() void {\n` +
      `    __threaded = std.Io.Threaded.init(std.heap.page_allocator, .{});\n` +
      `    __io = __threaded.io();\n` +
      `${emitBlock(f.body, 1, used)}}`;
  }
  return `fn ${f.name}(${params}) ${T(f.ret)} {\n${prologue.length ? prologue.join("\n") + "\n" : ""}${emitBlock(f.body, 1, used)}}`;
}

function emitBlock(block, d, used) {
  return block.stmts.map((s) => emitStmt(s, d, used)).join("\n") + (block.stmts.length ? "\n" : "");
}

function emitStmt(s, d, used) {
  const pad = "    ".repeat(d);
  switch (s.kind) {
    case "Let": {
      const kw = MUT.has(s.name) ? "var" : "const";
      const decl = `${pad}${kw} ${s.name}: ${T(s.type)} = ${E(s.expr)};`;
      return used.has(s.name) ? decl : `${decl}\n${pad}_ = ${s.name};`; // unused locals are compile errors
    }
    case "Assign": return `${pad}${s.name} = ${E(s.expr)};`;
    case "Print": {
      if (s.expr.type === "string") return `${pad}__w(${E(s.expr)});\n${pad}__w("\\n");`;
      return `${pad}__w(${asStr(s.expr)});\n${pad}__w("\\n");`;
    }
    case "IndexAssign": return `${pad}${E(s.arr)}[@intCast(${E(s.idx)})] = ${E(s.expr)};`;
    case "FieldAssign": return `${pad}${E(s.obj)}.${s.name} = ${E(s.expr)};`;
    case "Return": return `${pad}return${s.expr ? " " + E(s.expr) : ""};`;
    case "ExprStmt": // non-void results must be discarded explicitly
      return s.expr.type && s.expr.type !== "void" ? `${pad}_ = ${E(s.expr)};` : `${pad}${E(s.expr)};`;
    case "While": return `${pad}while (${E(s.cond)}) {\n${emitBlock(s.body, d + 1, used)}${pad}}`;
    case "For": // zig's continue-expression runs the post step on `continue` natively
      return `${pad}{\n${emitStmt(s.init, d + 1, used)}\n` +
        `${pad}    while (${E(s.cond)}) : (${clause(s.post)}) {\n` +
        emitBlock(s.body, d + 2, used) +
        `${pad}    }\n${pad}}`;
    case "Break": return `${pad}break;`;
    case "Continue": return `${pad}continue;`;
    case "If": {
      let out = `${pad}if (${E(s.cond)}) {\n${emitBlock(s.then, d + 1, used)}${pad}}`;
      if (s.els) out += ` else {\n${emitBlock(s.els, d + 1, used)}${pad}}`;
      return out;
    }
    case "Block": return `${pad}{\n${emitBlock(s, d + 1, used)}${pad}}`;
    default: throw new Error(`zig: unknown stmt ${s.kind}`);
  }
}

// render a statement as a while continue-expression
function clause(s) {
  switch (s.kind) {
    case "Assign": return `${s.name} = ${E(s.expr)}`;
    case "IndexAssign": return `${E(s.arr)}[@intCast(${E(s.idx)})] = ${E(s.expr)}`;
    case "FieldAssign": return `${E(s.obj)}.${s.name} = ${E(s.expr)}`;
    case "ExprStmt": return E(s.expr);
    default: throw new Error(`zig: unsupported for-post ${s.kind}`);
  }
}

// render an expression as []const u8 (for print / concatenation)
function asStr(n) {
  if (n.type === "string") return E(n);
  if (n.type === "int") return `__istr(${E(n)})`;
  if (n.type === "float") return `__f(${E(n)})`;
  if (n.type === "bool") return `(if (${E(n)}) @as([]const u8, "true") else "false")`;
  return E(n);
}

const ORD = { "<": "== .lt", ">": "== .gt", "<=": "!= .gt", ">=": "!= .lt" };

function E(e) {
  switch (e.kind) {
    case "Int": return String(e.value);
    case "Float": return e.value % 1 === 0 ? `${e.value}.0` : String(e.value);
    case "Str": return zigString(e.value);
    case "Bool": return e.value ? "true" : "false";
    case "Var": return e.name;
    case "Un": return e.op === "!" ? `(!${E(e.e)})` : `(-${E(e.e)})`;
    case "Call": return `${e.name}(${e.args.map(E).join(", ")})`;
    case "Bin": {
      if (e.op === "+" && e.type === "string") return `__cat(${asStr(e.l)}, ${asStr(e.r)})`;
      if (e.l.type === "string") { // string comparisons
        if (e.op === "==") return `std.mem.eql(u8, ${E(e.l)}, ${E(e.r)})`;
        if (e.op === "!=") return `(!std.mem.eql(u8, ${E(e.l)}, ${E(e.r)}))`;
        if (ORD[e.op]) return `(std.mem.order(u8, ${E(e.l)}, ${E(e.r)}) ${ORD[e.op]})`;
      }
      if (e.op === "/" && e.type === "int") return `@divTrunc(${E(e.l)}, ${E(e.r)})`; // bare / on ints is a compile error
      if (e.op === "%") return `@rem(${E(e.l)}, ${E(e.r)})`;
      const op = e.op === "&&" ? "and" : e.op === "||" ? "or" : e.op;
      return `(${E(e.l)} ${op} ${E(e.r)})`;
    }
    case "Array": {
      const et = T(e.type.slice(0, -2));
      return `__arr(${et}, &[_]${et}{ ${e.elems.map(E).join(", ")} })`;
    }
    case "NewArray": return `__zeros(${E(e.size)})`;
    case "Index": return `${E(e.arr)}[@intCast(${E(e.idx)})]`;
    case "Len": return `@as(i64, @intCast(${E(e.arr)}.len))`;
    case "StructLit": return `__new_${e.name}(${e.args.map(E).join(", ")})`;
    case "Field": return `${E(e.obj)}.${e.name}`;
    case "Cond": {
      const t = e.type === "string" ? `@as([]const u8, ${E(e.t)})` : E(e.t);
      return `(if (${E(e.c)}) ${t} else ${E(e.f)})`;
    }
    case "Substr": return `${E(e.s)}[@intCast(${E(e.start)})..@intCast(${E(e.end)})]`;
    case "Cast":
      if (e.to === "int") return e.e.type === "float" ? `@as(i64, @intFromFloat(@trunc(${E(e.e)})))` : `(${E(e.e)})`;
      return e.e.type === "int" ? `@as(f64, @floatFromInt(${E(e.e)}))` : `(${E(e.e)})`;
    default: throw new Error(`zig: unknown expr ${e.kind}`);
  }
}

function zigString(s) {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t") + '"';
}

module.exports = { emitZig };
