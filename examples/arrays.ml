// Arrays: literals, indexing, length, array(n), arrays as parameters, and
// in-place mutation. Transpiles to all 8 targets identically — even Lua
// (1-indexed under the hood), C (a malloc'd IntSlice), and Rust (Vec + borrows).
func sum(a: int[]): int {
  let s: int = 0;
  for (let i: int = 0; i < len(a); i = i + 1) {
    s = s + a[i];
  }
  return s;
}

func maxOf(a: int[]): int {
  let m: int = a[0];
  for (let i: int = 1; i < len(a); i = i + 1) {
    if (a[i] > m) {
      m = a[i];
    }
  }
  return m;
}

func main(): void {
  let nums: int[] = [5, 3, 9, 1, 7, 2];
  print(sum(nums));        // 27
  print(maxOf(nums));      // 9
  print(len(nums));        // 6

  // zero-filled array(n), then fill with squares 1..5
  let sq: int[] = array(5);
  for (let i: int = 0; i < 5; i = i + 1) {
    sq[i] = (i + 1) * (i + 1);
  }
  print(sum(sq));          // 55

  // reverse nums in place
  let n: int = len(nums);
  for (let i: int = 0; i < n / 2; i = i + 1) {
    let tmp: int = nums[i];
    nums[i] = nums[n - 1 - i];
    nums[n - 1 - i] = tmp;
  }
  print(nums[0]);          // 2
  print(nums[5]);          // 5
}
