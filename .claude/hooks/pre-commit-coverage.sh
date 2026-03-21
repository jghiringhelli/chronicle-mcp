#!/bin/bash
# ──────────────────────────────────────────────────────────────────────
# Pre-Commit Hook: Coverage Gate
#
# Enforces minimum coverage thresholds before a commit lands.
# Thresholds are read from vitest.config.ts (via --coverage).
# Only runs when files under src/ are staged — skips for
# docs-only, config-only, or test-only commits.
#
# Current thresholds (vitest.config.ts):
#   Lines / Statements / Functions: {{coverage_minimum | default: 80}}%
#   Branches: 70%
#
# Trigger: git pre-commit (via scripts/setup-hooks.sh)
# Exit: 1 blocks commit, 0 allows
# ──────────────────────────────────────────────────────────────────────

STAGED=$(git diff --cached --name-only --diff-filter=ACM)

if [ -z "$STAGED" ]; then
  exit 0
fi

# ── Check if any src/ file is staged ─────────────────────────────────
SRC_STAGED=0
while IFS= read -r file; do
  if echo "$file" | grep -qE '^src/'; then
    SRC_STAGED=1
    break
  fi
done <<< "$STAGED"

if [ "$SRC_STAGED" -eq 0 ]; then
  echo "📊 Coverage gate: no src/ files staged, skipping."
  exit 0
fi

# ── Run coverage ───────────────────────────────────────────────────────
echo "📊 Running coverage gate (src/ files staged)..."

if [ ! -f "package.json" ]; then
  echo "  ⚠️  No package.json found — skipping coverage check."
  exit 0
fi

if grep -q '"vitest"' package.json 2>/dev/null; then
  OUTPUT=$(npx vitest run --coverage --reporter=verbose 2>&1)
  EXIT_CODE=$?

  if [ $EXIT_CODE -ne 0 ]; then
    echo "$OUTPUT" | grep -E "ERROR|Coverage|does not meet|%|FAIL|passed|failed" | head -40
    echo ""
    echo "❌ Coverage gate failed — thresholds not met."
    echo "   Run 'npx vitest run --coverage' locally to see the full report."
    echo "   Add tests until coverage meets the configured minimums."
    exit 1
  fi
  echo "  ✅ Coverage gate passed"
  exit 0
fi

if grep -q '"jest"' package.json 2>/dev/null; then
  COVERAGE_MIN={{coverage_minimum | default: 80}}
  npx jest --passWithNoTests --coverage \
    --coverageThreshold="{\"global\":{\"lines\":$COVERAGE_MIN,\"statements\":$COVERAGE_MIN,\"functions\":$COVERAGE_MIN,\"branches\":70}}" \
    --silent 2>&1
  if [ $? -ne 0 ]; then
    echo "❌ Coverage gate failed — thresholds not met."
    exit 1
  fi
  echo "  ✅ Coverage gate passed"
  exit 0
fi

if [ -f "pyproject.toml" ] || [ -f "setup.py" ]; then
  if command -v pytest &> /dev/null; then
    pytest --tb=no --quiet --cov=src --cov-fail-under={{coverage_minimum | default: 80}} 2>&1
    if [ $? -ne 0 ]; then
      echo "❌ Coverage gate failed — below {{coverage_minimum | default: 80}}%."
      exit 1
    fi
    echo "  ✅ Coverage gate passed"
  fi
fi

exit 0
