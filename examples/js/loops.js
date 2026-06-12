// break/continue in real JavaScript loops — continue must still run the
// for-update on every target (the while-fallback targets duplicate it).
function main() {
  let total = 0;
  for (let i = 0; i < 10; i++) {
    if (i % 2 === 0) { continue; }
    if (i > 7) { break; }
    total += i;
  }
  console.log(total);

  let n = 0;
  while (n < 30) {
    n += 7;
    if (n % 2 !== 0) { continue; }
    console.log(n);
  }
}

main();
