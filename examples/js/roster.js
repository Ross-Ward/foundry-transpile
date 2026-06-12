// Arrays of class instances from real JavaScript: the frontend infers Dot[]
// for the parameters from the call sites.
class Dot {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}

function shiftAll(ds, dx) {
  for (let i = 0; i < ds.length; i++) {
    ds[i].x += dx;
  }
}

function total(ds) {
  let t = 0;
  for (let i = 0; i < ds.length; i++) {
    t += ds[i].x + ds[i].y;
  }
  return t;
}

function main() {
  let ds = [new Dot(1, 2), new Dot(3, 4)];
  console.log(total(ds));
  shiftAll(ds, 10);
  console.log(total(ds));
  console.log(ds[0].x);
  ds[1] = new Dot(0, 0);
  console.log(total(ds));
}

main();
