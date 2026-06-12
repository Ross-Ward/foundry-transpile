// Recursion + function calls: print 1! .. 10!
func fact(n: int): int {
  if (n < 2) {
    return 1;
  }
  return n * fact(n - 1);
}

func main(): void {
  let i: int = 1;
  while (i <= 10) {
    print(fact(i));
    i = i + 1;
  }
}
