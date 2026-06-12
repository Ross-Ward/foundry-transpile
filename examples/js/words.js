// Real JavaScript string arrays: the frontend infers string[] for the locals
// AND the params (element types propagate from call sites). Transpiles to all
// 7 other languages, matching this run.
function exclaim(words) {
  for (let i = 0; i < words.length; i++) {
    words[i] = words[i] + "!";
  }
}

function pick(words, idx) {
  return words[idx];
}

function main() {
  let words = ["bright", "bold", "brave"];
  exclaim(words);
  console.log(pick(words, 0));
  console.log(pick(words, 2) + " and " + words[1]);
  console.log(words.length);
}

main();
