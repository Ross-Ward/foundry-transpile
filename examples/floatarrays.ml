// float[] arrays: a typed array of floats, summed and scaled in place. Exercises
// the per-element-type codegen (Go []float64, C FloatSlice, Rust Vec<f64>, ...)
// plus canonical float printing.
func sumf(a: float[]): float {
  let total: float = 0.0;
  for (let i: int = 0; i < len(a); i = i + 1) {
    total = total + a[i];
  }
  return total;
}

func scale(a: float[], factor: float): void {
  for (let i: int = 0; i < len(a); i = i + 1) {
    a[i] = a[i] * factor;
  }
}

func main(): void {
  let xs: float[] = [1.5, 2.5, 3.0, 4.0];
  print(sumf(xs));         // 11.0
  print(xs[1]);            // 2.5
  print(len(xs));          // 4
  scale(xs, 2.0);
  print(sumf(xs));         // 22.0
  print(xs[0]);            // 3.0
}
