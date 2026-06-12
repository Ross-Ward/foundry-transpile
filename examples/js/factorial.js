// Real JavaScript. Transpiled to Python/C/Go via inferred types; all four
// (including this original) print the same factorial table.
function fact(n) {
  if (n < 2) {
    return 1;
  }
  return n * fact(n - 1);
}

function main() {
  for (let i = 1; i <= 10; i++) {
    console.log(fact(i));
  }
}

main();
