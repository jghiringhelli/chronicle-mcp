#!/bin/bash
# Volatility unit confusion is the single most common source of false crash triggers
# and missed recovery conditions in financial simulations.
#
# This hook catches the two double-scaling patterns:
#   / sqrt(N)  applied to a field already stored as percentage-per-period
#   * 100      applied to a field already stored as percentage-per-period
#
# CUSTOMIZE: replace VOL_FIELD_PATTERNS with the actual field names used in
# this codebase (e.g. vol_pct_per_day, sigma_stored, realised_vol_pct).
# The generic pattern below catches common naming conventions.
#
# Label: customize VOL_FIELD_PATTERNS for this project's field names.

STAGED=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(py|ts|tsx|js|jsx|go|rs)$')
if [ -z "$STAGED" ]; then exit 0; fi

# Generic vol field patterns — override with project-specific names
VOL_FIELD_PATTERNS="vol_pct|sigma_pct|realized_vol|implied_vol|vol_stored|pct_vol|annualized_vol"

VIOLATIONS=0

for file in $STAGED; do
  # Pattern 1: double sqrt-annualization on a _pct / stored vol field
  if grep -nE "($VOL_FIELD_PATTERNS).*/ ?sqrt\(|sqrt\(.*\).*($VOL_FIELD_PATTERNS)" "$file" 2>/dev/null | grep -v "^[[:space:]]*//" | grep -q .; then
    echo "  ❌ $file — possible double sqrt-scaling on a percentage-per-period vol field"
    echo "     Vol fields stored as pct-per-period must not be divided by sqrt(N) again."
    grep -nE "($VOL_FIELD_PATTERNS).*/ ?sqrt\(|sqrt\(.*\).*($VOL_FIELD_PATTERNS)" "$file" | grep -v "^[[:space:]]*//"
    VIOLATIONS=$((VIOLATIONS + 1))
  fi

  # Pattern 2: *100 on a field already stored as percentage
  if grep -nE "($VOL_FIELD_PATTERNS).*\* ?100[^.]|[^.]100 ?\* ?.*($VOL_FIELD_PATTERNS)" "$file" 2>/dev/null | grep -v "^[[:space:]]*//" | grep -q .; then
    echo "  ❌ $file — possible *100 rescaling on a percentage-per-period vol field"
    echo "     Vol fields stored as pct-per-period must not be multiplied by 100 again."
    grep -nE "($VOL_FIELD_PATTERNS).*\* ?100[^.]|[^.]100 ?\* ?.*($VOL_FIELD_PATTERNS)" "$file" | grep -v "^[[:space:]]*//"
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done

if [ $VIOLATIONS -gt 0 ]; then
  echo ""
  echo "❌ Vol unit convention violation(s) found."
  echo "   Check that the field is stored as a raw ratio (0.03 = 3%), not already as percentage."
  echo "   To suppress a false positive: add a comment '# vol-unit: raw-ratio' on the same line."
  exit 1
fi
