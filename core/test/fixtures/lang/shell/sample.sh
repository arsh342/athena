#!/usr/bin/env bash

# Prints a greeting.
greet() {
  local name="$1"
  echo "hello $name"
}

function cleanup {
  rm -rf "$TMP_DIR"
  echo "cleaned"
}

deploy() {
  # comment block inside deploy
  if [ -z "$1" ] || [ "$1" = "dry" ]; then
    echo "dry run"
  fi
  for f in *.txt; do
    echo "$f"
  done
}

main() {
  greet "world"
  deploy "$@"
}
