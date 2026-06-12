// String concatenation, including string + int. Each target builds the same
// text — even C (rotating-buffer runtime) and Rust (String + format!).
func greet(name: string): string {
  return "Hello, " + name + "!";
}

func main(): void {
  print(greet("world"));                 // Hello, world!
  let n: int = 42;
  print("the answer is " + n);           // the answer is 42
  for (let i: int = 1; i <= 3; i = i + 1) {
    print("line " + i);                  // line 1 / line 2 / line 3
  }
}
