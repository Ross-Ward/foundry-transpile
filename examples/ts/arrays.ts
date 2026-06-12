// TypeScript with int[] annotations: arrays as typed parameters, indexing,
// .length, and element assignment. Verified by all 8 targets agreeing.
function dot(a: int[], b: int[]): int {
  let total: int = 0;
  for (let i: int = 0; i < a.length; i++) {
    total += a[i] * b[i];
  }
  return total;
}

function main(): void {
  let x: int[] = [1, 2, 3];
  let y: int[] = [4, 5, 6];
  console.log(dot(x, y));            // 4 + 10 + 18 = 32

  let z: int[] = [10, 20, 30, 40];
  let s: int = 0;
  for (let i: int = 0; i < z.length; i++) {
    s += z[i];
  }
  console.log(s);                    // 100
  z[0] = 99;
  console.log(z[0] + z.length);      // 99 + 4 = 103
}

main();
