func classify(n: int): string {
  return n < 0 ? "neg" : n == 0 ? "zero" : "pos";
}

func main(): void {
  print(classify(-5));
  print(classify(0));
  print(classify(7));

  let a: int = 3;
  let b: int = 9;
  let hi: int = a > b ? a : b;
  print(hi);
  print(a < b ? "a wins" : "b wins");

  let f: float = a > 0 ? 1.5 : 2.5;
  print(f);
}
