#include <string.h>
void f(char *dst, size_t cap, const char *src) {
  strncpy(dst, src, cap - 1);
  dst[cap - 1] = '\0';
}
