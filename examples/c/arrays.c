/* Real C with arrays: literal init, the sizeof length idiom, a zero-filled
 * declaration, and in-place mutation through functions taking `int a[]` and
 * `int*` params. Transpiles to the other 7 languages, all matching the
 * original C's output. */
#include <stdio.h>

int sum(int a[], int n) {
    int total = 0;
    for (int i = 0; i < n; i++) {
        total += a[i];
    }
    return total;
}

void scale(int* a, int n, int k) {
    for (int i = 0; i < n; i++) {
        a[i] = a[i] * k;
    }
}

int main(void) {
    int data[] = {3, 1, 4, 1, 5, 9, 2, 6};
    int n = sizeof(data) / sizeof(data[0]);
    printf("count: %d\n", n);
    printf("sum: %d\n", sum(data, n));
    scale(data, n, 2);
    printf("doubled sum: %d\n", sum(data, n));
    printf("last: %d\n", data[n - 1]);

    int squares[5];
    for (int i = 0; i < 5; i++) {
        squares[i] = i * i;
    }
    squares[0]++;
    squares[1] += 10;
    printf("square sum: %d\n", sum(squares, 5));
    return 0;
}
