/* Real C with a bool-returning function and a nested loop. Transpiles to the
 * other 7 languages, all matching the original C's prime list. */
#include <stdio.h>
#include <stdbool.h>

bool is_prime(int n) {
    if (n < 2) {
        return false;
    }
    for (int i = 2; i * i <= n; i++) {
        if (n % i == 0) {
            return false;
        }
    }
    return true;
}

int main(void) {
    int found = 0;
    int n = 2;
    while (found < 8) {
        if (is_prime(n)) {
            printf("prime: %d\n", n);
            found += 1;
        }
        n += 1;
    }
    return 0;
}
