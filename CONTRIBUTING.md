# 贡献指南

感谢你对 WorldEditor Next 项目的关注！本文档说明如何参与贡献。

## 开发环境设置

### 必需工具

```bash
# Rust 工具链
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown

# 开发工具
cargo install just           # 任务运行器
cargo install wasm-pack      # WASM 构建
cargo install cargo-llvm-cov # 覆盖率
cargo install cargo-audit    # 安全审计

# Node.js (推荐 v22+)
corepack enable              # 启用 yarn
```

### 首次构建

```bash
git clone https://github.com/lin51kevin/worldeditor.git
cd worldeditor-next
cd frontend && yarn install && cd ..
just build-all
just test
```

## 开发流程

### 1. 创建分支

```bash
git checkout develop
git pull origin develop
git checkout -b feature/my-feature
```

### 2. 开发 (TDD)

本项目强制 TDD 工作流：

```bash
# 1. 写测试 (RED)
# 2. 运行测试 — 确认失败
just test-rust    # 或 just test-frontend

# 3. 实现代码 (GREEN)
# 4. 运行测试 — 确认通过

# 5. 重构 (REFACTOR)
# 6. 确认测试仍通过
```

### 3. 提交前检查

```bash
just check        # 编译检查
just test         # 全部测试
just lint         # clippy + eslint
just fmt          # 格式化
just audit        # 安全检查
```

### 4. 提交

```bash
git add -A
git commit -m "feat: add road elevation editing"
```

Commit message 格式: `<type>: <description>`

| 类型 | 说明 |
|------|------|
| feat | 新功能 |
| fix | 修复 Bug |
| refactor | 重构 (无功能变化) |
| docs | 文档更新 |
| test | 测试相关 |
| chore | 构建/工具/依赖变更 |
| perf | 性能优化 |
| ci | CI/CD 配置 |

### 5. 创建 PR

- 目标分支: `develop`
- 标题使用 commit 格式
- 描述变更内容和测试方法
- 确保 CI 全绿

## 代码规范

### Rust

- `cargo fmt --all` 格式化
- `cargo clippy -- -D warnings` 零警告
- 公开 API 添加文档注释 (`///`)
- 使用 `thiserror` 定义错误类型
- 禁止 `unwrap()` (测试代码除外)
- 禁止 `unsafe` (除非有 `// SAFETY:` 注释)

### TypeScript

- 严格类型，禁止 `any`
- 函数式组件 + Hooks
- 使用 Zustand 管理状态
- 测试使用 `@testing-library/react`

### 文件组织

- 单个文件不超过 400 行 (硬限 800 行)
- 按功能/领域组织，不按类型组织
- 高内聚，低耦合

## WASM 兼容性

修改以下 crate 时，必须验证 WASM 编译：

- `we-core`, `we-render`, `we-io`, `we-service`, `we-wasm`

```bash
cargo build --target wasm32-unknown-unknown -p we-wasm --release
```

**注意**: `we-native` 不需要 WASM 兼容，但也不允许被 WASM crate 依赖。

## 测试要求

| 变更类型 | 需要的测试 |
|---------|-----------|
| 新功能 | 单元测试 + 集成测试 |
| Bug 修复 | 回归测试 (证明 Bug 已修复) |
| 重构 | 原有测试覆盖 (不应新增) |
| 渲染变更 | 视觉回归测试 (截图对比) |

## 问题反馈

- 使用 GitHub Issues 报告问题
- 附带复现步骤和环境信息
- 标注相关 crate/模块

## 许可证

提交代码即表示同意将代码以 MIT 许可证开源。
