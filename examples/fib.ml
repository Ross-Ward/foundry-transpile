// Iterative Fibonacci with a for-loop (desugared to while) and a temp variable.
func main(): void {
  let a: int = 0;
  let b: int = 1;
  for (let i: int = 0; i < 15; i = i + 1) {
    print(a);
    let t: int = a + b;
    a = b;
    b = t;
  }
}
