fun __f(x: Double): String {
    var s = String.format(java.util.Locale.US, "%.6f", x).trimEnd('0')
    if (s.endsWith(".")) s += "0"
    return s
}

class Item(var name: String, var qty: Int, var price: Double)

fun total(items: Array<Item>): Double {
    var sum: Double = 0.0
    run {
        var i: Int = 0
        while ((i < items.size)) {
            sum = (sum + (items[i].price * (items[i].qty).toDouble()))
            i = (i + 1)
        }
    }
    return sum
}

fun tag(it_: Item): String {
    return (((it_.name + " x") + it_.qty) + (if ((it_.qty > 1)) " (bulk)" else ""))
}

fun main() {
    var items: Array<Item> = arrayOf(Item("anvil", 2, 19.5), Item("tongs", 1, 7.25), Item("flux", 6, 0.5))
    run {
        var i: Int = 0
        while ((i < items.size)) {
            if ((items[i].qty == 0)) {
                i = (i + 1)
                continue
            }
            println(tag(items[i]))
            i = (i + 1)
        }
    }
    println(__f(total(items)))
    println((total(items)).toInt())
    println("=== FOUNDRY ===".substring(4, 11))
    println((items.size >= 3))
}
