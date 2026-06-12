struct Point {
  x: int;
  y: int;
}

struct Label {
  name: string;
  hits: int;
}

func translate(p: Point, dx: int, dy: int): void {
  p.x = p.x + dx;
  p.y = p.y + dy;
}

func manhattan(p: Point): int {
  let ax: int = p.x;
  let ay: int = p.y;
  if (ax < 0) { ax = 0 - ax; }
  if (ay < 0) { ay = 0 - ay; }
  return ax + ay;
}

func origin_dist(): int {
  return manhattan(Point(3, -4));
}

func bump(l: Label): void {
  l.hits = l.hits + 1;
  l.name = l.name + "*";
}

func main(): void {
  let p: Point = Point(3, 4);
  print(p.x);
  print(p.y);
  translate(p, 10, -2);
  print(p.x);
  print(p.y);
  print(manhattan(p));
  print(origin_dist());

  let tag: Label = Label("build", 1);
  bump(tag);
  bump(tag);
  print(tag.name + ":" + tag.hits);
}
