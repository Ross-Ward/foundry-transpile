# Real Python string lists: the frontend infers string[] for locals and params,
# and a call site passing a string upgrades a numeric-looking param guess.
def label(items, tag):
    for i in range(len(items)):
        items[i] = items[i] + tag

def first_match(items, target):
    for i in range(len(items)):
        if items[i] == target:
            return i
    return -1

def main():
    fruits = ["apple", "plum", "cherry"]
    label(fruits, "?")
    print(fruits[0])
    print(first_match(fruits, "plum?"))
    print(len(fruits))

main()
