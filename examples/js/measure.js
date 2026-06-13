// Float arrays from real JavaScript: the literal's element type makes the
// param double[] on the typed targets, verified against this run.
function totalOf(xs) {
  let t = 0.5;
  for (let i = 0; i < xs.length; i++) {
    t += xs[i];
  }
  return t;
}

function main() {
  let readings = [1.25, 2.5, 0.5];
  console.log(totalOf(readings));
  readings[1] = 4.25;
  console.log(totalOf(readings));
  console.log(readings.length);
}

main();
