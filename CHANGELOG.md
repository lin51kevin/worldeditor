# Changelog

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

---

<a name="0.1.1"></a>
## [0.1.1] — 2026-05-11

### Bug Fixes

- **viewport**: 几何编辑模式下拖拽控制点时道路网格实时更新 ([`95c35aa`])
  - 添加 `isPreviewingRoadRef` mutex，防止并发预览渲染堆积
  - 拖拽过程中直接向渲染器上传顶点，不触发 undo 栈
- **we-core**: 用 `total_cmp()` 替换 `partial_cmp().unwrap()` 消除 panic 隐患 ([`bed71ba`])
- **security**: 为 Tauri 桌面应用启用 Content-Security-Policy ([`da1600b`])

### Features

- **we-core**: 新增 `RoadTemplate` / `TemplateLane` 领域模型 ([`dfa9135`])
  - 提供 `single_lane` / `dual_two_lane` / `dual_four_lane` / `dual_six_lane` 预设
  - `to_lane_section()` 转换器，被 `we-service` 和 `we-wasm` 直接使用
  - 修复 E0583 编译错误（缺失 `template` 模块文件）
- **renderer**: 样条控制点视觉重构 ([`83b1900`])
  - 节点由方块改为圆形（蓝色 #3498db + 白色边框环）
  - 切线手柄改为红色圆形端点（#e74c3c），线更细更现代
  - Hermite 曲线线宽从 0.2 调整为 0.25
- **viewport**: 交互式样条节点与切线手柄拖拽 ([`05461ba`])
- **viewport**: 支持拖放模板到视口以快速创建道路 ([`5ed23d8`])
- **backend**: 新增 `CreateRoadFromSpline` 命令、WASM 导出及服务绑定 ([`54f77f9`]→[`54d42a1`])
- **ui**: 新增 Spline 工具栏按钮、命令面板入口和 i18n 键值 ([`f6fc37e`])
- **frontend**: 集成高程编辑、捕捉与测量 UI ([`64493c4`])
- **frontend**: 新增高程编辑、捕捉、测量服务契约及状态管理 ([`c6dbe60`]–[`fd7d28f`])
- **i18n**: 新增高程、捕捉与测量相关翻译键值 ([`2c65376`])

### Refactoring

- **frontend**: 消除全部 `as any` 类型断言，全面启用严格类型 ([`da279d0`])
- **we-service**: 将命令模块拆分为子模块 ([`526400f`])

### Performance

- 消除每帧内存分配，缓存矩阵逆运算以提升平移流畅度 ([`54f77f9`])

### Tests

- 新增样条编辑、服务绑定及工具栏/菜单 E2E 测试 ([`34cbbb5`])
- 新增高程、捕捉和测量 E2E 测试 ([`003ff55`])
- 为新增的 PlatformService 样条编辑方法添加 mock ([`d6846cb`])

### Chores

- 清理临时文档文件 ([`af66122`])

---

<a name="0.1.0"></a>
## [0.1.0] — 2026-04 (Initial Development)

### Features

- 基于 Rust + TypeScript + Tauri 2.0 的全新架构
- `we-core`：OpenDRIVE 解析、GIS 坐标系、道路/车道/路口领域模型
- `we-render`：基于 wgpu 的 WebGPU 渲染引擎（WGSL 着色器）
- `we-service`：编辑器服务层（命令模式、撤销/重做）
- `we-wasm`：wasm-bindgen WASM 入口，支持 Web 端复用 Rust 核心
- `we-io`：平台抽象 I/O（原生文件系统 / WASM）
- `src-tauri`：Tauri 2.0 桌面应用壳
- 前端：React 19 + Zustand 5 + Vite 6，双端（Tauri / Web）部署
- WebGPU 视口：道路网格、车道线、参考线、路口渲染
- 几何相机：轨道控制（平移/旋转/缩放），世界坐标反投影
- OpenDRIVE 文件读写（`.xodr`）
- 项目生命周期：新建、打开、保存、导入/导出
- 道路选择、高亮、属性面板
- 撤销/重做命令栈
- 图层可见性控制
- 插件系统骨架（`we-plugin-core`）

[`95c35aa`]: https://github.com/lin51kevin/worldeditor/commit/95c35aa
[`83b1900`]: https://github.com/lin51kevin/worldeditor/commit/83b1900
[`dfa9135`]: https://github.com/lin51kevin/worldeditor/commit/dfa9135
[`af66122`]: https://github.com/lin51kevin/worldeditor/commit/af66122
[`da279d0`]: https://github.com/lin51kevin/worldeditor/commit/da279d0
[`da1600b`]: https://github.com/lin51kevin/worldeditor/commit/da1600b
[`bed71ba`]: https://github.com/lin51kevin/worldeditor/commit/bed71ba
[`d6846cb`]: https://github.com/lin51kevin/worldeditor/commit/d6846cb
[`b711bf0`]: https://github.com/lin51kevin/worldeditor/commit/b711bf0
[`74bae3b`]: https://github.com/lin51kevin/worldeditor/commit/74bae3b
[`5ed23d8`]: https://github.com/lin51kevin/worldeditor/commit/5ed23d8
[`34cbbb5`]: https://github.com/lin51kevin/worldeditor/commit/34cbbb5
[`05461ba`]: https://github.com/lin51kevin/worldeditor/commit/05461ba
[`f6fc37e`]: https://github.com/lin51kevin/worldeditor/commit/f6fc37e
[`54d42a1`]: https://github.com/lin51kevin/worldeditor/commit/54d42a1
[`003ff55`]: https://github.com/lin51kevin/worldeditor/commit/003ff55
[`2c65376`]: https://github.com/lin51kevin/worldeditor/commit/2c65376
[`64493c4`]: https://github.com/lin51kevin/worldeditor/commit/64493c4
[`fd7d28f`]: https://github.com/lin51kevin/worldeditor/commit/fd7d28f
[`f8a360b`]: https://github.com/lin51kevin/worldeditor/commit/f8a360b
[`c6dbe60`]: https://github.com/lin51kevin/worldeditor/commit/c6dbe60
[`526400f`]: https://github.com/lin51kevin/worldeditor/commit/526400f
[`54f77f9`]: https://github.com/lin51kevin/worldeditor/commit/54f77f9
