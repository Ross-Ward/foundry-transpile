def __f(x):
    s = ("%.6f" % x).rstrip("0")
    return s + "0" if s.endswith(".") else s


class Item:
    def __init__(self, name, qty, price):
        self.name = name
        self.qty = qty
        self.price = price


def total(items):
    sum_ = 0
    i = 0
    while (i < len(items)):
        sum_ = (sum_ + (items[i].price * float(items[i].qty)))
        i = (i + 1)
    return sum_



def tag(it):
    return (((it.name + " x") + str(it.qty)) + (" (bulk)" if (it.qty > 1) else ""))



def main():
    items = [Item("anvil", 2, 19.5), Item("tongs", 1, 7.25), Item("flux", 6, 0.5)]
    i = 0
    while (i < len(items)):
        if (items[i].qty == 0):
            i = (i + 1)
            continue
        print(tag(items[i]))
        i = (i + 1)
    print(__f(total(items)))
    print(int(total(items)))
    print("=== FOUNDRY ==="[4:11])
    print("true" if (len(items) >= 3) else "false")



if __name__ == "__main__":
    main()
