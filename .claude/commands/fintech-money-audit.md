Audit the codebase for monetary calculation risks.

Scan for:
1. **Floating-point arithmetic on money**:
   - Any use of `float`, `double`, or JavaScript `number` for currency amounts
   - Arithmetic operations (+, -, *, /) on money values without decimal/integer cents
   - Rounding errors in tax, discount, or fee calculations
2. **Currency handling**:
   - Money values stored without currency code
   - Mixed-currency arithmetic without explicit conversion
   - Missing exchange rate snapshots for audit trail
3. **Rounding**:
   - Inconsistent rounding modes (banker's rounding vs. standard)
   - Rounding applied at intermediate steps instead of final result
   - Missing rounding specification in calculations
4. **Overflow / precision**:
   - Integer cents stored in types too small for large amounts
   - Multiplication (e.g., interest) without precision guards
   - Division without remainder handling

For each finding, report:
- **File**: path
- **Line**: number
- **Risk**: CRITICAL | HIGH | MEDIUM
- **Issue**: what could go wrong
- **Fix**: recommended change (e.g., use Decimal library, store as integer cents)
