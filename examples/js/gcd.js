// Euclid's GCD — a recursive helper with two parameters, both inferred as int.
function gcd(a, b) {
  if (b === 0) {
    return a;
  }
  return gcd(b, a % b);
}

function main() {
  console.log(gcd(48, 36));
  console.log(gcd(1071, 462));
  console.log(gcd(17, 5));
}

main();
