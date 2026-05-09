# TDD Guide

## Strict RED → GREEN → REFACTOR

### RED Phase
1. Write the test FIRST
2. Run the test — it MUST fail
3. Verify it fails for the RIGHT reason (not a compile error, but a logic failure)

### GREEN Phase
1. Write the MINIMUM code to make the test pass
2. Do not write more than needed
3. Run the test — it MUST pass
4. Run ALL tests — nothing else should break

### REFACTOR Phase
1. Clean up the implementation
2. Extract common code if repeated 3+ times
3. Ensure naming is clear and consistent
4. Run ALL tests — everything must still pass

## Dual-Target Testing
For WASM-compatible crates:
```bash
cargo test -p we-core        # native
wasm-pack test --headless --chrome crates/we-core  # WASM
```

## Coverage Requirements
| Crate | Threshold |
|-------|-----------|
| we-core | ≥ 90% |
| we-render | ≥ 70% |
| we-io | ≥ 85% |
| we-service | ≥ 85% |
| frontend | ≥ 80% |

## Property-Based Testing
Use `proptest` for:
- Serialization roundtrips (serialize → deserialize → assertEqual)
- Coordinate transforms (forward → inverse → assertEqual within epsilon)
- Geometry algorithms (random inputs → verify invariants)
