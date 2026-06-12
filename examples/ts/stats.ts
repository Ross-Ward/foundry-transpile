// Real TypeScript. Type annotations make the types explicit (no inference
// needed), including `float` — so this transpiles to all 8 targets, floats and
// all, and they print identically.
function mean(a: float, b: float, c: float): float {
  return (a + b + c) / 3.0;
}

function main(): void {
  const m: float = mean(2.0, 4.0, 9.0);
  console.log(m);                 // 5.0
  console.log(mean(1.0, 2.0, 2.0)); // 1.666667

  let total: int = 0;
  for (let i: int = 1; i <= 5; i++) {
    total += i * i;
  }
  console.log(total);             // 55
  console.log("sum of squares = " + total);
}

main();
