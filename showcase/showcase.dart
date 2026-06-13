String __f(double x) {
  var s = x.toStringAsFixed(6);
  while (s.endsWith('0')) {
    s = s.substring(0, s.length - 1);
  }
  if (s.endsWith('.')) {
    s += '0';
  }
  return s;
}

class Item {
  String name;
  int qty;
  double price;
  Item(this.name, this.qty, this.price);
}

double total(List<Item> items) {
  double sum = 0.0;
  for (int i = 0; (i < items.length); i = (i + 1)) {
    sum = (sum + (items[i].price * (items[i].qty).toDouble()));
  }
  return sum;
}

String tag(Item it) {
  return (((it.name + " x") + (it.qty).toString()) + ((it.qty > 1) ? " (bulk)" : ""));
}

void main() {
  List<Item> items = <Item>[Item("anvil", 2, 19.5), Item("tongs", 1, 7.25), Item("flux", 6, 0.5)];
  for (int i = 0; (i < items.length); i = (i + 1)) {
    if ((items[i].qty == 0)) {
      continue;
    }
    print(tag(items[i]));
  }
  print(__f(total(items)));
  print((total(items)).truncate());
  print("=== FOUNDRY ===".substring(4, 11));
  print((items.length >= 3));
}
