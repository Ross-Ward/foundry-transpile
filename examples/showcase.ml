struct Item {
  name: string;
  qty: int;
  price: float;
}

func total(items: Item[]): float {
  let sum: float = 0.0;
  for (let i: int = 0; i < len(items); i = i + 1) {
    sum = sum + items[i].price * float(items[i].qty);
  }
  return sum;
}

func tag(it: Item): string {
  return it.name + " x" + it.qty + (it.qty > 1 ? " (bulk)" : "");
}

func main(): void {
  let items: Item[] = [Item("anvil", 2, 19.5), Item("tongs", 1, 7.25), Item("flux", 6, 0.5)];
  for (let i: int = 0; i < len(items); i = i + 1) {
    if (items[i].qty == 0) { continue; }
    print(tag(items[i]));
  }
  print(total(items));
  print(int(total(items)));
  print(substr("=== FOUNDRY ===", 4, 11));
  print(len(items) >= 3);
}
