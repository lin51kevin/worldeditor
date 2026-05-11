# WorldEditor Next

> 下一代自动驾驶道路网络编辑器 — 基于 Rust + TypeScript + Tauri 2.0 重构，支持桌面与 Web 双端部署。

[![CI](https://github.com/lin51kevin/worldeditor/actions/workflows/ci.yml/badge.svg)](https://github.com/lin51kevin/worldeditor/actions/workflows/ci.yml)

## 概述

WorldEditor Next 是 [WorldEditor](../WorldEditor) 的全新重写版本，从 C#/.NET 迁移到 Rust + TypeScript 技术栈。主要用于编辑和可视化自动驾驶场景中的道路网络数据（OpenDRIVE 格式）、点云、3D 模型等地理空间信息。

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
worldeditor-next/
├── crates/
│   ├── we-core/        # 核心领域模型 (WASM 兼容)
│   │   ├── gis/        #   GIS 坐标系 (WGS84, ENU, ECEF)
│   │   ├── geometry/   #   几何算法 (点在多边形内, 面积等)
│   │   ├── math/       #   数学工具 (向量, 矩阵, 插值)
│   │   ├── model/      #   领域对象 (Project, Road, Lane, Junction)
│   │   └── opendrive/  #   OpenDRIVE 标准读写
│   ├── we-render/      # wgpu 渲染引擎
│   │   ├── camera/     #   相机系统 (透视/正交, 轨道控制)
│   │   ├── gpu/        #   GPU 上下文管理
│   │   ├── pipeline/   #   渲染管线 (Basic + Grid)
│   │   ├── renderer/   #   帧渲染调度
│   │   ├── vertex/     #   顶点格式定义
│   │   └── shaders/    #   WGSL 着色器
│   ├── we-io/          # 平台抽象 I/O
│   │   ├── native/     #   原生文件系统 (tokio)
│   │   └── web/        #   Web 存储 (localStorage)
│   ├── we-service/     # 编辑器业务逻辑
│   │   └── editor/     #   Command 模式, Undo/Redo
│   ├── we-native/      # 原生独占功能 (GDAL, 点云)
│   └── we-wasm/        # WASM 入口 (wasm-bindgen)
├── frontend/           # React 前端
│   ├── src/
│   │   ├── components/ #   UI 组件 (Toolbar, Viewport, LayerPanel...)
│   │   ├── services/   #   平台适配器 (Tauri / Web)
│   │   └── stores/     #   Zustand 状态管理
│   └── package.json
├── src-tauri/          # Tauri 2.0 桌面应用
│   ├── src/
│   │   ├── lib.rs      #   插件注册 + IPC 路由
│   │   └── commands.rs #   Tauri 命令处理
│   └── tauri.conf.json
├── tests/              # 集成/E2E 测试
├── .github/workflows/  # CI 流水线
├── Cargo.toml          # Rust workspace 配置
└── justfile            # 开发命令合集
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
we-core ─────────────────────────────────┐
   │                                      │
   ├──> we-io (平台 I/O)                  │
   │       │                              │
   ├──> we-render (渲染引擎)              │
   │                                      │
   ├──> we-service (编辑器逻辑) ◄── we-io │
   │                                      │
   ├──> we-native (原生功能) ◄── we-io    │
   │                                      │
   └──> we-wasm (WASM 入口) ◄── we-service
```

## 快速开始

### 前置依赖

- [Rust](https://rustup.rs/) (stable, edition 2024)
- [Node.js](https://nodejs.org/) 22+
- [Yarn](https://yarnpkg.com/) (通过 corepack 启用)
- [just](https://github.com/casey/just) (任务运行器): `cargo install just`
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

## 测试

项目采用 TDD 工作流，所有代码变更必须附带测试。

| 测试类型 | 工具 | 命令 | 覆盖率目标 |
|---------|------|------|-----------|
| Rust 单元测试 | cargo test | `just test-rust` | ≥ 90% |
| Rust 覆盖率 | cargo-llvm-cov | `just test-rust-cov` | — |
| WASM 测试 | wasm-pack test | `just test-wasm` | — |
| 前端单元测试 | Vitest | `just test-frontend` | ≥ 80% |
| 前端覆盖率 | Vitest + v8 | `just test-frontend-cov` | — |
| E2E 测试 | Playwright | *(计划中)* | 关键路径 |

当前测试统计：**38 Rust + 7 Frontend = 45 tests green**

## 部署目标

| 目标 | 状态 | 说明 |
|------|------|------|
| 🖥️ Windows 桌面 | ✅ Phase 0 | Tauri 2.0 + wgpu |
| 🖥️ macOS 桌面 | ✅ CI 通过 | 同上 |
| 🐧 Linux 桌面 | ✅ CI 通过 | 同上 |
| 🌐 Web 浏览器 | 🔧 Phase 1 | WASM + WebGPU |
| 🤖 Headless CLI | 📋 计划中 | 批处理渲染 |

## 从旧版迁移

WorldEditor Next 将逐步替代 `WorldEditor` (C# 版本)。迁移路径：

1. **Phase 0** (当前): 项目脚手架、核心领域模型、wgpu 渲染原型
2. **Phase 1**: OpenDRIVE 完整解析、基础道路编辑、Web 端原型
3. **Phase 2**: 点云可视化、3D 模型导入、高级编辑工具
4. **Phase 3**: SUMO 仿真集成、插件系统、协作功能

## 许可证

MIT License — 详见 [LICENSE](LICENSE)
