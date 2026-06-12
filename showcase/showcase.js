function __f(x) {
  let s = x.toFixed(6).replace(/0+$/, "");
  return s.endsWith(".") ? s + "0" : s;
}

function total(items) {
  let sum = 0;
  for (let i = 0; (i < items.length); i = (i + 1)) {
    sum = (sum + (items[i].price * (items[i].qty)));
  }
  return sum;
}

function tag(it) {
  return (((it.name + " x") + it.qty) + ((it.qty > 1) ? " (bulk)" : ""));
}

function main() {
  let items = [{ name: "anvil", qty: 2, price: 19.5 }, { name: "tongs", qty: 1, price: 7.25 }, { name: "flux", qty: 6, price: 0.5 }];
  for (let i = 0; (i < items.length); i = (i + 1)) {
    if ((items[i].qty === 0)) {
      continue;
    }
    console.log(tag(items[i]));
  }
  console.log(__f(total(items)));
  console.log(Math.trunc(total(items)) + 0);
  console.log("=== FOUNDRY ===".substring(4, 11));
  console.log((items.length >= 3));
}

main();
