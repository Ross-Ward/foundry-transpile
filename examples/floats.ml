// Float arithmetic + division. Every target prints these identically thanks to
// a canonical formatter (6 decimals, trailing zeros stripped, one kept).
func main(): void {
  let a: float = 10.0;
  let b: float = 4.0;
  print(a / b);                          // 2.5   (real float division)
  print(a * b);                          // 40.0
  print(a + b);                          // 14.0
  print(a - b);                          // 6.0
  let avg: float = (1.0 + 2.0 + 3.0 + 4.0) / 4.0;
  print(avg);                            // 2.5
  print(22.0 / 7.0);                     // 3.142857
  print(1.0 / 8.0);                      // 0.125
}
