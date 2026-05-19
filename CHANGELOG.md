# Changelog

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

---

<a name="0.1.2"></a>
## [0.1.2] — 2026-05-19

### Features

- **ai-copilot**: 新增 AI Copilot 插件，全功能聊天 UI（CopilotPanel、ChatArea、ChatMessage、QuickCommands、SettingsView、RoadActionPreview）([`6515e8a`])
  - MenuBar 快捷栏新增 Sparkles 按钮，全局快捷键 `Ctrl+Alt+I` 切换面板
  - 支持 8 种 LLM 提供商预设（OpenAI、OpenRouter、Claude、Kimi 等），带 API Key 链接与连接测试
  - 斜杠命令弹出菜单（QuickCommands），使用纯 CSS 定位修复位置异常
  - 面板标题栏可拖动，注册为第 25 个内置插件
- **frontend**: 新增 `adjust-edge` 道路边缘拖拽模式，可视化调整车道宽度 ([`dad1b7b`])
  - 新增 `useAdjustEdgeMode` hook，鼠标靠近道路边缘时显示双向调整光标
  - PlatformService 新增 `pickLaneAtPointCached()` 高效车道点击检测
  - road-tools 插件工具栏新增对应按钮
- **frontend**: 新增 `RoadMarkingPanel`，支持编辑道路标线 ([`60c4bbb`])
  - 集成到 LayerPanel，LayerPanel 自动滚动至选中的 laneSection / lane 节点
  - RoadLayerItem 新增 `registerLaneSectionRef` / `registerLaneRef` 回调
- **frontend**: 新增"关闭文件"命令（`Ctrl+W`），含脏数据确认对话框 ([`f402f38`])
  - File 菜单增加"关闭文件"入口，修改未保存时弹出确认提示
- **frontend**: 重写 `FloatingPanel`，支持 8 方向调整大小 ([`c271de6`])
  - 将偏移量状态统一为 `rect {x,y,w,h}`（STATE_VERSION 2）
  - 新增边界防护，防止面板被拖出屏幕可视区域

### Refactoring

- **frontend**: 工具栏编辑模式优化 ([`0d554b3`])
  - 新增"车道"（`lane`）编辑模式按钮（MoveHorizontal 图标）
  - 将 `selectMode` 按钮重命名为 `roadEdit`，语义更明确
  - 暂时注释"车道簇"（`lanesection`）按钮（待设计评审）
  - CommandPalette 类别名称改为可翻译 i18n 键值；移除视图模式项，新增撤销/重做
  - RoadEditToolbar 移除占位 road-markings 按钮

### Bug Fixes

- **ai-copilot**: 修复面板标题栏拖拽区域未被 `FloatingPanel` 识别的问题 ([`01006c5`])
- **ai-copilot**: 修复斜杠命令弹出窗口定位，改用纯 CSS `bottom:100%` 定位 ([`2041a6a`])

### Tests

- 修复 `Toolbar.test.tsx` 中因"车道簇"按钮已注释导致的 3 个测试失败
  - 更新"renders three select mode buttons"→ 验证车道簇已移除
  - 删除"clicking lane section button sets editMode to lanesection"测试
  - 更新"active button has active class"改用 `lane` 模式校验

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
[`6515e8a`]: https://github.com/lin51kevin/worldeditor/commit/6515e8a
[`dad1b7b`]: https://github.com/lin51kevin/worldeditor/commit/dad1b7b
[`60c4bbb`]: https://github.com/lin51kevin/worldeditor/commit/60c4bbb
[`c271de6`]: https://github.com/lin51kevin/worldeditor/commit/c271de6
[`f402f38`]: https://github.com/lin51kevin/worldeditor/commit/f402f38
[`0d554b3`]: https://github.com/lin51kevin/worldeditor/commit/0d554b3
[`01006c5`]: https://github.com/lin51kevin/worldeditor/commit/01006c5
[`2041a6a`]: https://github.com/lin51kevin/worldeditor/commit/2041a6a
[`7ef04b3`]: https://github.com/lin51kevin/worldeditor/commit/7ef04b3
