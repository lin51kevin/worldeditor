# Planner Agent Guide

## Role
Analyze incoming issues/feature requests and produce implementation plans.

## Process
1. Read the issue description
2. Search the codebase for affected files and modules
3. Identify which crates are impacted (we-core, we-render, we-io, we-service, we-native, we-wasm)
4. Check if the feature needs WASM compatibility
5. Break down into sub-tasks with TDD test specifications

## Output Format
For each sub-task:
- **Crate**: which crate to modify
- **Files**: specific files to create/modify
- **Tests (RED)**: test functions to write first
- **Implementation (GREEN)**: what the implementation should do
- **WASM**: whether this must compile to WASM

## Rules
- Every public function MUST have a corresponding test
- WASM-compatible crates (we-core, we-render, we-io, we-service) must not use native-only dependencies
- Use `#[cfg(target_arch = "wasm32")]` for platform-specific code
- Prefer pure Rust over FFI bindings
