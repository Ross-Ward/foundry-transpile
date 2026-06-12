"use strict";
// Property-based fuzzer: generates random (but always valid and terminating)
// MiniLang programs, transpiles each to every requested target, runs them all,
// and asserts the outputs are byte-for-byte identical. Deterministic per seed.
//
//   node test/fuzz.js [seed=1] [count=25] [target target …]
//
// Failures are written to test/fuzz-failures/ as <seed>-<n>.ml plus the
// per-target outputs, so a finding is always reproducible.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { transpile } = require("../src");
const { TARGETS, runTarget, norm } = require("./targets");

// ---- deterministic PRNG -----------------------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- program generator -------------------------------------------------------
// The generator only produces programs that terminate (loops are bounded
// counters) and stay within 32-bit int range (small literals, additive
// accumulation, multiplication only by tiny constants), so every divergence it
// finds is a real transpiler bug, not undefined behavior.
function makeGen(rnd) {
  const ri = (n) => Math.floor(rnd() * n);
  const pick = (a) => a[ri(a.length)];

  const STR_POOL = ['"foxglove"', '"brae"', '"monterey"', '"tara"', '"glen"']; // all len >= 4

  // typed expression generators; d is remaining depth
  function intExpr(env, d) {
    const opts = ["lit", "lit"];
    if (env.ints.length) opts.push("var", "var");
    if (d > 0) opts.push("add", "sub", "mul", "div", "mod", "tern", "castf", "lens");
    if (env.strs.length) opts.push("lenv");
    switch (pick(opts)) {
      case "var": return pick(env.ints);
      case "add": return `(${intExpr(env, d - 1)} + ${intExpr(env, d - 1)})`;
      case "sub": return `(${intExpr(env, d - 1)} - ${intExpr(env, d - 1)})`;
      case "mul": return `(${intExpr(env, d - 1)} * ${1 + ri(3)})`;
      case "div": return `(${intExpr(env, d - 1)} / ${2 + ri(7)})`;
      case "mod": return `(${intExpr(env, d - 1)} % ${2 + ri(7)})`;
      case "tern": return `(${boolExpr(env, d - 1)} ? ${intExpr(env, d - 1)} : ${intExpr(env, d - 1)})`;
      case "castf": return `int(${floatExpr(env, d - 1)})`;
      case "lens": return `len(${pick(STR_POOL)})`;
      case "lenv": return `len(${pick(env.strs)})`;
      default: return String(ri(40) - 10);
    }
  }

  function floatExpr(env, d) {
    const opts = ["lit", "lit"];
    if (env.floats.length) opts.push("var", "var");
    if (d > 0) opts.push("add", "sub", "mul", "casti", "tern");
    switch (pick(opts)) {
      case "var": return pick(env.floats);
      case "add": return `(${floatExpr(env, d - 1)} + ${floatExpr(env, d - 1)})`;
      case "sub": return `(${floatExpr(env, d - 1)} - ${floatExpr(env, d - 1)})`;
      case "mul": return `(${floatExpr(env, d - 1)} * ${pick(["0.5", "2.0", "1.5"])})`;
      case "casti": return `float(${intExpr(env, d - 1)})`;
      case "tern": return `(${boolExpr(env, d - 1)} ? ${floatExpr(env, d - 1)} : ${floatExpr(env, d - 1)})`;
      default: return pick(["0.5", "1.25", "2.0", "3.75", "0.25", "10.5"]);
    }
  }

  function boolExpr(env, d) {
    const opts = ["cmp", "cmp", "lit"];
    if (d > 0) opts.push("and", "or", "not", "scmp");
    switch (pick(opts)) {
      case "and": return `(${boolExpr(env, d - 1)} && ${boolExpr(env, d - 1)})`;
      case "or": return `(${boolExpr(env, d - 1)} || ${boolExpr(env, d - 1)})`;
      case "not": return `(!${boolExpr(env, d - 1)})`;
      case "scmp": return `(${strExpr(env, 0)} ${pick(["==", "!=", "<", ">"])} ${strExpr(env, 0)})`;
      case "lit": return pick(["true", "false"]);
      default: return `(${intExpr(env, d - 1)} ${pick(["<", ">", "<=", ">=", "==", "!="])} ${intExpr(env, d - 1)})`;
    }
  }

  // String vars only ever hold literals (len >= 4) or concatenations of them,
  // so substr below can use bounds that are provably valid; out-of-range
  // substr is undefined in the IR (Java throws, Rust panics) so the generator
  // must never produce it.
  function strExpr(env, d) {
    const opts = ["lit", "lit"];
    if (env.strs.length) opts.push("var", "var");
    if (d > 0) opts.push("cat", "cati", "catb");
    switch (pick(opts)) {
      case "var": return pick(env.strs);
      case "cat": return `(${strExpr(env, d - 1)} + ${strExpr(env, d - 1)})`;
      case "cati": return `(${strExpr(env, d - 1)} + ${intExpr(env, d - 1)})`;
      case "catb": return `(${strExpr(env, d - 1)} + ${boolExpr(env, d - 1)})`;
      default: return pick(STR_POOL);
    }
  }

  // a substr expression with bounds that are valid by construction
  function safeSubstr(env) {
    if (env.strs.length && rnd() < 0.5) {
      const s = pick(env.strs); // var values are always len >= 4
      return `substr(${s}, ${ri(4)}, len(${s}))`;
    }
    const lit = pick(STR_POOL); // pool literals are len >= 4
    const a = ri(3);
    return `substr(${lit}, ${a}, ${a + 1 + ri(2)})`;
  }

  function exprOf(type, env, d) {
    return type === "int" ? intExpr(env, d) : type === "float" ? floatExpr(env, d)
      : type === "bool" ? boolExpr(env, d) : strExpr(env, d);
  }

  function stmts(env, d, n, pad) {
    const out = [];
    for (let k = 0; k < n; k++) {
      const choice = ri(10);
      if (choice < 3) { // print something
        if (rnd() < 0.2) out.push(`${pad}print(${safeSubstr(env)});`);
        else out.push(`${pad}print(${exprOf(pick(["int", "int", "bool", "string", "float"]), env, d)});`);
      } else if (choice < 5 && env.ints.length) { // reassign an int
        out.push(`${pad}${pick(env.ints)} = ${intExpr(env, d)};`);
      } else if (choice < 6 && env.strs.length) {
        out.push(`${pad}${pick(env.strs)} = ${strExpr(env, d)};`);
      } else if (choice < 8) { // if/else with prints
        const inner = stmts(env, d - 1, 1 + ri(2), pad + "  ");
        const els = rnd() < 0.5 ? ` else {\n${stmts(env, d - 1, 1, pad + "  ")}\n${pad}}` : "";
        out.push(`${pad}if (${boolExpr(env, d)}) {\n${inner}\n${pad}}${els}`);
      } else { // bounded for with accumulation and maybe break/continue
        const v = `i${env.loops++}`;
        const acc = env.ints.length ? pick(env.ints) : null;
        const body = [];
        if (rnd() < 0.4) body.push(`${pad}  if (${v} % ${2 + ri(3)} == 0) { continue; }`);
        if (acc) body.push(`${pad}  ${acc} = ${acc} + ${v} % 17 + ${ri(5)};`);
        body.push(`${pad}  print(${v} + ${ri(10)});`);
        if (rnd() < 0.3) body.push(`${pad}  if (${v} > ${2 + ri(4)}) { break; }`);
        out.push(`${pad}for (let ${v}: int = 0; ${v} < ${3 + ri(6)}; ${v} = ${v} + 1) {\n${body.join("\n")}\n${pad}}`);
      }
    }
    return out.join("\n");
  }

  return function genProgram() {
    const env = { ints: ["a", "b"], floats: ["x"], strs: ["s"], loops: 0 };
    const lines = [];
    // a helper function exercised from main
    lines.push("func helper(a: int, b: int): int {");
    lines.push(`  if (a > b) { return a ${pick(["+", "-"])} b * ${1 + ri(3)}; }`);
    lines.push(`  return ${pick(["a", "b"])} ${pick(["+", "-"])} ${ri(9)};`);
    lines.push("}");
    lines.push("");
    lines.push("func main(): void {");
    lines.push(`  let a: int = ${ri(30) - 10};`);
    lines.push(`  let b: int = helper(${ri(20)}, ${ri(20)});`);
    lines.push(`  let x: float = ${pick(["1.5", "0.25", "2.75", "4.5"])};`);
    lines.push(`  let s: string = ${pick(STR_POOL)};`);
    lines.push(stmts(env, 2, 5 + ri(4), "  "));
    lines.push("  print(a);");
    lines.push("  print(b);");
    lines.push("  print(x);");
    lines.push("  print(s);");
    lines.push("}");
    return lines.join("\n") + "\n";
  };
}

// ---- runner ------------------------------------------------------------------
function main() {
  const args = process.argv.slice(2);
  const seed = parseInt(args[0] || "1", 10);
  const count = parseInt(args[1] || "25", 10);
  const targets = args.length > 2 ? args.slice(2) : TARGETS;
  for (const t of targets) if (!TARGETS.includes(t)) { console.error(`unknown target '${t}'`); process.exit(2); }

  const gen = makeGen(mulberry32(seed));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "transpile-fuzz-"));
  const failDir = path.join(__dirname, "fuzz-failures");
  let failures = 0;

  console.log(`fuzz: seed=${seed} count=${count} targets=${targets.join(",")}`);
  for (let n = 1; n <= count; n++) {
    const source = gen();
    const outputs = {};
    let bad = null;
    for (const t of targets) {
      try {
        outputs[t] = norm(runTarget(t, transpile(source, { to: t }), dir, `f${seed}_${n}_${t}`));
      } catch (e) {
        bad = `${t} failed: ${(e.stderr || e.message || "").toString().split("\n")[0]}`;
        break;
      }
    }
    if (!bad) {
      const ref = outputs[targets[0]];
      for (const t of targets) if (outputs[t] !== ref) { bad = `${targets[0]} and ${t} disagree`; break; }
    }
    if (bad) {
      failures++;
      if (!fs.existsSync(failDir)) fs.mkdirSync(failDir);
      const base = path.join(failDir, `${seed}-${n}`);
      fs.writeFileSync(base + ".ml", source);
      for (const t of Object.keys(outputs)) fs.writeFileSync(`${base}.${t}.out`, outputs[t] + "\n");
      console.log(`FAIL [${n}/${count}]: ${bad}  (saved ${base}.ml)`);
    } else {
      console.log(`ok   [${n}/${count}] (${outputs[targets[0]].split("\n").length} lines agree)`);
    }
  }
  console.log(failures === 0 ? `\nFUZZ PASSED (${count} programs)` : `\n${failures} FUZZ FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
