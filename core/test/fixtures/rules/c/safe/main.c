#include <stdio.h>
#include <stdlib.h>
#include <string.h>

void copy(const char *input) {
  char buf[16];
  strncpy(buf, input, sizeof(buf) - 1);
  buf[sizeof(buf) - 1] = '\0';
  snprintf(buf, sizeof buf, "%s", input);
  fgets(buf, sizeof buf, stdin);
}

int main(int argc, char **argv) {
  printf("%s\n", argv[1]);
  int n = atoi(argv[2]);
  int *p = calloc(n, sizeof(int));
  if (p == NULL) return 1;
  char *q = malloc(n);
  if (q == NULL) { free(p); return 1; }
  free(q);
  free(p);
  return 0;
}
