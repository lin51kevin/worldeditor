# CLAUDE.md — AI Agent 工作指南

本文件为 AI 代码助手提供项目上下文和工作规范。

## 项目概述

WorldEditor Next 是自动驾驶道路网络编辑器，从 C#/.NET 重写为 Rust + TypeScript。
支持三个部署目标：Tauri 桌面、Web 浏览器 (WASM)、Headless CLI。

## 技术栈速查

| 组件 | 技术 | 版本 |
|------|------|------|
| 核心逻辑 | Rust | edition 2024 |
| 前端 | React + Zustand | 19 / 5 |
| 桌面壳 | Tauri | 2.x |
| 渲染 | wgpu | 24 |
| 构建 | Cargo + Vite | — |
| 包管理 | Yarn | 1.x |
| 测试 (Rust) | cargo test + cargo-llvm-cov | — |
| 测试 (TS) | Vitest | 3.x |
| E2E | Playwright | 计划中 |
| CI | GitHub Actions | — |
| 任务运行 | just | — |

## 工作区结构

```
worldeditor-next/
├── Cargo.toml          # Rust workspace root (7 members)
├── crates/
│   ├── we-core/        # 领域模型, GIS, OpenDRIVE (WASM 兼容)
│   ├── we-render/      # wgpu 渲染引擎 (camera, pipeline, shaders)
│   ├── we-io/          # 平台 I/O 抽象 (native/web 条件编译)
│   ├── we-service/     # 编辑器服务 (Command, Undo/Redo, AppState)
│   ├── we-native/      # 原生独占 (点云, GDAL — 仅桌面端)
│   └── we-wasm/        # WASM 入口点 (wasm-bindgen 导出)
├── frontend/           # React SPA (Vite + Vitest)
│   ├── src/components/ # UI 组件
│   ├── src/services/   # PlatformService 适配器
│   └── src/stores/     # Zustand 状态管理
├── src-tauri/          # Tauri 2.0 桌面应用
├── tests/              # 集成测试
├── justfile            # 开发命令 (just <cmd>)
└── .github/workflows/  # CI 流水线
```

## 关键构建命令

```bash
# 编译检查
cargo check --workspace              # Rust 全量检查
cd frontend && yarn typecheck         # TypeScript 类型检查

# 测试
cargo test --workspace                # Rust 测试 (38 tests)
cd frontend && yarn test              # 前端测试 (7 tests)

# 构建
cargo build --workspace               # Native 构建
cargo build --target wasm32-unknown-unknown -p we-wasm --release  # WASM 构建
wasm-bindgen target/wasm32-unknown-unknown/release/we_wasm.wasm --out-dir crates/we-wasm/pkg --target web

# 代码质量
cargo clippy --workspace -- -D warnings
cargo fmt --all -- --check
cargo audit

# just 命令 (推荐)
just check                            # 全量编译检查
just test                             # 全部测试
just lint                             # 全部检查
just build-all                        # 全量构建
```

## 架构规则

### Crate 分层

1. **we-core**: 纯领域逻辑，零平台依赖，必须 WASM 兼容
2. **we-render**: wgpu 渲染，WGSL 着色器，必须 WASM 兼容
3. **we-io**: 平台 I/O 抽象层，通过 `cfg(target_arch)` 条件编译
4. **we-service**: 编辑器业务逻辑，依赖 we-core + we-io
5. **we-native**: 仅桌面端功能（点云、GDAL），**禁止被 we-wasm 依赖**
6. **we-wasm**: WASM 入口，仅包含 wasm-bindgen 绑定

### 依赖方向 (严格单向)

```
we-core → we-io → we-service → we-wasm
  ↓         ↓
we-render  we-native (桌面独占)
```

**禁止**: we-core 依赖其他 crate, we-wasm 依赖 we-native

### WASM 兼容性

以下 crate 必须可编译到 `wasm32-unknown-unknown`：
- we-core, we-render, we-io, we-service, we-wasm

检查方法：
```bash
cargo build --target wasm32-unknown-unknown -p we-wasm --release
```

### 平台适配器模式 (前端)

前端通过 `PlatformService` 接口抽象平台差异：

```typescript
// services/platform.ts
interface PlatformService {
  openFile(): Promise<string | null>;
  saveFile(content: string): Promise<void>;
  parseOpenDrive(xml: string): Promise<Project>;
  writeOpenDrive(project: Project): Promise<string>;
}

// 运行时自动选择：
// - Tauri 桌面 → TauriPlatformService (IPC 调用)
// - Web 浏览器 → WebPlatformService (WASM 直调)
```

## 编码规范

### Rust

- **不可变优先**: 优先使用不可变引用和值语义
- **错误处理**: 使用 `thiserror` 定义错误类型，`Result<T, E>` 传播
- **命名**: snake_case (函数/变量), PascalCase (类型/trait)
- **文档**: 公开 API 必须有 `///` 文档注释
- **unsafe**: 禁止，除非有充分理由并附带 `// SAFETY:` 注释
- **日志**: 使用 `log` crate (`info!`, `warn!`, `error!`)
- **序列化**: 所有领域模型 derive `Serialize, Deserialize`
- **测试**: 每个模块底部 `#[cfg(test)] mod tests`

### TypeScript

- **状态管理**: 仅通过 Zustand store 管理全局状态
- **不可变更新**: 使用展开运算符 `{ ...state, field: newValue }`
- **类型安全**: 严格模式，禁止 `any`
- **导入**: 使用绝对路径或 `@/` 别名
- **测试**: Vitest + @testing-library/react

### WGSL 着色器

- 着色器文件放在 `crates/we-render/src/shaders/*.wgsl`
- 通过 `include_str!()` 在编译时嵌入
- 入口函数命名: `vs_main` (顶点), `fs_main` (片段)
- Uniform 绑定: `@group(0) @binding(0)`

## 测试规范

### TDD 工作流 (强制)

1. **RED**: 先写测试，运行确认失败
2. **GREEN**: 写最小实现使测试通过
3. **REFACTOR**: 重构代码，确保测试仍通过

### 覆盖率目标

| 层 | 目标 |
|----|------|
| Rust (we-core, we-service) | ≥ 90% |
| Rust (we-render, we-io) | ≥ 80% |
| TypeScript (stores, services) | ≥ 80% |
| E2E | 关键用户路径覆盖 |

### 测试命名规范

```rust
#[test]
fn test_<功能>_<场景>_<期望结果>() { }
// 例: test_parse_xodr_empty_header_returns_default_project()
```

```typescript
it('should <期望行为> when <条件>', () => { });
// 例: it('should set isDirty when project is modified', () => { });
```

## Git 工作流

### 分支策略

- `main`: 稳定发布分支
- `develop`: 开发集成分支
- `feature/*`: 功能分支 (从 develop 创建)
- `fix/*`: 修复分支

### Commit 格式

```
<type>: <description>

<optional body>
```

类型: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`

### PR 检查清单

- [ ] 所有测试通过 (`just test`)
- [ ] 无 clippy 警告 (`just lint-rust`)
- [ ] 代码格式化 (`just fmt`)
- [ ] 安全审计通过 (`just audit`)
- [ ] WASM 目标编译通过
- [ ] 覆盖率不低于阈值

## 常见任务指南

### 添加新的领域模型

1. 在 `crates/we-core/src/model/` 添加类型定义
2. Derive `Serialize, Deserialize, Debug, Clone`
3. 编写单元测试
4. 如需 IPC 暴露：在 `src-tauri/src/commands.rs` 添加命令
5. 如需 WASM 暴露：在 `crates/we-wasm/src/lib.rs` 添加导出

### 添加新的渲染管线

1. 在 `crates/we-render/src/shaders/` 添加 WGSL 着色器
2. 在 `pipeline.rs` 创建管线
3. 在 `renderer.rs` 集成到渲染循环
4. 确保 WASM 编译通过

### 添加新的前端组件

1. 在 `frontend/src/components/` 创建组件
2. 使用 Zustand store 管理状态
3. 通过 `PlatformService` 调用后端
4. 编写 Vitest 测试

### 添加新的 Tauri 命令

1. 在 `src-tauri/src/commands.rs` 添加 `#[tauri::command]` 函数
2. 在 `src-tauri/src/lib.rs` 的 `invoke_handler` 中注册
3. 如需文件/对话框权限：更新 `src-tauri/capabilities/default.json`
4. 在 `frontend/src/services/tauri.ts` 添加对应调用
5. 编写测试

## 已知限制 (Phase 0)

- OpenDRIVE 解析为 stub 实现（仅框架）
- 点云加载未实现（we-native 占位）
- GDAL/LAS 依赖暂未启用
- E2E 测试框架未搭建
- Web 端 WASM 集成未完成端到端验证

## 参考资料

- [OpenDRIVE 1.6 规范](https://www.asam.net/standards/detail/opendrive/)
- [wgpu 文档](https://docs.rs/wgpu/latest/wgpu/)
- [Tauri 2.0 文档](https://v2.tauri.app/)
- [wasm-bindgen 指南](https://rustwasm.github.io/wasm-bindgen/)
