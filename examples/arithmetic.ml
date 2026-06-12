// Operators + the tricky case: integer division must truncate identically on
// every target (JS '/' would give 3.4 without normalisation).
func main(): void {
  let a: int = 17;
  let b: int = 5;
  print(a + b);   // 22
  print(a - b);   // 12
  print(a * b);   // 85
  print(a / b);   // 3   (truncated)
  print(a % b);   // 2
  print(-a);      // -17
  let ok: bool = (a > b) && (b > 0);
  if (ok) {
    print(1);
  } else {
    print(0);
  }
}
