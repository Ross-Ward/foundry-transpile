func main(): void {
  let total: int = 0;
  for (let i: int = 0; i < 10; i = i + 1) {
    if (i % 2 == 0) { continue; }
    if (i > 7) { break; }
    total = total + i;
  }
  print(total);

  let n: int = 0;
  while (true) {
    n = n + 1;
    if (n % 3 != 0) { continue; }
    print(n);
    if (n >= 9) { break; }
  }

  let s: int = 0;
  for (let j: int = 0; j < 4; j = j + 1) {
    for (let k: int = 0; k < 4; k = k + 1) {
      if (k == j) { continue; }
      if (k == 3) { break; }
      s = s + 1;
    }
  }
  print(s);
}
