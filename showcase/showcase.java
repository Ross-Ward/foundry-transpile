public class Program {
    static class Item {
        String name;
        int qty;
        double price;
        Item(String name, int qty, double price) { this.name = name; this.qty = qty; this.price = price; }
    }
    static double total(Item[] items) {
        double sum = 0.0;
        for (int i = 0; (i < items.length); i = (i + 1)) {
            sum = (sum + (items[i].price * (double)(items[i].qty)));
        }
        return sum;
    }

    static String tag(Item it) {
        return (((it.name + " x") + it.qty) + ((it.qty > 1) ? " (bulk)" : ""));
    }

    static void main() {
        Item[] items = new Item[]{new Item("anvil", 2, 19.5), new Item("tongs", 1, 7.25), new Item("flux", 6, 0.5)};
        for (int i = 0; (i < items.length); i = (i + 1)) {
            if ((items[i].qty == 0)) {
                continue;
            }
            System.out.println(tag(items[i]));
        }
        System.out.println(__f(total(items)));
        System.out.println((int)(total(items)));
        System.out.println("=== FOUNDRY ===".substring(4, 11));
        System.out.println((items.length >= 3));
    }

    static String __f(double x) {
        String s = String.format(java.util.Locale.US, "%.6f", x).replaceAll("0+$", "");
        return s.endsWith(".") ? s + "0" : s;
    }
    public static void main(String[] args) {
        main();
    }
}
