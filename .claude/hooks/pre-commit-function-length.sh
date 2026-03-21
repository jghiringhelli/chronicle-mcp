#!/bin/bash
MAX_LENGTH={{max_function_length | default: 50}}
STAGED=$(git diff --cached --name-only --diff-filter=ACM)
SOURCE_FILES=$(echo "$STAGED" | grep -E '\.(ts|tsx|js|jsx)$' | grep -vE '(\.test\.|\.spec\.|__tests__|tests/)')
if [ -z "$SOURCE_FILES" ]; then exit 0; fi
WARNINGS=0
for file in $SOURCE_FILES; do
  # Heuristic: find function/method declarations and count lines to next declaration or closing brace
  awk -v max="$MAX_LENGTH" -v fname="$file" '
    /^[[:space:]]*(export )?(async )?(function |const [a-zA-Z]+ = (async )?\(|[a-zA-Z]+\(.*\) \{|[a-zA-Z]+\(.*\): )/ {
      if (start > 0 && NR - start > max) {
        printf "  ⚠️  %s:%d — function starting here is %d lines (max %d)\n", fname, start, NR - start, max
        warnings++
      }
      start = NR
    }
    END {
      if (start > 0 && NR - start > max) {
        printf "  ⚠️  %s:%d — function starting here is %d lines (max %d)\n", fname, start, NR - start, max
        warnings++
      }
    }
  ' "$file"
  WARNINGS=$((WARNINGS + $?))
done
# Warning only — does not block commit since bash heuristics aren't perfect
exit 0
