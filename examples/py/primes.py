# Sieve-ish primality by trial division — nested loop + boolean flag, all int.
def is_prime(n):
    if n < 2:
        return 0
    i = 2
    while i * i <= n:
        if n % i == 0:
            return 0
        i += 1
    return 1


def main():
    count = 0
    n = 2
    while count < 10:
        if is_prime(n) == 1:
            print(n)
            count += 1
        n += 1


main()
