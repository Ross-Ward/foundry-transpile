/* Real C. Transpiled to the other 7 languages; every one (and this original,
 * compiled with a C compiler) prints the same Collatz step counts. */
#include <stdio.h>
#include <stdbool.h>

int collatz_steps(int n) {
    int steps = 0;
    while (n != 1) {
        if (n % 2 == 0) {
            n = n / 2;
        } else {
            n = 3 * n + 1;
        }
        steps += 1;
    }
    return steps;
}

int main(void) {
    for (int i = 1; i <= 12; i++) {
        printf("%d takes %d steps\n", i, collatz_steps(i));
    }
    return 0;
}
