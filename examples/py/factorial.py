# Real Python. Transpiled to JS/C/Go via inferred types; all four (including
# this original) print the same factorial table.
def fact(n):
    if n < 2:
        return 1
    return n * fact(n - 1)


def main():
    for i in range(1, 11):
        print(fact(i))


main()
