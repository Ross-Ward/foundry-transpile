#include <stdio.h>
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>

static const char *__substr(const char *s, int a, int b) {
    int n = (int)strlen(s);
    if (a < 0) a = 0; if (b > n) b = n; if (b < a) b = a;
    char *r = (char *)malloc((size_t)(b - a) + 1);
    memcpy(r, s + a, (size_t)(b - a)); r[b - a] = 0;
    return r;
}
#include <string.h>

static char __bufs[64][512];
static int __bi = 0;
static char *__buf(void) { char *b = __bufs[__bi]; __bi = (__bi + 1) % 64; return b; }
static const char *__fmt(double x) {
    char *b = __buf();
    snprintf(b, 512, "%.6f", x);
    int n = (int)strlen(b);
    while (n > 0 && b[n - 1] == '0') b[--n] = 0;
    if (n > 0 && b[n - 1] == '.') { b[n++] = '0'; b[n] = 0; }
    return b;
}
static const char *__str_int(int v) { char *b = __buf(); snprintf(b, 512, "%d", v); return b; }
static const char *__concat(const char *a, const char *b) { char *r = __buf(); snprintf(r, 512, "%s%s", a, b); return r; }
#include <stdlib.h>
#include <string.h>

static const char *__dups(const char *v) {
    size_t n = strlen(v) + 1; char *r = (char *)malloc(n); memcpy(r, v, n); return r;
}
#include <stdlib.h>
#include <stdarg.h>
#include <string.h>

typedef struct { int *data; int len; } IntSlice;
static IntSlice __arr(int n, ...) {
    IntSlice s; s.len = n; s.data = (int *)malloc(sizeof(int) * (n > 0 ? n : 1));
    va_list ap; va_start(ap, n);
    for (int i = 0; i < n; i++) s.data[i] = va_arg(ap, int);
    va_end(ap);
    return s;
}
static IntSlice __newarr(int n) {
    IntSlice s; s.len = n; s.data = (int *)calloc(n > 0 ? n : 1, sizeof(int));
    return s;
}
typedef struct { double *data; int len; } FloatSlice;
static FloatSlice __arrf(int n, ...) {
    FloatSlice s; s.len = n; s.data = (double *)malloc(sizeof(double) * (n > 0 ? n : 1));
    va_list ap; va_start(ap, n);
    for (int i = 0; i < n; i++) s.data[i] = va_arg(ap, double);
    va_end(ap);
    return s;
}
typedef struct { const char **data; int len; } StrSlice;
static StrSlice __arrs(int n, ...) {
    StrSlice s; s.len = n; s.data = (const char **)malloc(sizeof(char *) * (n > 0 ? n : 1));
    va_list ap; va_start(ap, n);
    for (int i = 0; i < n; i++) s.data[i] = __dups(va_arg(ap, const char *));
    va_end(ap);
    return s;
}
typedef struct Item Item;
struct Item { const char* name; int qty; double price; };
static Item *__new_Item(const char* name, int qty, double price) {
    Item *s = (Item *)malloc(sizeof(Item));
    s->name = __dups(name); s->qty = qty; s->price = price;
    return s;
}
typedef struct { Item **data; int len; } ItemSlice;
static ItemSlice __arr_Item(int n, ...) {
    ItemSlice s; s.len = n; s.data = (Item **)malloc(sizeof(Item *) * (n > 0 ? n : 1));
    va_list ap; va_start(ap, n);
    for (int i = 0; i < n; i++) s.data[i] = va_arg(ap, Item *);
    va_end(ap);
    return s;
}

double total(ItemSlice items);
const char* tag(Item* it);

double total(ItemSlice items) {
    double sum = 0.0;
    for (int i = 0; (i < items.len); i = (i + 1)) {
        sum = (sum + (items.data[i]->price * (double)(items.data[i]->qty)));
    }
    return sum;
}

const char* tag(Item* it) {
    return __concat(__concat(__concat(it->name, " x"), __str_int(it->qty)), ((it->qty > 1) ? " (bulk)" : ""));
}

int main(void) {
    ItemSlice items = __arr_Item(3, __new_Item("anvil", 2, 19.5), __new_Item("tongs", 1, 7.25), __new_Item("flux", 6, 0.5));
    for (int i = 0; (i < items.len); i = (i + 1)) {
        if ((items.data[i]->qty == 0)) {
            continue;
        }
        printf("%s\n", tag(items.data[i]));
    }
    printf("%s\n", __fmt(total(items)));
    printf("%d\n", (int)(total(items)));
    printf("%s\n", __substr("=== FOUNDRY ===", 4, 11));
    printf("%s\n", (items.len >= 3) ? "true" : "false");
    return 0;
}

