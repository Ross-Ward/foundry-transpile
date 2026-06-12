// TypeScript classes with parameter properties become IR structs — the field
// types are written down, so no inference is needed (floats included).
class Vec2 {
  constructor(public x: float, public y: float) {}
}

class Player {
  constructor(public name: string, public hp: int) {}
}

function dot(a: Vec2, b: Vec2): float {
  return a.x * b.x + a.y * b.y;
}

function damage(p: Player, n: int): void {
  p.hp -= n;
  p.name = p.name + "*";
}

function main(): void {
  let v: Vec2 = new Vec2(1.5, 2.0);
  let w = new Vec2(0.5, 4.0);
  console.log(dot(v, w));
  v.x += 1.0;
  console.log(v.x + v.y);

  let hero = new Player("ranger", 30);
  damage(hero, 12);
  damage(hero, 5);
  console.log(hero.name + " " + hero.hp);
  console.log(hero.hp < 15);
}

main();
