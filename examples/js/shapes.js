// Real JavaScript classes become IR structs: field types are inferred from
// `new` call sites, and mutation through a function works on every target.
class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}

class Score {
  constructor(label, points) {
    this.label = label;
    this.points = points;
  }
}

function translate(p, dx, dy) {
  p.x += dx;
  p.y += dy;
}

function award(s, n) {
  s.points += n;
  s.label = s.label + "+";
}

function main() {
  let p = new Point(2, 3);
  translate(p, 5, -1);
  console.log(p.x);
  console.log(p.y);
  console.log(p.x * p.y);

  let s = new Score("level", 10);
  award(s, 32);
  award(s, 8);
  console.log(s.label + ": " + s.points);
  console.log(s.points > 49);
}

main();
