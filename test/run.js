"use strict";
// Verification harness: for every example, transpile to all four targets, run
// each generated program, and assert their outputs are byte-for-byte identical.
// That is the strongest possible test of a transpiler — the languages disagree
// about division, booleans, syntax, and typing, yet must compute the same thing.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { transpile, parse, check } = require("../src/index");
const { TARGETS, runTarget, norm } = require("./targets");

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log("ok  : " + msg); } else { fail++; console.log("FAIL: " + msg); } }

function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "transpile-"));
  const exDir = path.join(__dirname, "..", "examples");
  const examples = fs.readdirSync(exDir).filter((f) => f.endsWith(".ml")).sort();

  for (const ex of examples) {
    const name = ex.replace(/\.ml$/, "");
    const source = fs.readFileSync(path.join(exDir, ex), "utf8");
    const outputs = {};
    let errored = false;
    for (const t of TARGETS) {
      try {
        outputs[t] = norm(runTarget(t, transpile(source, { to: t }), dir, name + "_" + t));
      } catch (e) {
        errored = true;
        ok(false, `${ex} -> ${t} failed: ${(e.stderr || e.message || "").toString().split("\n")[0]}`);
      }
    }
    if (errored) continue;
    const ref = outputs.js;
    for (const t of TARGETS) ok(outputs[t] === ref, `${ex}: ${t} output matches`);
    // a quick spot-check that the output is non-trivial
    ok(ref.length > 0, `${ex}: produced output`);
  }

  // ---- real-language frontend: JavaScript source -> Python/C/Go ----
  const jsDir = path.join(exDir, "js");
  if (fs.existsSync(jsDir)) {
    const jsExamples = fs.readdirSync(jsDir).filter((f) => f.endsWith(".js")).sort();
    for (const ex of jsExamples) {
      const name = "js_" + ex.replace(/\.js$/, "");
      const source = fs.readFileSync(path.join(jsDir, ex), "utf8");
      // reference: run the ORIGINAL JavaScript
      let ref;
      try { ref = norm(runTarget("js", source, dir, name + "_orig")); }
      catch (e) { ok(false, `${ex}: original JS failed: ${(e.stderr || e.message).toString().split("\n")[0]}`); continue; }

      for (const t of ["python", "c", "go", "java", "csharp", "rust", "lua", "kotlin", "zig"]) {
        try {
          const out = norm(runTarget(t, transpile(source, { from: "js", to: t }), dir, name + "_" + t));
          ok(out === ref, `${ex} (JS) -> ${t} matches the original JS`);
        } catch (e) {
          ok(false, `${ex} (JS) -> ${t} failed: ${(e.stderr || e.message).toString().split("\n")[0]}`);
        }
      }
    }
  }

  // ---- real-language frontend: Python source -> JS/C/Go ----
  const pyDir = path.join(exDir, "py");
  if (fs.existsSync(pyDir)) {
    const pyExamples = fs.readdirSync(pyDir).filter((f) => f.endsWith(".py")).sort();
    for (const ex of pyExamples) {
      const name = "py_" + ex.replace(/\.py$/, "");
      const source = fs.readFileSync(path.join(pyDir, ex), "utf8");
      let ref;
      try { ref = norm(runTarget("python", source, dir, name + "_orig")); }
      catch (e) { ok(false, `${ex}: original Python failed: ${(e.stderr || e.message).toString().split("\n")[0]}`); continue; }

      for (const t of ["js", "c", "go", "java", "csharp", "rust", "lua", "kotlin", "zig"]) {
        try {
          const out = norm(runTarget(t, transpile(source, { from: "python", to: t }), dir, name + "_" + t));
          ok(out === ref, `${ex} (Python) -> ${t} matches the original Python`);
        } catch (e) {
          ok(false, `${ex} (Python) -> ${t} failed: ${(e.stderr || e.message).toString().split("\n")[0]}`);
        }
      }
    }
  }

  // ---- typed real-language frontend: TypeScript source -> all 8 targets ----
  // (our TS dialect uses int/float annotations, so we check cross-target
  // agreement rather than against a stock-TS run)
  const tsDir = path.join(exDir, "ts");
  if (fs.existsSync(tsDir)) {
    const tsExamples = fs.readdirSync(tsDir).filter((f) => f.endsWith(".ts")).sort();
    for (const ex of tsExamples) {
      const name = "ts_" + ex.replace(/\.ts$/, "");
      const source = fs.readFileSync(path.join(tsDir, ex), "utf8");
      const outputs = {};
      let errored = false;
      for (const t of TARGETS) {
        try { outputs[t] = norm(runTarget(t, transpile(source, { from: "ts", to: t }), dir, name + "_" + t)); }
        catch (e) { errored = true; ok(false, `${ex} (TS) -> ${t} failed: ${(e.stderr || e.message).toString().split("\n")[0]}`); }
      }
      if (errored) continue;
      const ref = outputs.js;
      for (const t of TARGETS) ok(outputs[t] === ref, `${ex} (TS) -> ${t} agrees`);
    }
  }

  // ---- real-language frontend: C source -> the other 7 languages ----
  // (the original C is compiled+run with zig cc as ground truth)
  const cDir = path.join(exDir, "c");
  if (fs.existsSync(cDir)) {
    const cExamples = fs.readdirSync(cDir).filter((f) => f.endsWith(".c")).sort();
    for (const ex of cExamples) {
      const name = "c_" + ex.replace(/\.c$/, "");
      const source = fs.readFileSync(path.join(cDir, ex), "utf8");
      let ref;
      try { ref = norm(runTarget("c", source, dir, name + "_orig")); }
      catch (e) { ok(false, `${ex}: original C failed: ${(e.stderr || e.message).toString().split("\n")[0]}`); continue; }

      for (const t of ["js", "python", "go", "java", "csharp", "rust", "lua", "kotlin", "zig"]) {
        try {
          const out = norm(runTarget(t, transpile(source, { from: "c", to: t }), dir, name + "_" + t));
          ok(out === ref, `${ex} (C) -> ${t} matches the original C`);
        } catch (e) {
          ok(false, `${ex} (C) -> ${t} failed: ${(e.stderr || e.message).toString().split("\n")[0]}`);
        }
      }
    }
  }

  // ---- unit checks on the frontend/checker ----
  ok(parse("func main(): void { print(1); }").funcs.length === 1, "parser: parses a minimal program");

  let threw = false;
  try { check(parse('func main(): void { let x: int = "hi"; }')); } catch { threw = true; }
  ok(threw, "checker: rejects assigning a string to an int");

  threw = false;
  try { transpile("func main(): void { print(undefinedVar); }", { to: "js" }); } catch { threw = true; }
  ok(threw, "checker: rejects an undefined variable");

  threw = false;
  try { transpile("func main(): void { let b: bool = 1 + true; }", { to: "js" }); } catch { threw = true; }
  ok(threw, "checker: rejects mixing int and bool in arithmetic");

  const PT = "struct P { x: int; } ";
  threw = false;
  try { transpile(PT + "func main(): void { let a: P = P(1); let b: P = a; }", { to: "js" }); } catch { threw = true; }
  ok(threw, "checker: rejects aliasing a struct variable");

  threw = false;
  try { transpile(PT + "func main(): void { let a: P = P(1); print(a.y); }", { to: "js" }); } catch { threw = true; }
  ok(threw, "checker: rejects an unknown struct field");

  threw = false;
  try { transpile(PT + "func main(): void { let a: P = P(\"hi\"); }", { to: "js" }); } catch { threw = true; }
  ok(threw, "checker: rejects a wrongly-typed struct field value");

  threw = false;
  try {
    transpile("class P { constructor(a, b) { this.x = b; this.y = a; } }\nfunction main() { let p = new P(1, 2); console.log(p.x); }\nmain();", { from: "js", to: "js" });
  } catch { threw = true; }
  ok(threw, "js frontend: rejects out-of-order constructor field assignment");

  threw = false;
  try { transpile(PT + "func main(): void { let xs: P[] = [P(1)]; let a: P = xs[0]; }", { to: "js" }); } catch { threw = true; }
  ok(threw, "checker: rejects aliasing a struct out of an array");

  threw = false;
  try {
    transpile("struct I { v: int; } struct O { i: I; } func main(): void { let o: O = O(I(1)); let a: I = o.i; }", { to: "js" });
  } catch { threw = true; }
  ok(threw, "checker: rejects aliasing a nested struct field");

  const tscs = transpile("class V { constructor(public x: int) {} }\nfunction main(): void { let v = new V(7); console.log(v.x); }\nmain();", { from: "ts", to: "csharp" });
  ok(tscs.includes("class V"), "ts frontend: parameter-property classes become C# classes");

  const cgo = transpile('struct P { int x; };\nint main(void) { struct P p = {5}; printf("%d\\n", p.x); return 0; }', { from: "c", to: "go" });
  ok(cgo.includes("&P{x: 5}"), "c frontend: struct brace initializer becomes a Go struct literal");

  // checker errors carry the source position of the offending statement/expression
  let errLine = 0;
  try { transpile("func main(): void {\n  let a: int = 1;\n  let b: int = a + true;\n}", { to: "js" }); }
  catch (e) { errLine = e.line; }
  ok(errLine === 3, "errors: MiniLang type errors carry the source line");

  errLine = 0;
  try { transpile("def main():\n    x = 1\n    y = x + undefined_thing\n\nmain()", { from: "python", to: "js" }); }
  catch (e) { errLine = e.line; }
  ok(errLine === 3, "errors: Python-source errors carry the source line");

  // string[] inference from untyped sources: param element types come from call sites
  const sjs = transpile(
    "function first(xs) { return xs[0]; }\nfunction main() { let xs = [\"a\", \"b\"]; console.log(first(xs)); }\nmain();",
    { from: "js", to: "go" });
  ok(sjs.includes("[]string"), "infer: string[] propagates from a call site into a Go param");

  // division normalisation: the JS backend must truncate integer division
  const js = transpile("func main(): void { print(17 / 5); }", { to: "js" });
  ok(js.includes("Math.trunc"), "js backend: integer division uses Math.trunc");
  const py = transpile("func main(): void { print(17 / 5); }", { to: "python" });
  ok(py.includes("int("), "python backend: integer division uses int()");

  console.log(`\n${fail === 0 ? "ALL TESTS PASSED" : fail + " TESTS FAILED"}  (${pass} checks)`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
