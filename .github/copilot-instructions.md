# WorldEditor Next — Copilot Instructions

## 项目上下文

这是一个 Rust + TypeScript 的自动驾驶道路网络编辑器，采用 Tauri 2.0 桌面端 + WASM Web 端双端架构。

## Rust 代码规范

- 使用 Rust 2024 edition
- 不可变优先，避免 `.clone()` 滥用
- 错误处理使用 `thiserror` + `Result<T, E>`，禁止 `unwrap()`（测试除外）
- 公开 API 必须有 `///` 文档注释
- 序列化类型 derive `Serialize, Deserialize, Debug, Clone`
- 禁止 `unsafe` 除非必要（需 `// SAFETY:` 注释）
- 日志使用 `log` crate（`info!`, `warn!`, `error!`）

## TypeScript 代码规范

- React 19 函数式组件 + Hooks
- 状态管理仅用 Zustand 5
- 严格类型，禁止 `any`
- 不可变更新：`{ ...state, field: newValue }`

## 架构约束

- `we-core` 是纯领域逻辑，零平台依赖，必须 WASM 兼容
- `we-native` 仅桌面端，**禁止**被 `we-wasm` 依赖
- 前端通过 `PlatformService` 接口抽象 Tauri/Web 差异
- 着色器使用 WGSL 格式，放在 `crates/we-render/src/shaders/`

## 测试

- TDD 工作流：先写测试 (RED) → 实现 (GREEN) → 重构 (REFACTOR)
- Rust 测试：`cargo test --workspace`
- 前端测试：`cd frontend && yarn test`
- 每个 Rust 模块底部 `#[cfg(test)] mod tests { }`
