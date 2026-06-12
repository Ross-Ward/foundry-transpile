// Real JavaScript arrays: literals, .length, indexing, and in-place mutation
// through a function. Transpiles to all 7 other languages, matching this run.
function sumArray(a) {
  let total = 0;
  for (let i = 0; i < a.length; i++) {
    total += a[i];
  }
  return total;
}

function scaleInPlace(a, factor) {
  for (let i = 0; i < a.length; i++) {
    a[i] = a[i] * factor;
  }
}

function main() {
  let nums = [4, 8, 15, 16, 23, 42];
  console.log(sumArray(nums));   // 108
  console.log(nums.length);      // 6
  console.log(nums[2]);          // 15
  scaleInPlace(nums, 2);
  console.log(sumArray(nums));   // 216
  console.log(nums[0]);          // 8
}

main();
