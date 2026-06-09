# WorldEditor Next — Copilot Instructions

## 项目上下文

这是一个 Rust + TypeScript 的自动驾驶道路网络编辑器，采用 Tauri 2.0 桌面端 + WASM Web 端双端架构。
当前版本 **0.3.0**，处于 **Phase 2**（点云可视化、3D 模型导入、协作编辑）。

## 工作区概览 (9 crates)

```
we-core         — 领域模型 + GIS + OpenDRIVE + 拾取/捕捉/路径 (18 模块, WASM 兼容)
we-plugin-core  — 插件系统框架 (manifest, registry, lifecycle)
we-render       — wgpu 渲染引擎 (camera, gizmo, pipeline, shaders, 14 模块)
we-io           — 平台 I/O 抽象 + 多格式导入导出 (CSV, MIF, OBJ, NIO...)
we-service      — 编辑器服务 (Command trait, Undo/Redo, 8 类命令)
we-native       — 原生独占 (点云, GDAL — 仅桌面端, Phase 3 预留)
we-wasm         — WASM 入口 (9 模块, wasm-bindgen 导出)
we-server       — REST API 服务器 (Axum + JWT + PostgreSQL + WebSocket)
src-tauri       — Tauri 2.0 桌面应用壳
```

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
- 状态管理仅用 Zustand 5，采用 **slices 架构** (`stores/slices/`)
- 严格类型，禁止 `any`
- 不可变更新：`{ ...state, field: newValue }`
- 内置插件放在 `frontend/src/plugins/`，外部插件放在 `plugins/`
- 视口控制器拆分在 `frontend/src/viewport/` (camera, gizmo, tangent, spline)

## 架构约束

- `we-core` 是纯领域逻辑，零平台依赖，必须 WASM 兼容
- `we-plugin-core` 依赖 we-core，必须 WASM 兼容
- `we-native` 仅桌面端，**禁止**被 `we-wasm` 依赖
- `we-server` 独立部署，**禁止**被客户端 crate 依赖
- 前端通过 `PlatformService` 接口抽象 Tauri/Web 差异
- 着色器使用 WGSL 格式，放在 `crates/we-render/src/shaders/`
- 前端视口内嵌着色器在 `frontend/src/viewport/viewportShaders.ts`

## 测试

- TDD 工作流：先写测试 (RED) → 实现 (GREEN) → 重构 (REFACTOR)
- Rust 测试：`cargo test --workspace`
- 前端测试：`cd frontend && yarn test`
- E2E 测试：`cd frontend && yarn playwright test` (17 spec files)
- 视觉回归：`just test-visual` / `just update-snapshots`
- 每个 Rust 模块底部 `#[cfg(test)] mod tests { }`
- 覆盖率目标：Rust core/service ≥ 90%，render/io ≥ 80%，TypeScript ≥ 80%
