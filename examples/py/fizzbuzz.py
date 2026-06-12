# Real Python FizzBuzz — if/elif/else, modulo, and mixed int/string output.
def main():
    i = 1
    while i <= 20:
        if i % 15 == 0:
            print("FizzBuzz")
        elif i % 3 == 0:
            print("Fizz")
        elif i % 5 == 0:
            print("Buzz")
        else:
            print(i)
        i += 1


main()
