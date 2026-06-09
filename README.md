# WorldEditor

> 下一代自动驾驶道路网络编辑器 — 基于 Rust + TypeScript + Tauri 2.0 重构，支持桌面与 Web 双端部署。

[![CI](https://github.com/lin51kevin/worldeditor/actions/workflows/ci.yml/badge.svg)](https://github.com/lin51kevin/worldeditor/actions/workflows/ci.yml)

## 概述

WorldEditor 是 [WorldEditor](../WorldEditor) 的全新重写版本，从 C#/.NET 迁移到 Rust + TypeScript 技术栈。主要用于编辑和可视化自动驾驶场景中的道路网络数据（OpenDRIVE 格式）、点云、3D 模型等地理空间信息。

### 为什么重写？

| 维度 | 旧版 (C#/.NET 4.6) | 新版 (Rust + TS) |
|------|-------------------|------------------|
| 平台 | Windows 桌面 | 桌面 + Web + CLI |
| 渲染 | OpenGL 3.0 / DirectX 11 | wgpu (Vulkan/Metal/DX12/WebGPU) |
| 性能 | GC 暂停, 单线程渲染 | 零开销抽象, 多线程 |
| 可扩展 | 仅 DLL 插件 | Web API + WASM 模块 |
| 协作 | 单机 | Web 端实时协作就绪 |

## 技术栈

- **核心逻辑**: Rust (edition 2024)
- **前端**: React 19 + Zustand 5 + Vite 6
- **桌面壳**: Tauri 2.0
- **渲染引擎**: wgpu 24 (WGSL 着色器)
- **WASM**: wasm-bindgen (Web 端复用 Rust 核心)
- **包管理**: Cargo (Rust) + Yarn (JS)
- **CI/CD**: GitHub Actions (多平台)

## 项目结构

```
worldeditor/
├── crates/
│   ├── we-core/           # 核心领域模型 (18 模块, WASM 兼容)
│   │   ├── model/         #   领域对象 (Project, Road, Lane, Junction, Signal...)
│   │   ├── geometry/      #   计算几何 (凸包, Delaunay, 曲线求值)
│   │   ├── gis/           #   坐标系 (WGS84, GCJ-02, UTM, ECEF, ENU, MGRS)
│   │   ├── opendrive/     #   OpenDRIVE 1.4-1.6 解析/写入
│   │   ├── picking/       #   射线拾取 / 选择
│   │   ├── snapping/      #   磁吸捕捉
│   │   ├── spatial_index/ #   空间索引加速
│   │   ├── spline/        #   B-spline / Catmull-Rom 曲线
│   │   └── ...            #   elevation, routing, measurement, lane_ops 等
│   ├── we-plugin-core/    # 插件系统框架 (manifest, registry, lifecycle)
│   ├── we-render/         # wgpu 渲染引擎 (14 模块)
│   │   ├── camera/        #   相机系统 (透视/正交, 轨道控制)
│   │   ├── gizmo/         #   3D 变换手柄 (平移/旋转/缩放)
│   │   ├── pipeline/      #   渲染管线 (grid, basic, lane_line, object)
│   │   ├── road_mesh/     #   道路网格生成
│   │   └── shaders/       #   WGSL 着色器
│   ├── we-io/             # 平台 I/O + 多格式导入导出
│   ├── we-service/        # 编辑器服务 (Command, Undo/Redo, 8 类命令)
│   ├── we-native/         # 原生独占 (点云, GDAL — Phase 3)
│   ├── we-wasm/           # WASM 入口 (9 模块, wasm-bindgen 导出)
│   └── we-server/         # REST API (Axum + JWT + PostgreSQL)
├── frontend/              # React SPA
│   ├── src/
│   │   ├── components/    #   UI 组件 (shell, panels, dialogs, common)
│   │   ├── plugins/       #   内置插件 (24+: I/O, 编辑, 分析, GIS)
│   │   ├── viewport/      #   渲染控制器 (camera, gizmo, tangent, spline)
│   │   ├── stores/        #   Zustand 状态 (slices 架构)
│   │   └── services/      #   PlatformService 适配器
│   └── e2e/               #   Playwright E2E 测试 (17 spec files)
├── plugins/               # 外部插件目录
├── src-tauri/             # Tauri 2.0 桌面应用
├── tests/                 # 集成 / 性能 / 视觉测试
├── docs/                  # 用户手册, 审计报告, 规划
├── .github/workflows/     # CI 流水线
├── Cargo.toml             # Rust workspace (9 crates)
└── justfile               # 开发命令合集
```

## 架构设计

### Web-Ready 双端架构

```
┌──────────────────────────────────────────────┐
│              Frontend (React + Zustand)       │
│  ┌──────────┬──────────┬──────────┬────────┐ │
│  │ Toolbar  │ Viewport │ LayerPanel│Property│ │
│  └────┬─────┴────┬─────┴─────┬────┴───┬────┘ │
│       │          │           │        │       │
│       └──────────┴─────┬─────┴────────┘       │
│                        │                       │
│              PlatformService (接口)             │
│             ╱                    ╲              │
│   TauriPlatformService    WebPlatformService   │
│        (IPC 调用)          (WASM 直调)          │
└──────────┬───────────────────────┬─────────────┘
           │                       │
    ┌──────┴──────┐         ┌──────┴──────┐
    │   Tauri 2   │         │   WASM      │
    │  (Desktop)  │         │  (Browser)  │
    └──────┬──────┘         └──────┬──────┘
           │                       │
    ┌──────┴───────────────────────┴──────┐
    │         Rust Core Crates            │
    │  we-core │ we-render │ we-service   │
    │  we-io   │ we-native*              │
    └─────────────────────────────────────┘
                * we-native 仅桌面端
```

### Crate 依赖图

```
we-core ──→ we-io ──→ we-service ──→ we-wasm
  │            │
  ├──→ we-render
  │            ↓
  │        we-native (桌面独占)
  │
  ├──→ we-plugin-core
  │
  └──→ we-server (独立部署)
```

- **we-core**: 零平台依赖, WASM 兼容
- **we-native**: 仅桌面端, 禁止被 we-wasm 依赖
- **we-server**: 独立部署, 禁止被客户端 crate 依赖

## 快速开始

### 前置依赖

- [Rust](https://rustup.rs/) (stable, edition 2024)
- [Node.js](https://nodejs.org/) 22+
- [Yarn](https://yarnpkg.com/) (通过 corepack 启用)
- [just](https://github.com/casey/just) (任务运行器):
  - `cargo install just`，或
  - Windows: `winget install casey.just` 或 `scoop install just`
  - macOS/Linux: `brew install just`
- [wasm-pack](https://rustwasm.github.io/wasm-pack/): `cargo install wasm-pack`

### 构建与运行

```bash
# 克隆仓库
git clone https://github.com/lin51kevin/worldeditor.git
cd worldeditor-next

# 安装前端依赖
cd frontend && yarn install && cd ..

# 构建全部
just build-all

# 运行开发模式 (Tauri 桌面)
just dev-tauri

# 或仅运行前端 (Web 模式)
just dev-frontend
```

### 常用命令

```bash
just                    # 列出所有命令
just check              # 编译检查 (Rust + TS)
just test               # 运行全部测试
just test-rust          # 仅 Rust 测试
just test-frontend      # 仅前端测试
just lint               # 代码检查 (clippy + eslint)
just fmt                # 格式化 Rust 代码
just build-wasm         # 编译 WASM 包
just audit              # 安全依赖审计
just clean              # 清理构建产物
```

## 打包发布（制作安装包）

### 前置步骤（仅需安装一次）

```bash
# 安装 Tauri CLI
cargo install tauri-cli
```

### 打包命令

```bash
# 为当前平台打包（自动构建前端 + Rust，输出安装包）
just bundle

# 或直接使用 Tauri CLI
cargo tauri build

# 为指定目标平台交叉编译
just bundle-target x86_64-pc-windows-msvc   # Windows
just bundle-target aarch64-apple-darwin      # macOS (Apple Silicon)
just bundle-target x86_64-unknown-linux-gnu  # Linux
```

> `cargo tauri build` 会自动执行前端构建（`yarn build`），无需单独运行。

### 输出产物

打包完成后，安装包位于 `src-tauri/target/<target>/release/bundle/`：

| 平台 | 安装包格式 | 路径 |
|------|-----------|------|
| Windows | `.exe` (NSIS) / `.msi` (WiX) | `bundle/nsis/` / `bundle/msi/` |
| macOS | `.dmg` / `.app` | `bundle/dmg/` / `bundle/macos/` |
| Linux | `.deb` / `.AppImage` / `.rpm` | `bundle/deb/` / `bundle/appimage/` / `bundle/rpm/` |

### Linux 额外系统依赖

在 Ubuntu/Debian 上打包前需安装：

```bash
sudo apt install -y \
  libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev \
  pkg-config libdbus-1-dev \
  libxcb1-dev libxcb-shm0-dev libxcb-xfixes0-dev \
  libxcb-render0-dev libxkbcommon-dev libxkbcommon-x11-dev
```

### CI 自动发布

推送 `v*` 格式的 git tag 会触发 GitHub Actions 自动为三平台构建并上传 Release：

```bash
git tag v0.3.0 && git push origin v0.3.0
```

详见 [`.github/workflows/release.yml`](.github/workflows/release.yml)。

## 测试

项目采用 TDD 工作流，所有代码变更必须附带测试。

| 测试类型 | 工具 | 命令 | 覆盖率目标 |
|---------|------|------|-----------|
| Rust 单元测试 | cargo test | `just test-rust` | ≥ 90% (core/service) |
| Rust 覆盖率 | cargo-llvm-cov | `just test-rust-cov` | — |
| WASM 测试 | wasm-pack test | `just test-wasm` | — |
| 前端单元测试 | Vitest | `just test-frontend` | ≥ 80% |
| 前端覆盖率 | Vitest + v8 | `just test-frontend-cov` | — |
| E2E 测试 | Playwright | `just test-e2e` | 17 spec files |
| 视觉回归 | Playwright | `just test-visual` | 截图比对 |

## 部署目标

| 目标 | 状态 | 说明 |
|------|------|------|
| 🖥️ Windows 桌面 | ✅ 可用 | Tauri 2.0 + wgpu |
| 🖥️ macOS 桌面 | ✅ CI 通过 | 同上 |
| 🐧 Linux 桌面 | ✅ CI 通过 | 同上 |
| 🌐 Web 浏览器 | 🔧 进行中 | WASM + WebGPU |
| 🖧 REST API | 🔧 基础就绪 | Axum + JWT + PostgreSQL |

## 从旧版迁移

WorldEditor 将逐步替代 `WorldEditor` (C# 版本)。迁移路径：

1. **Phase 0** (已完成): 项目脚手架、核心领域模型、wgpu 渲染原型
2. **Phase 1** (已完成 — v0.2.0): OpenDRIVE 完整解析、道路/车道/高程编辑、交叉口模板引擎、桥隧管理、插件系统、E2E 测试、REST API、性能优化
3. **Phase 2** (当前 — v0.3.0): 点云可视化、3D 模型导入、协作编辑
4. **Phase 3**: SUMO 仿真集成、DXF/Shapefile 导入、高级 GIS

## 许可证

MIT License — 详见 [LICENSE](LICENSE)
