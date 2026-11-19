#!/bin/sh
# PostToolUse hook for Bash: after a `git commit`, remind Claude that /athena-review exists. Never blocks.
input=$(cat)
case "$input" in
  *'git commit'*) printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"A commit was just made. If it touched code, consider running /athena-review on the last commit (range HEAD~1..HEAD) before pushing."}}' ;;
esac
exit 0
