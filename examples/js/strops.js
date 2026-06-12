// String length/substring and Math.trunc from real JavaScript — substring is
// the IR's substr, Math.trunc is an int cast, both verified against this run.
function pick(s, a, b) {
  return s.substring(a, b);
}

function main() {
  let s = "transpiler";
  console.log(s.length);
  console.log(pick(s, 0, 5));
  console.log(s.substring(5, s.length));
  console.log(Math.trunc(7.9));
  console.log("apple" < "banana");
}

main();
