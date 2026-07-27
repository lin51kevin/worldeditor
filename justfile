# WorldEditor — Development Commands
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

# Build the WASM package (debug) — FULL desktop-editor build.
# Includes every editor module (elevation, gis, gis_ext, io, junction_ops,
# measure, spline, topology, validation) via the `extra-modules` feature.
# Output: frontend/wasm/pkg — the default consumed by the desktop app, the
# frontend unit tests, and CI (typecheck/build/test).
build-wasm:
    wasm-pack build crates/we-wasm --target web --out-dir ../../frontend/wasm/pkg -- --features extra-modules

# Build the FULL WASM package (release, with wasm-opt) → frontend/wasm/pkg.
build-wasm-release:
    wasm-pack build crates/we-wasm --target web --out-dir ../../frontend/wasm/pkg --release -- --features extra-modules
    # Run wasm-opt -Oz. Prefer the frontend's binaryen devDep; fall back to a
    # system install. `--all-features` is required so binaryen accepts the
    # reference-types / bulk-memory / etc. that wasm-bindgen emits.
    if [ -x frontend/node_modules/.bin/wasm-opt ]; then \
      frontend/node_modules/.bin/wasm-opt -Oz --all-features frontend/wasm/pkg/we_wasm_bg.wasm -o frontend/wasm/pkg/we_wasm_bg.wasm.opt && \
      mv frontend/wasm/pkg/we_wasm_bg.wasm.opt frontend/wasm/pkg/we_wasm_bg.wasm; \
    elif command -v wasm-opt >/dev/null 2>&1; then \
      wasm-opt -Oz --all-features frontend/wasm/pkg/we_wasm_bg.wasm -o frontend/wasm/pkg/we_wasm_bg.wasm.opt && \
      mv frontend/wasm/pkg/we_wasm_bg.wasm.opt frontend/wasm/pkg/we_wasm_bg.wasm; \
    else \
      echo "wasm-opt not installed, skipping further optimization"; \
    fi
    du -h frontend/wasm/pkg/*.wasm

# Build the SLIM WASM package for the rnk-next embed ONLY (release + wasm-opt).
# Emits just the host's minimal surface (opendrive + render + pointcloud +
# picking); the extra editor modules are gated off. Output:
# frontend/wasm/pkg-slim — kept separate from the full frontend/wasm/pkg so the
# desktop-editor build is never overwritten. Consumed only by `build-rnk`.
build-wasm-rnk:
    wasm-pack build crates/we-wasm --target web --out-dir ../../frontend/wasm/pkg-slim --release
    if [ -x frontend/node_modules/.bin/wasm-opt ]; then \
      frontend/node_modules/.bin/wasm-opt -Oz --all-features frontend/wasm/pkg-slim/we_wasm_bg.wasm -o frontend/wasm/pkg-slim/we_wasm_bg.wasm.opt && \
      mv frontend/wasm/pkg-slim/we_wasm_bg.wasm.opt frontend/wasm/pkg-slim/we_wasm_bg.wasm; \
    elif command -v wasm-opt >/dev/null 2>&1; then \
      wasm-opt -Oz --all-features frontend/wasm/pkg-slim/we_wasm_bg.wasm -o frontend/wasm/pkg-slim/we_wasm_bg.wasm.opt && \
      mv frontend/wasm/pkg-slim/we_wasm_bg.wasm.opt frontend/wasm/pkg-slim/we_wasm_bg.wasm; \
    else \
      echo "wasm-opt not installed, skipping further optimization"; \
    fi
    du -h frontend/wasm/pkg-slim/*.wasm

# Build the rnk-next SDK bundle: slim wasm (pkg-slim) + vendored ESM SDK.
build-rnk: build-wasm-rnk
    cd frontend && yarn build:rnk

# Build frontend
build-frontend:
    cd frontend && yarn build

# Build external filesystem plugins (esbuild → plugins/<id>/dist/index.js).
# Requires Node 18+ (same as the frontend build). The output `plugins/`
# directory is shipped via Tauri bundle.resources and loaded at runtime.
build-plugins:
    node scripts/build-plugins.mjs

# Build everything
build-all: build build-wasm build-frontend build-plugins

# ── Web deploy artifact ────────────────────────────

# One-click build of the complete Web artifact → frontend/dist.
# Builds FULL release WASM (+ wasm-opt) then the static SPA (`yarn build:web`).
# This is the single entry point consumed by CI/CD and the Docker image.
build-web:
    node scripts/build-web.mjs

# Build the lightweight Nginx Docker image from the Web artifact.
# Produces frontend/dist first, then packages it via Dockerfile.web.
# Override the tag with: just docker-web tag=my-registry/worldeditor-web:1.0
docker-web tag="worldeditor-web:latest": build-web
    docker build -f Dockerfile.web -t {{tag}} .

# Serve frontend/dist locally via an externally provided nginx.exe
# (separate prefix/port — does not touch that nginx's own nginx.conf).
# nginx_bin defaults to the RoadNetworkRTService copy; override as needed:
#   just serve-dist nginx_bin=D:/other/nginx.exe port=9000
serve-dist nginx_bin="F:/Builds/MnemoGS_cooperation_20260702090447_91/Tools/RoadNetworkRTService/nginx.exe" port="8090":
    bash scripts/serve-dist-nginx.sh start "{{nginx_bin}}" {{port}}

# Stop the local nginx instance started by `just serve-dist`.
serve-dist-stop nginx_bin="F:/Builds/MnemoGS_cooperation_20260702090447_91/Tools/RoadNetworkRTService/nginx.exe":
    bash scripts/serve-dist-nginx.sh stop "{{nginx_bin}}"

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

# ── Visual Regression ──────────────────────────────

# Run Playwright visual regression tests only
test-visual:
    cd frontend && yarn playwright test e2e/visual-regression.spec.ts

# Update visual regression baselines (regenerate all screenshots)
update-snapshots:
    cd frontend && yarn playwright test e2e/visual-regression.spec.ts --update-snapshots

# Run all E2E tests (full suite)
test-e2e:
    cd frontend && yarn playwright test

# ── Benchmarks ─────────────────────────────────────

# Run frontend performance benchmarks
bench:
    cd frontend && yarn vitest bench

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
    rm -rf frontend/dist frontend/dist-rnk frontend/node_modules/.vite
    rm -rf crates/we-wasm/pkg frontend/wasm/pkg frontend/wasm/pkg-slim
    rm -rf coverage
