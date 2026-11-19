#include <string.h>
#include <alloca.h>
void f(char *dst, const char *src, int n) {
  strncpy(dst, src, strlen(src)); // EXPECT c-memory-safety.strncpy-source-length
  char *p = alloca(n); // EXPECT c-memory-safety.alloca-variable-size
}
