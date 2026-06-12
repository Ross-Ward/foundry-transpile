# break/continue in real Python loops — `continue` in a range-for must still
# advance the loop variable on every target.
def main():
    total = 0
    for i in range(10):
        if i % 2 == 0:
            continue
        if i > 7:
            break
        total += i
    print(total)

    n = 0
    while n < 20:
        n += 1
        if n % 5 != 0:
            continue
        print(n)

main()
