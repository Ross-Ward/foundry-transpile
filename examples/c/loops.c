/* break/continue in real C loops, verified against the zig cc-compiled
 * original on every target. */
#include <stdio.h>

int main(void) {
    int total = 0;
    for (int i = 0; i < 10; i++) {
        if (i % 2 == 0) {
            continue;
        }
        if (i > 7) {
            break;
        }
        total += i;
    }
    printf("total: %d\n", total);

    int n = 0;
    while (n < 40) {
        n += 9;
        if (n % 2 != 0) {
            continue;
        }
        printf("even: %d\n", n);
    }
    return 0;
}
