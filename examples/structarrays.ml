struct Point {
  x: int;
  y: int;
}

func shift(p: Point, dx: int): void {
  p.x = p.x + dx;
}

func sum_x(ps: Point[]): int {
  let t: int = 0;
  for (let i: int = 0; i < len(ps); i = i + 1) {
    t = t + ps[i].x;
  }
  return t;
}

func main(): void {
  let ps: Point[] = [Point(1, 2), Point(3, 4), Point(5, 6)];
  print(len(ps));
  print(sum_x(ps));
  shift(ps[0], 10);
  print(ps[0].x);
  ps[1].y = 40;
  print(ps[1].y);
  ps[2] = Point(7, 8);
  print(ps[2].x);
  print(sum_x(ps));
}
