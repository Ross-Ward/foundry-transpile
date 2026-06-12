using System;

class Program {
    class Item {
        public string name;
        public int qty;
        public double price;
        public Item(string name, int qty, double price) { this.name = name; this.qty = qty; this.price = price; }
    }
    static double total(Item[] items) {
        double sum = 0.0;
        for (int i = 0; (i < items.Length); i = (i + 1)) {
            sum = (sum + (items[i].price * (double)(items[i].qty)));
        }
        return sum;
    }

    static string tag(Item it) {
        return (((it.name + " x") + it.qty) + ((it.qty > 1) ? " (bulk)" : ""));
    }

    static void main() {
        Item[] items = new Item[]{new Item("anvil", 2, 19.5), new Item("tongs", 1, 7.25), new Item("flux", 6, 0.5)};
        for (int i = 0; (i < items.Length); i = (i + 1)) {
            if ((items[i].qty == 0)) {
                continue;
            }
            Console.WriteLine(tag(items[i]));
        }
        Console.WriteLine(__f(total(items)));
        Console.WriteLine((int)(total(items)));
        Console.WriteLine("=== FOUNDRY ===".Substring(4, (11) - (4)));
        Console.WriteLine((items.Length >= 3) ? "true" : "false");
    }

    static string __f(double x) {
        string s = x.ToString("F6", System.Globalization.CultureInfo.InvariantCulture).TrimEnd('0');
        return s.EndsWith(".") ? s + "0" : s;
    }
    static void Main() {
        main();
    }
}
