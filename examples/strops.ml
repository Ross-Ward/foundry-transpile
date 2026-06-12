func main(): void {
  let s: string = "transpile";
  print(len(s));
  print(substr(s, 0, 5));
  print(substr(s, 5, len(s)));

  print("apple" < "banana");
  print("b" < "apple");
  print("same" == "same");

  let w: string = "hello world";
  print(substr(w, 6, 11));
  print(len(substr(w, 0, 5)));
}
