struct range {
  start: int;
  end: int;
}

func order(type: int, match: int): int {
  let end: int = type + match;
  return end;
}

func main(): void {
  let out: int = 3;
  let fun: int = 4;
  let local: int = order(out, fun);
  print(local);

  let when: string = "now";
  let def: string = when + " or " + "never";
  print(def);

  let loop: bool = out < fun;
  print(loop);

  for (let in: int = 0; in < 3; in = in + 1) {
    print(in);
  }

  let r: range = range(2, 9);
  print(r.end - r.start);
  r.end = r.end + 1;
  print(r.end);
}
