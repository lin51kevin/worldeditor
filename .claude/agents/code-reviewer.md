# Code Reviewer Agent Guide

## Automatic Checks

### WASM Compatibility
- [ ] we-core, we-render, we-io, we-service: no native-only dependencies added
- [ ] No `std::fs`, `std::net`, `std::process` in WASM-compatible crates
- [ ] `#[cfg(not(target_arch = "wasm32"))]` used for platform-specific code

### Code Quality
- [ ] All public functions have doc comments
- [ ] Error types use `thiserror` for proper error hierarchy
- [ ] No `.unwrap()` in library code (only in tests)
- [ ] Prefer `Result` over `panic!`

### API Consistency
- [ ] Tauri command signatures match frontend TypeScript types
- [ ] `PlatformService` interface covers all new operations
- [ ] Both `TauriPlatformService` and `WebPlatformService` implement new methods

### Testing
- [ ] New public API has corresponding unit tests
- [ ] Coverage thresholds are maintained
- [ ] Tests pass on both native and WASM targets
