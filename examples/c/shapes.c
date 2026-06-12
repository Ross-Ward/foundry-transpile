/* Real C structs: value declaration with a brace initializer, pointer params
 * (`struct Point *p` is the IR's reference), -> and . field access, and
 * mutation through a function. All 7 other targets match the original C. */
#include <stdio.h>

struct Point {
    int x;
    int y;
};

void translate(struct Point *p, int dx, int dy) {
    p->x += dx;
    p->y += dy;
}

int manhattan(struct Point *p) {
    int ax = p->x;
    int ay = p->y;
    if (ax < 0) {
        ax = -ax;
    }
    if (ay < 0) {
        ay = -ay;
    }
    return ax + ay;
}

int main(void) {
    struct Point p = {3, 4};
    printf("x: %d\n", p.x);
    printf("y: %d\n", p.y);
    translate(&p, 10, -9);
    printf("x: %d\n", p.x);
    printf("y: %d\n", p.y);
    printf("dist: %d\n", manhattan(&p));
    p.y++;
    printf("y: %d\n", p.y);
    return 0;
}
