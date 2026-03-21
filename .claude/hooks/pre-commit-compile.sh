#!/bin/bash
echo "🔨 Running build check..."
if [ -f "pyproject.toml" ] || [ -f "setup.py" ] || [ -f "requirements.txt" ]; then
  STAGED_PY=$(git diff --cached --name-only --diff-filter=ACM | grep '\.py$')
  if [ -n "$STAGED_PY" ]; then
    for file in $STAGED_PY; do
      python -m py_compile "$file" 2>&1
      if [ $? -ne 0 ]; then
        echo "❌ Syntax error in $file"
        exit 1
      fi
    done
    echo "  ✅ Python syntax OK"
  fi
fi
if [ -f "tsconfig.json" ]; then
  npx tsc --noEmit 2>&1
  if [ $? -ne 0 ]; then
    echo "❌ TypeScript compilation failed."
    exit 1
  fi
  echo "  ✅ TypeScript compilation OK"
fi
echo "🔨 Build check passed"
