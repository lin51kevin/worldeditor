# CLAUDE.md — AI Agent 工作指南

本文件为 AI 代码助手提供项目上下文和工作规范。

## 项目概述

- 以下列表不包含 2026-05-14 ~ 2026-05-15 已修复的 crosswalk / parking space / `objectReference` 问题。

- 点云加载未实现（we-native 占位，Phase 4 预留）
- GDAL/LAS 依赖尚未启用（栅格/异型 CRS 保留为桌面扩展；常见投影 UTM/TM/Web Mercator 已由 we-core 纯 Rust 引擎实现）
- DXF / Shapefile 导入导出已实现；SUMO net.xml 导入导出已实现（`sumo` feature）

## 技术栈速查

| 组件 | 技术 | 版本 |
- 实例化渲染尚未补齐，dense scene 性能仍需继续提升
- 前端 Visual Regression 还未纳入 CI 门禁
- 大项目下的拾取/吸附缓存路径仍需持续回归验证
- 网格生成为全量重建，增量更新待做
| 前端 | React + Zustand | 19 / 5 |
| 桌面壳 | Tauri | 2.x |
| 渲染 | wgpu + WebGPU | 24 |
| 后端 API | Axum + sqlx | — |
| 数据库 | PostgreSQL | — |
| 认证 | JWT (jsonwebtoken) | — |
| 插件系统 | we-plugin-core | — |
| 构建 | Cargo + Vite | — |
| 包管理 | Yarn | 1.x |
| 测试 (Rust) | cargo test + cargo-llvm-cov | — |
| 测试 (TS) | Vitest | 3.x |
| E2E | Playwright | 1.x |
| CI | GitHub Actions | — |
| 任务运行 | just | — |

## 工作区结构

```
worldeditor/
├── Cargo.toml              # Rust workspace root (9 members)
├── crates/
│   ├── we-core/            # 领域模型, GIS, OpenDRIVE, 拾取, 路径, 捕捉 (18 模块, WASM 兼容)
│   ├── we-plugin-core/     # 插件系统框架 (manifest, registry, lifecycle)
│   ├── we-render/          # wgpu 渲染引擎 (camera, gizmo, pipeline, shaders)
│   ├── we-io/              # 平台 I/O 抽象 + 多格式导入导出
│   ├── we-service/         # 编辑器服务 (Command, Undo/Redo, 8 类命令)
│   ├── we-native/          # 原生独占 (点云, GDAL — 仅桌面端)
│   ├── we-wasm/            # WASM 入口点 (9 模块, wasm-bindgen 导出)
│   └── we-server/          # REST API 服务器 (Axum + JWT + PostgreSQL + WebSocket)
├── frontend/               # React SPA (Vite + Vitest)
│   ├── src/components/     # UI 组件 (shell/, panels/, dialogs/, common/)
│   ├── src/plugins/        # 前端插件 (24+ 内置插件: I/O, 编辑, 分析, GIS)
│   ├── src/services/       # PlatformService 适配器 (Tauri/Web)
│   ├── src/stores/         # Zustand 状态管理 (slices 架构)
│   ├── src/viewport/       # 渲染控制器 (camera, gizmo, tangent, pipeline, spline)
│   └── src/hooks/          # React Hooks
│   ├── e2e/                # Playwright E2E 测试 (17 spec files)
├── plugins/                # 外部插件目录 (manifest.json 发现)
├── src-tauri/              # Tauri 2.0 桌面应用
├── tests/                  # 集成 / 性能 / 视觉测试
├── docs/                   # 用户手册, 性能分析, 代码审计, 重构建议, 规划
├── justfile                # 开发命令 (just <cmd>)
└── .github/workflows/      # CI 流水线
```

## Crate 详细结构

### we-core (18 模块 — 纯领域逻辑, WASM 兼容)

```
elevation        — 高程剖面编辑 (增/删/移动高程点, 平滑, 坡度计算)
geometry         — 计算几何 (凸包, Delaunay 三角化, 点在多边形, 折线简化, 曲线求值)
gis              — 坐标变换 (WGS84, GCJ-02, ECEF, ENU, UTM, MGRS, Proj4, WKT, GCP)
junction_area    — 交叉口多边形操作
junction_polygon — 交叉口多边形生成
lane_ops         — 车道级操作 (分裂, 合并, 类型变更)
lanelet2         — Lanelet2 格式支持
math             — 数学工具 (nalgebra 类型别名, lerp, clamp)
measurement      — 测量工具 (距离, 面积, 角度)
model            — 领域模型 (Project, Road, Lane, Junction, Signal, RoadObject, Zone, CRG)
opendrive        — OpenDRIVE 1.4-1.6 解析器 / 写入器
osm_export       — OpenStreetMap 导出
picking          — 射线拾取 / 选择
road_ops         — 道路级操作 (分割, 连接, 反转)
routing          — 路径搜索算法
snapping         — 磁吸捕捉 (道路, 交叉口, 网格)
spatial_index    — 空间索引加速结构
spline           — B-spline / Catmull-Rom 曲线拟合与求值
```

### we-render (14 模块 — wgpu 渲染引擎)

```
bridge_tunnel_render — 桥梁 / 隧道网格生成
camera               — 3D 相机 (透视/正交, 轨道/缩放)
endpoint_render      — 道路端点标记 (悬空/已连接检测)
gizmo                — 3D 变换手柄 (平移/旋转/缩放, XYZ 轴)
gpu                  — GPU 上下文 (device, queue, 多重采样)
junction_render      — 交叉口网格 (扇形三角化)
mark_render          — 道路标线 (实线, 虚线, 斑马线)
object_render        — 道路物体 (护栏, 标牌, 锥桶)
pipeline             — 渲染管线 (grid, basic, lane_line, object)
render_config        — 可配置渲染参数 (颜色, alpha, z 偏移)
renderer             — 主渲染器 (深度纹理, uniform 缓冲, 帧循环)
road_mesh            — 道路网格生成 (车道颜色, 高程, 宽度)
signal_render        — 交通信号渲染 (billboard)
vertex               — 顶点格式 (ColorVertex, LineVertex)
```

### we-service (Command 模式 — 8 类编辑命令)

```
commands/batch     — 批量操作命令
commands/elevation — 高程编辑命令
commands/junction  — 交叉口命令
commands/lane      — 车道操作命令
commands/road      — 道路 CRUD (AddRoad, DeleteRoad, UpdateRoad)
commands/road_ops  — 道路操作命令 (分割, 连接, 反转)
commands/signal    — 信号命令
commands/spline    — 样条拟合命令
editor             — ActionHistory (undo/redo 双栈) + Command trait
```

### we-wasm (9 模块 — JavaScript 桥接)

```
elevation   — 高程操作导出
gis         — GIS 坐标变换导出
gis_ext     — 扩展 GIS 工具
measure     — 测量操作导出
opendrive   — OpenDRIVE 解析/写入桥接
picking     — 3D 拾取操作导出
render      — 渲染操作导出
spline      — 样条操作导出
validation  — 项目校验导出
```

### we-io (多格式 I/O)

```
csv_io       — CSV 导入/导出
dxf_io       — DXF CAD 格式 (Phase 3 预留)
mif_io       — MapInfo MIF 格式
nio_proto    — NIO 协议缓冲格式
obj_export   — OBJ 3D 格式导出
shapefile_io — Shapefile 格式 (Phase 3 预留)
signal_json  — 信号配置 JSON
sumo         — SUMO 交通模拟器 net.xml 导入/导出 (feature = "sumo")
traits       — FileSystem trait (平台无关 I/O 抽象)
native       — 原生文件系统 (tokio, 仅 native 目标)
web          — Web 存储 (IndexedDB/localStorage, 仅 wasm32 目标)
```

### we-plugin-core (插件系统)

```
context   — 插件 API 上下文 (Command, MenuItem, RenderPlugin, ImporterContrib, ExporterContrib)
error     — PluginError / PluginResult
manifest  — PluginManifest (JSON, semver 校验)
plugin    — EditorPlugin trait (生命周期接口)
registry  — PluginRegistry (发现, 加载, 卸载, 依赖解析)
```

### we-server (REST API 服务器)

```
api/project — 项目 CRUD (create, read, update, delete, list)
api/files   — 文件上传/下载
auth/jwt    — JWT 认证中间件 + 令牌生成/验证 (24h 过期)
storage     — 存储后端抽象 (LocalStorage / S3 预留)
ws/editor   — WebSocket 协作编辑 (占位)
error       — 统一错误类型
```

### we-native (仅桌面端)

```
pointcloud — 点云处理 (LAS/PCD 加载, 内存映射 — Phase 3 预留)
```

## 前端架构

### 状态管理 (Zustand Slices)

EditorStore 采用 **切片架构** 拆分：

```
stores/editorStore.ts            — 组合入口 (合并所有切片)
stores/slices/projectSlice.ts    — 项目状态 (project, isDirty, setProject, reset)
stores/slices/selectionSlice.ts  — 选择状态 (selectedRoadId, selectedSceneNode, cursorWorldPos)
stores/slices/undoRedoSlice.ts   — 撤销/重做 (undoStack, redoStack, pushUndo, undo, redo)
stores/slices/roadSlice.ts       — 道路操作 (addRoad, removeRoad, updateRoad)
stores/slices/laneSlice.ts       — 车道操作 (updateLaneType, updateLaneWidth)
stores/slices/types.ts           — 切片类型定义
stores/editorViewStore.ts        — 视图状态 (dimension, editMode, viewMode, showGrid, 面板布局)
stores/pluginContribStore.ts     — 插件贡献注册 (菜单项, 命令, 导入/导出器)
stores/builtinPluginStore.ts     — 内置插件管理
stores/themeStore.ts             — 主题 (light/dark)
stores/dialogStore.ts            — 对话框状态
stores/recentFilesStore.ts       — 最近打开文件
```

### 视口控制器

```
viewport/renderer.ts                 — WebGPU 主渲染器 (管线, 帧循环)
viewport/cameraController.ts         — 相机交互 (轨道, 平移, 缩放)
viewport/gizmoController.ts          — 3D 变换手柄控制器
viewport/tangentHandleController.ts  — 样条切线编辑控制器
viewport/markerRenderer.ts           — 控制点标记渲染
viewport/pipelineFactory.ts          — 管线创建工厂
viewport/splineVertexBuilder.ts      — 样条顶点构建
viewport/splineUtils.ts              — 样条工具函数
viewport/viewportEvents.ts           — 事件总线 (zoom-to-fit, zoom-to-selected 等)
viewport/viewportMath.ts             — 视口数学 (屏幕↔世界坐标)
viewport/viewportShaders.ts          — 内嵌 WGSL 着色器
viewport/viewportTypes.ts            — 类型定义
viewport/cursorEvents.ts             — 光标事件处理
```

### 内置插件 (24+)

**I/O 格式 (12)**:
- ioGeoZ, ioCsv, ioDxf, ioShapefile, ioOsm, ioLanelet2, ioNio, ioMif, ioObj3d, ioSignals, ioXodrExt, converter

**编辑工具 (4)**:
- advancedEditing (软选择, 约束移动, 切线手柄), roadTools, templates, scripting

**分析 (4)**:
- validation, laneDetect, traffic, ecosystem

**GIS / 可视化 (4)**:
- gisTools, pointcloud, satellite, models3d

### 组件结构

```
components/shell/         — 主布局 (MenuBar, StatusBar)
components/panels/        — 面板 (LayerPanel, PropertyPanel, OutputPanel, MeasurementPanel, ToolPanel...)
components/dialogs/       — 对话框
components/common/        — 通用 (FloatingPanel, Splitter)
components/Viewport.tsx   — 画布组件
components/CommandPalette.tsx — 命令面板 (Ctrl+K)
components/ContextMenu.tsx   — 右键菜单
components/ErrorBoundary.tsx — 错误边界
```

## 关键构建命令

```bash
# 编译检查
cargo check --workspace              # Rust 全量检查
cd frontend && yarn typecheck         # TypeScript 类型检查

# 测试
cargo test --workspace                # Rust 测试
cd frontend && yarn test              # 前端单元测试
cd frontend && yarn playwright test   # E2E 全套测试

# WASM 构建 (推荐 wasm-pack)
just build-wasm                       # Debug WASM → frontend/wasm/pkg/
just build-wasm-release               # Release WASM + wasm-opt 优化

# rnk-next SDK 库构建 (供外部宿主应用嵌入渲染地图)
cd frontend && yarn build:rnk         # → frontend/dist-rnk/worldeditor-next-sdk.js (产物已 gitignore, 详见 docs/sdk-integration.md)

# 桌面应用
cargo build --workspace               # Native 构建
just bundle                           # Tauri 打包桌面安装程序

# 代码质量
cargo clippy --workspace -- -D warnings
cargo fmt --all -- --check
cargo audit

# 视觉回归
just test-visual                      # 运行视觉回归测试
just update-snapshots                 # 更新视觉基线截图

# just 命令 (推荐)
just check                            # 全量编译检查
just test                             # Rust + 前端测试
just test-e2e                         # Playwright E2E 全套
just lint                             # Rust + 前端 lint
just build-all                        # 全量构建 (native + wasm + frontend)
just bench                            # 性能基准测试
just clean                            # 清理所有构建产物
```

## 架构规则

### Crate 分层

1. **we-core**: 纯领域逻辑，零平台依赖，必须 WASM 兼容
2. **we-plugin-core**: 插件系统框架，依赖 we-core，必须 WASM 兼容
3. **we-render**: wgpu 渲染，WGSL 着色器，必须 WASM 兼容
4. **we-io**: 平台 I/O 抽象层 + 多格式导入导出，通过 `cfg(target_arch)` 条件编译
5. **we-service**: 编辑器业务逻辑，依赖 we-core + we-io
6. **we-native**: 仅桌面端功能（点云、GDAL），**禁止被 we-wasm 依赖**
7. **we-wasm**: WASM 入口，仅包含 wasm-bindgen 绑定
8. **we-server**: REST API 服务器，依赖 we-core，**独立部署**

### 依赖方向 (严格单向)

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

**禁止**: we-core 依赖其他 crate, we-wasm 依赖 we-native, we-server 被客户端 crate 依赖

### WASM 兼容性

以下 crate 必须可编译到 `wasm32-unknown-unknown`：
- we-core, we-plugin-core, we-render, we-io, we-service, we-wasm

检查方法：
```bash
cargo build --target wasm32-unknown-unknown -p we-wasm --release
```

### 平台适配器模式 (前端)

前端通过 `PlatformService` 接口抽象平台差异：

```typescript
// services/platform.ts
interface PlatformService {
  openFile(): Promise<FileRef>;
  saveFile(path: string, content: string): Promise<void>;
  parseOpenDrive(xml: string): Promise<Project>;
  writeOpenDrive(project: Project): Promise<string>;
  generateRoadVertices(project: Project): Promise<Float32Array>;
}

// 运行时自动选择：
// - Tauri 桌面 → TauriPlatformService (IPC 调用)
// - Web 浏览器 → WebPlatformService (WASM 直调)
```

### 插件系统架构

```
plugins/                          # 外部插件目录
  plugin-example/
    manifest.json                 # { id, name, version, main, permissions, dependencies }

frontend/src/plugins/             # 内置插件 (TypeScript)
  builtinRegistry.ts              # 注册所有内置插件
  pluginApi.ts                    # 前端插件 API
  pluginLoader.ts                 # 插件加载器

crates/we-plugin-core/            # Rust 插件框架
  PluginRegistry                  # 发现 → 加载 → 卸载, 依赖解析
  PluginManifest                  # manifest.json 解析 + semver 校验
  EditorPlugin trait              # on_activate / on_deactivate 生命周期
  PluginContext                   # 注册命令, 菜单项, 导入/导出器, 渲染器
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

- **状态管理**: 仅通过 Zustand store 管理全局状态，使用 slices 模式拆分
- **不可变更新**: 使用展开运算符 `{ ...state, field: newValue }`
- **类型安全**: 严格模式，禁止 `any`
- **导入**: 使用绝对路径或 `@/` 别名
- **测试**: Vitest + @testing-library/react
- **插件**: 内置插件放在 `frontend/src/plugins/`，外部插件放在 `plugins/`

### WGSL 着色器

- 着色器文件放在 `crates/we-render/src/shaders/*.wgsl`
- 通过 `include_str!()` 在编译时嵌入
- 前端视口内嵌着色器在 `frontend/src/viewport/viewportShaders.ts`
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
| E2E | 关键用户路径覆盖 (17 spec files) |

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

### E2E 测试

Playwright 测试位于 `frontend/e2e/` (17 spec files)，覆盖以下场景：
- app-shell, viewport, viewport-interaction — 基础 UI
- open-parse-render, data-loading — 文件加载与渲染
- road-selection, edit-operations, elevation-editing — 编辑功能
- geometry-draw, snapping, measurement — 几何工具
- undo-redo, project-lifecycle — 状态管理
- context-menu, theme-visual, render-effects — UI 交互
- visual-regression — 视觉回归 (截图比对)

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
- [ ] E2E 测试通过 (`just test-e2e`)
- [ ] 无 clippy 警告 (`just lint-rust`)
- [ ] 代码格式化 (`just fmt`)
- [ ] 安全审计通过 (`just audit`)
- [ ] WASM 目标编译通过 (`just build-wasm`)
- [ ] 覆盖率不低于阈值

## 常见任务指南

### 添加新的领域模型

1. 在 `crates/we-core/src/model/` 添加类型定义
2. Derive `Serialize, Deserialize, Debug, Clone`
3. 编写单元测试
4. 如需编辑器命令：在 `crates/we-service/src/commands/` 对应模块添加
5. 如需 IPC 暴露：在 `src-tauri/src/commands.rs` 添加命令
6. 如需 WASM 暴露：在 `crates/we-wasm/src/` 对应模块添加导出

### 添加新的渲染管线

1. 在 `crates/we-render/src/shaders/` 添加 WGSL 着色器
2. 在 `pipeline.rs` 创建管线
3. 在 `renderer.rs` 集成到渲染循环
4. 前端侧在 `viewport/pipelineFactory.ts` 添加对应管线
5. 确保 WASM 编译通过

### 添加新的前端组件

1. 在 `frontend/src/components/` 对应子目录创建组件
2. 使用 Zustand store 管理状态 (必要时添加新 slice)
3. 通过 `PlatformService` 调用后端
4. 编写 Vitest 测试

### 添加新的 Tauri 命令

1. 在 `src-tauri/src/commands.rs` 添加 `#[tauri::command]` 函数
2. 在 `src-tauri/src/lib.rs` 的 `invoke_handler` 中注册
3. 如需文件/对话框权限：更新 `src-tauri/capabilities/default.json`
4. 在 `frontend/src/services/tauri.ts` 添加对应调用
5. 编写测试

### 添加新的内置插件

1. 在 `frontend/src/plugins/` 创建 `<name>.plugin.ts`
2. 实现插件接口 (id, name, activate/deactivate)
3. 在 `builtinRegistry.ts` 注册
4. 如需 I/O 贡献：实现 `ImporterContrib` / `ExporterContrib`
5. 编写 `<name>.plugin.test.ts` 测试

### 添加新的编辑器命令 (Rust)

1. 在 `crates/we-service/src/commands/` 对应模块添加命令结构体
2. 实现 `Command` trait: `execute()`, `undo()`, `description()`
3. execute 必须返回新 Project (不可变更新)
4. 编写单元测试 (RED → GREEN → REFACTOR)

### 开发 REST API 端点

1. 在 `crates/we-server/src/api/` 添加路由模块
2. 在 `main.rs` 注册到 Axum router
3. 需要认证的端点使用 `auth::jwt` 中间件
4. 编写集成测试

## 已知限制

- 以下列表不包含 2026-05-14 ~ 2026-05-15 已修复的 crosswalk / parking space / `objectReference` 问题。

- 点云加载未实现（we-native 占位，Phase 4 预留）
- GDAL/LAS 依赖尚未启用（栅格/异型 CRS 保留为桌面扩展；常见投影 UTM/TM/Web Mercator 已由 we-core 纯 Rust 引擎实现）
- DXF / Shapefile 导入导出已实现；SUMO net.xml 导入导出已实现（`sumo` feature）
- we-server WebSocket 协作编辑为占位实现
- we-server S3 存储后端为 stub
- CSP 仅含 `wasm-unsafe-eval`（允许 WASM 编译，不含 JS `unsafe-eval`）
- 外部插件 JS 已加静态沙箱守卫（`sandboxGuard`，注入前拦截禁用能力）；完整 realm 隔离（Web Worker）为后续浏览器验证项
- 实例化渲染尚未补齐，dense scene 性能仍需继续提升
- 前端 Visual Regression 还未纳入 CI 门禁
- 大项目下的拾取/吸附缓存路径仍需持续回归验证
- 网格生成为全量重建，增量更新待做

## 参考资料

- [OpenDRIVE 1.6 规范](https://www.asam.net/standards/detail/opendrive/)
- [wgpu 文档](https://docs.rs/wgpu/latest/wgpu/)
- [Tauri 2.0 文档](https://v2.tauri.app/)
- [wasm-bindgen 指南](https://rustwasm.github.io/wasm-bindgen/)
- [Axum 文档](https://docs.rs/axum/latest/axum/)
- [Playwright 文档](https://playwright.dev/)
