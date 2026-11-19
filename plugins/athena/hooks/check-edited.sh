#!/bin/sh
# PostToolUse hook: check the file Claude just edited and surface blocking findings. Silent when clean or when
# Athena is unavailable. Exit code 2 returns the message to Claude.
input=$(cat)
file=$(printf '%s' "$input" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ -z "$file" ] && exit 0
[ -f "$file" ] || exit 0
if command -v athena >/dev/null 2>&1; then
  out=$(athena check "$file" --format json --quiet --fail-on high 2>/dev/null)
else
  out=$(npx --no-install athena check "$file" --format json --quiet --fail-on high 2>/dev/null)
fi
code=$?
[ "$code" -eq 1 ] || exit 0
printf '%s' "$out" | node -e '
let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
  try {
    const r=JSON.parse(s); const f=r.files.flatMap(x=>x.findings).filter(x=>x.confidence!=="low"&&(x.severity==="CRITICAL"||x.severity==="HIGH")).slice(0,5);
    if(!f.length) return;
    console.error("Athena found blocking issues in the file you just edited:\n"+f.map(x=>`- ${x.severity} ${x.type} at line ${x.line} (${x.ruleId}): ${String(x.message).slice(0,160)}`).join("\n")+"\nFix them, or use the athena-security skill to verify whether they are real.");
    process.exit(2);
  } catch { }
});'
exit $?
