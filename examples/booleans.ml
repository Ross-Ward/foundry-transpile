func is_even(n: int): bool {
  return n % 2 == 0;
}

func main(): void {
  print(true);
  print(false);
  print(1 < 2);
  print(is_even(7));

  let on: bool = true;
  let off: bool = !on;
  print(on && !off);
  print(on == off);

  let i: int = 0;
  while (i < 4) {
    print(i + " even: " + is_even(i));
    i = i + 1;
  }
  print("flag is " + on);
}
