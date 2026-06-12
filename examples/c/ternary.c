/* The conditional operator and numeric casts in real C, verified against the
 * zig cc-compiled original on every target. */
#include <stdio.h>

int main(void) {
    int score = 87;
    const char* grade = score >= 90 ? "A" : score >= 80 ? "B" : "C";
    printf("grade: %s\n", grade);

    double d = 7.75;
    printf("trunc: %d\n", (int)d);
    printf("neg: %d\n", (int)-d);

    int passed = score > 50 ? 1 : 0;
    printf("pass: %d\n", passed);
    return 0;
}
