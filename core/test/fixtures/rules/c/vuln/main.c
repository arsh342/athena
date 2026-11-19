#include <stdio.h>
#include <stdlib.h>
#include <string.h>

void copy(char *input) {
  char buf[16];
  strcpy(buf, input); // EXPECT memory.unsafe-function
  gets(buf); // EXPECT memory.unsafe-function
  sprintf(buf, "%s", input); // EXPECT memory.unsafe-function
}

int main(int argc, char **argv) {
  system(argv[1]); // EXPECT taint.command-injection
  printf(argv[1]); // EXPECT taint.format-string
  FILE *f = fopen(argv[2], "r"); // EXPECT taint.path-traversal, lifecycle.resource-not-released
  int n = atoi(argv[3]);
  char *p = malloc(n * 4); // EXPECT memory.malloc-size-arithmetic
  if (!p) return 1;
  char *q = malloc(n); // EXPECT memory.unchecked-malloc
  memcpy(q, p, n);
  return 0;
}
