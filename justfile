# WorldEditor Next — Development Commands
# Usage: just <command>
# Install: cargo install just

# Default: show available commands
default:
    @just --list

# ── Build ──────────────────────────────────────────

# Build all Rust crates (native)
build:
    cargo build --workspace

# Build in release mode
build-release:
    cargo build --workspace --release

# Build WASM package (debug)
build-wasm:
    wasm-pack build crates/we-wasm --target web --out-dir ../../frontend/wasm/pkg

# Build WASM package (release with wasm-opt)
build-wasm-release:
    wasm-pack build crates/we-wasm --target web --out-dir ../../frontend/wasm/pkg --release
    # Run wasm-opt if available
    if command -v wasm-opt >/dev/null 2>&1; then \
      wasm-opt -Oz frontend/wasm/pkg/we_wasm_bg.wasm -o frontend/wasm/pkg/we_wasm_bg.wasm.opt && \
      mv frontend/wasm/pkg/we_wasm_bg.wasm.opt frontend/wasm/pkg/we_wasm_bg.wasm; \
    else \
      echo "wasm-opt not installed, skipping further optimization"; \
    fi
    du -h frontend/wasm/pkg/*.wasm

# Build frontend
build-frontend:
    cd frontend && yarn build

# Build everything
build-all: build build-wasm build-frontend

# ── Test ───────────────────────────────────────────

# Run all Rust tests
test-rust:
    cargo test --workspace

# Run Rust tests with coverage
test-rust-cov:
    cargo llvm-cov --workspace --html --output-dir coverage/rust

# Run WASM tests
test-wasm:
    wasm-pack test --headless --chrome crates/we-wasm

# Run frontend tests
test-frontend:
    cd frontend && yarn test

# Run frontend tests with coverage
test-frontend-cov:
    cd frontend && yarn test:coverage

# Run ALL tests
test: test-rust test-frontend

# ── Lint ───────────────────────────────────────────

# Lint Rust code
lint-rust:
    cargo clippy --workspace -- -D warnings

# Check Rust formatting
fmt-check:
    cargo fmt --all -- --check

# Format Rust code
fmt:
    cargo fmt --all

# Lint frontend
lint-frontend:
    cd frontend && yarn lint

# Lint everything
lint: lint-rust lint-frontend

# ── Dev ────────────────────────────────────────────

# Start frontend dev server
dev-frontend:
    cd frontend && yarn dev

# Start Tauri dev mode
dev-tauri:
    cd frontend && yarn dev:tauri &
    cargo tauri dev

# Check all code compiles
check:
    cargo check --workspace
    cd frontend && yarn typecheck

# Security audit
audit:
    cargo audit

# ── Package / Bundle ───────────────────────────────

# Install Tauri CLI (run once)
install-tauri-cli:
    cargo install tauri-cli

# Bundle desktop installer for the current platform (release)
bundle:
    cd frontend && yarn install --immutable
    cargo tauri build

# Bundle for a specific Rust target triple
# Usage: just bundle-target x86_64-pc-windows-msvc
bundle-target target:
    cd frontend && yarn install --immutable
    cargo tauri build --target {{target}}

# ── Clean ──────────────────────────────────────────

# Clean all build artifacts
clean:
    cargo clean
    rm -rf frontend/dist frontend/node_modules/.vite
    rm -rf crates/we-wasm/pkg
    rm -rf coverage
