#include <stdio.h>

/**
 * Returns the larger value.
 */
int max_of(int a, int b)
{
    return a > b ? a : b;
}

struct point {
    int x;
    int y;
};

static int sum(const int *values, int count)
{
    int total = 0;
    for (int i = 0; i < count; i++) {
        if (values[i] > 0 && values[i] < 100) {
            total += values[i];
        }
    }
    return total;
}

/* block comment
   spanning lines */

int main(void)
{
    printf("%d\n", max_of(1, 2));
    return 0;
}
