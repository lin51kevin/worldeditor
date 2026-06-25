# Changelog

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

---

<a name="0.3.2"></a>
## [0.3.2] — 2026-06-25

### Features

- **picking**: 多边形命中检测替代中心点距离检测——点击 crosswalk 白条任意位置即可选中物体，大型物体候选半径扩展至 20 m ([`dcd2c8d`])
- **render**: 物体选中高亮改为完整 BoundingBox 轮廓，Crosswalk 轮廓与斑马线区域精确重合，颜色与道路选中红色一致 ([`dcd2c8d`])

### Fixes

- **render**: Crosswalk 及道路物体 z-offset 提升至 0.05 m，解决与道路表面的深度冲突 ([`dcd2c8d`])
- **viewport**: LayerPanel 定位到选中项改为即时跳转，消除 smooth 动画延迟 ([`5e0cd68`])
- **viewport**: 图层面板聚焦按钮同时选中目标项（原仅聚焦不改变选中态） ([`5e0cd68`])
- **i18n**: 选择模式标签 "Road/道路" 改为 "Default/默认"，更准确反映全道路选择语义 ([`fe69a66`])

### CI

- **ci**: 重新启用 macOS aarch64/x86_64 发布构建目标，用 `cargo tauri build` + `softprops/action-gh-release` 替代 `tauri-apps/tauri-action` ([`49eedea`])

### Tests

- **test**: 修正 Viewport 测试中 tessellation step 断言 2 → 5（跟进 71e7aa4 常量调整） ([`f765ea2`])

---

<a name="0.3.1"></a>
## [0.3.1] — 2026-06-17

### Performance

- **render**: 曲率自适应细分道路参考线——直线最大步长 5 m，小半径圆弧自动加密至 0.5 m（`TESS_MAX_ERROR = 0.01 m`），匹配 WorldEditorOnline 常量 ([`71e7aa4`])

---

<a name="0.3.0"></a>
## [0.3.0] — 2026-06-09

### Features

- **pointcloud**: 新增点云可视化功能 — 核心算法 + WASM 绑定、Tauri IPC 二进制渲染缓冲、Web Worker、视口渲染与面板 UI ([`c7aebd4`], [`e555096`], [`162ce5f`], [`ce6d96d`])
- **render**: 新增 WebGPU sprite 渲染器，支持 PNG 纹理 ([`3acdcf4`])
- **render/wasm**: 从信号与标线物体生成 sprite 数据 ([`128e959`])
- **templates**: 模板面板新增 PNG 缩略图支持 ([`f6e2081`])
- **frontend**: 新增视口快照导出对话框 + 道路 addRoads + 交叉口/渲染改进 ([`434158e`], [`bb2b87f`])
- **wasm**: 扩展新增 WASM 导出的 TypeScript 声明 ([`05ea710`])
- **build**: Phase 3 stub 模块与 beta 插件改由构建标志门控 ([`462e887`])

### Fixes

- **tauri**: 修复生产环境资源加载（移除 bundle externalization） ([`094da2a`])
- **tauri**: 消除启动闪烁与双窗口效果 ([`0217902`])
- **render**: 修复 sprite billboard 缩放与文件切换清理 ([`f42f2a0`])
- **viewport**: 加载空项目时清除挂起的自动适配 ([`1396de6`])
- **ci**: 修复 rustfmt 违规与 cargo-llvm-cov report 标志 ([`6d89b0d`])

### Performance

- **frontend**: 缓存 PropertyPanel 道路/信号/物体查找 ([`14e1c87`])
- **frontend**: 缓存已有道路顶点修复螺旋绘制预览卡顿 ([`eb760af`])

### Refactor

- **viewport**: 提取 setupMouseControls 到 rendererInputHandler ([`a52a123`])
- **we-wasm**: 拆分 road_gen 与 signal_gen 渲染子模块 ([`93ce42f`])
- **we-service**: 将 lane/road 命令文件拆分为子目录 ([`5ee8a54`])
- **pointcloud**: 内联样式提取到 CSS；新增斑马线 fixture ([`14fd326`])

### Build & CI

- **build**: release opt-level 由 'z' 改为 's' ([`04acc6a`])
- **ci**: 启用覆盖率门禁并新增 lint job ([`da32174`])
- **tauri**: 桌面构建移除 devtools feature ([`5eb623e`])
- **assets**: 新增交通信号、道路与交通灯 PNG 纹理 ([`98f13b8`])

### Tests

- **viewport**: 新增 WebGPU stubs 与单元测试 ([`fb47995`])
- **we-server**: 新增 auth 中间件测试 ([`576dc77`])

<a name="0.2.0"></a>
## [0.2.0] — 2026-05-25

### Features

- **shape-editor**: 新增矢量图形图层编辑器 (P0-1)，支持绘制/编辑自定义形状 ([`81e1ac6`])
- **junction-connectors**: 自动构建交叉口连接道路 (P0-2)，匹配 C# 参考实现 ([`4c70a9a`])
- **bridge-tunnel**: 新增桥梁/隧道管理功能 (P0-3)，支持标记路段为桥梁或隧道 ([`135b21a`])
- **frontend**: 地图加载进度条、Worker 解析及文件拖放 ([`0284114`])
- **frontend**: 2D 正交相机、动态网格间距与网格象限居中 ([`c08b4ab`])
- **frontend**: 重写环形交叉口模板，匹配 C# 弧-间隙架构 + 新增 Roundabout 4 模板 ([`d2cb6e1`])
- **frontend**: 重构交叉口模板引擎，星形多边形渲染，匹配 C# 参考 ([`dc60f4f`], [`af6678e`])
- **frontend**: 隐藏交叉口内部连接道路的车道线 ([`376596e`])
- **frontend**: 改进交叉口模板 — 弧形连接器、环岛、停止线 ([`ff05aff`])
- **frontend**: 使用实际车道宽度生成更宽的交叉口多边形 ([`c8d29a2`])
- **ux**: 确认对话框、无障碍改进和命令描述 ([`a60e644`])
- **ux**: 用户偏好持久化 + 错误处理 ([`fb6f241`])
- **frontend**: 文件打开时显示加载进度遮罩 ([`a17f639`])
- **frontend**: 新增 GeoZ 解析器 Web Worker ([`e64e218`])
- **server**: 新增 REST API 项目 CRUD 端点 + Docker 部署配置 ([`290597c`])
- **frontend**: 跨模式键盘快捷键 + 服务端 API 测试 ([`81f08df`])
- **frontend**: 道路编辑增强（浮动工具栏操作按钮） ([`2e47b5d`])
- **frontend**: 大幅重构样条节点编辑 — 存储控制点、修复 E-mode 节点 ([`b03de08`])
- **ai-copilot**: 扩展 OpenRouter 模型列表 (50+ 模型)，新增 listModels API 和 ModelCombobox ([`277e70a`], [`c14f012`], [`e8be165`])
- **ai-copilot**: 配置驱动的意图解析器 + 文本上下文菜单 ([`5b86a1d`])
- **ai-copilot**: AI Copilot 配置持久化到应用数据目录 ([`1c77688`])
- **frontend**: 使用 LaneEditor 组件替换 PropertyPanel 内联车道编辑器 ([`0138b8e`])

### Performance

- **core**: 优化高程、空间索引和路径搜索算法 ([`9ec12da`])
- **render**: 渲染器和物体渲染预分配顶点缓冲区 ([`b66176d`])
- **frontend**: Viewport 细粒度 Zustand 选择器，减少不必要重渲染 ([`5ec736a`])
- **frontend**: 使用 @tanstack/react-virtual 虚拟化 LayerPanel ([`0b75ec6`])
- 新增缓存信号/物体拾取，消除逐次 JSON 序列化开销 ([`e74c671`])
- 分层网格缓存 — 显示切换时跳过 WASM 调用 ([`11e2cd0`])
- 细粒度表面网格失效 + 缓存道路顶点生成 ([`ee961d3`])
- 修复信号/物体切换触发全量 WASM 重序列化 ([`f7e1e31`])

### Refactoring

- **service**: 封装 AppState 为私有字段 ([`f1f0884`])
- **plugin**: 迁移到 parking_lot RwLock + 生命周期测试 ([`4aa518c`])
- **tauri**: 原子化插件安装 + geo_coord_to_json 辅助函数 ([`4ecc92d`])
- 拆分大文件 (road_ops, topology, Viewport) ([`aa2e2b1`])
- 提取视口事件分发、鼠标控制、捕捉服务 ([`5affc02`])
- 切换为按车道连接器匹配 C# 参考 ([`1e488bd`])
- 改进 StatusBar 比例尺格式化 ([`1377fb5`])
- 重组工具栏和菜单栏控件 ([`e96c767`])
- 精简浮动工具栏 — 移除冗余按钮 ([`467e31b`])

### Bug Fixes

- **we-core**: 为 Lane width/borders/road_marks 字段添加 serde 默认值 ([`bbb9a2f`])
- 为 ObjectType 枚举添加 serde 别名，支持大小写兼容 ([`a1593a0`])
- 修复交叉口模板连接拓扑、车道数及道路设施 ([`91965b4`])
- T/Cross 拓扑使用径向臂放置匹配 C# ([`b0decc6`])
- 匹配 C# 默认目录中的路肩宽度 (2.0m) ([`e2a953f`])
- 恢复 T 形臂放置 (0/90/-90) ([`a6616f2`])
- T 交叉口为所有配对添加行驶连接器并调整箭头类型 ([`6d47dbd`])
- 修正环岛弧-交叉口索引映射 ([`0077b35`])
- 添加缺失的环岛连接器组 ([`aaf838c`])
- 为环岛连接器添加横向偏移 ([`032e5ae`])
- 缩减臂-环连接器为每交叉口 2 个 (1 入 + 1 出) ([`3d96299`])
- 环形通行连接器添加路肩车道 ([`1a1317f`], [`98b0487`])
- 交叉口模板放置合并为单次 undo 条目 ([`3b72281`])
- 修复空闲渲染循环回归 — 一致使用 markSceneDirty() ([`7874e5c`])
- 新建项目时面板重置与视口清空 ([`21df31f`])
- 修复点击放置绘制回归 ([`4a35dfa`])
- 修复虚拟表改进引入的回归 ([`2b88168`])
- GeoZ 解析器切换到 protobufjs 并添加运行时别名 ([`166e69e`])
- 视口 mousedown 处理器包裹 try-catch ([`bf96e14`])
- StatusBar 从 viewportMpp 和 niceNumber 动态计算比例尺 ([`2f1476a`])
- 语言图标对齐与菜单栏固定定位 ([`389c1db`])
- FloatingPanel 延迟 rect 持久化 & 插件面板 z-index 上限 ([`bcbd01a`])
- 下拉面板使用自动宽度并左对齐 ([`dca67bc`])
- 允许所有选择模式下的绘制和模板放置 ([`1621555`])
- 通过分段投影改进道路拾取精度 ([`90d0fca`])
- 解决工具栏/菜单栏面板中的 i18n 键回归 ([`9c093dc`])
- 恢复浮动工具栏中的 clone/reverse/mirror/optimize/swap 按钮 ([`64fb27d`])
- 从几何编辑模式单次 M/R 键即可切换工具栏 ([`f3e493c`])
- 工具栏插件按钮在模式切换前先完成几何编辑 ([`9a50ada`])
- 修复切线拖拽支持 ([`58512d4`])
- 修正 ParamPoly3 道路分割精度 ([`be84a38`])
- 数字输入框步进按钮主题适配与间距修复 ([`88a16f2`])
- 道路标线面板样式重构 ([`542f629`])
- 加载遮罩和文件拖放区域适配主题系统 ([`810b77f`])
- 关闭文件时重置为 2D 视图，打开文件时缩放适应 ([`8ab18ea`])
- 防止 Ctrl+Z/Y 双重撤销/重做 ([`6ba9983`])
- PropertyPanel 名称输入仅在 blur/Enter 时提交 ([`5b71a8f`])
- Worker format 设置为 'es' 以兼容代码分割 ([`04c1209`])
- colorMode 变更现在正确失效表面网格缓存 ([`d6610da`])
- 道路自动滚动回归 + 缓存信号/物体/车道世界坐标 ([`c02e2b8`])
- 左侧面板宽度调整为 300px 及浮动面板位置修正 ([`3825ffc`])

### Tests

- 新增 we-service 命令模块测试 ([`6a6917f`])
- 新增 we-server 单元测试 ([`b83a90f`])
- 新增 we-render 纯逻辑测试 ([`a57b7a8`])
- 新增 we-wasm 渲染和桥接模块测试 ([`87138eb`])
- 新增 we-native 点云冒烟测试 ([`bf3510b`])
- 扩展前端 stores 和 services 测试 ([`1e6f032`])
- 新增前端插件测试 ([`bbee768`])
- 新增前端组件测试 ([`0c85a25`])
- 添加 WebGPU/WASM/DOM 相关文件的覆盖率排除 ([`b4a362e`])

### Chores

- 添加 ESLint + TypeScript 和 React Hooks 插件 ([`affc02d`])
- 清理所有 cargo test 警告 ([`0f86c6d`])
- 排除测试文件于 tsconfig 类型检查 ([`ea2322f`])

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
[`81e1ac6`]: https://github.com/lin51kevin/worldeditor/commit/81e1ac6
[`4c70a9a`]: https://github.com/lin51kevin/worldeditor/commit/4c70a9a
[`135b21a`]: https://github.com/lin51kevin/worldeditor/commit/135b21a
[`0284114`]: https://github.com/lin51kevin/worldeditor/commit/0284114
[`c08b4ab`]: https://github.com/lin51kevin/worldeditor/commit/c08b4ab
[`d2cb6e1`]: https://github.com/lin51kevin/worldeditor/commit/d2cb6e1
[`dc60f4f`]: https://github.com/lin51kevin/worldeditor/commit/dc60f4f
[`af6678e`]: https://github.com/lin51kevin/worldeditor/commit/af6678e
[`376596e`]: https://github.com/lin51kevin/worldeditor/commit/376596e
[`ff05aff`]: https://github.com/lin51kevin/worldeditor/commit/ff05aff
[`c8d29a2`]: https://github.com/lin51kevin/worldeditor/commit/c8d29a2
[`a60e644`]: https://github.com/lin51kevin/worldeditor/commit/a60e644
[`fb6f241`]: https://github.com/lin51kevin/worldeditor/commit/fb6f241
[`a17f639`]: https://github.com/lin51kevin/worldeditor/commit/a17f639
[`e64e218`]: https://github.com/lin51kevin/worldeditor/commit/e64e218
[`290597c`]: https://github.com/lin51kevin/worldeditor/commit/290597c
[`81f08df`]: https://github.com/lin51kevin/worldeditor/commit/81f08df
[`2e47b5d`]: https://github.com/lin51kevin/worldeditor/commit/2e47b5d
[`b03de08`]: https://github.com/lin51kevin/worldeditor/commit/b03de08
[`277e70a`]: https://github.com/lin51kevin/worldeditor/commit/277e70a
[`c14f012`]: https://github.com/lin51kevin/worldeditor/commit/c14f012
[`e8be165`]: https://github.com/lin51kevin/worldeditor/commit/e8be165
[`5b86a1d`]: https://github.com/lin51kevin/worldeditor/commit/5b86a1d
[`1c77688`]: https://github.com/lin51kevin/worldeditor/commit/1c77688
[`0138b8e`]: https://github.com/lin51kevin/worldeditor/commit/0138b8e
[`9ec12da`]: https://github.com/lin51kevin/worldeditor/commit/9ec12da
[`b66176d`]: https://github.com/lin51kevin/worldeditor/commit/b66176d
[`5ec736a`]: https://github.com/lin51kevin/worldeditor/commit/5ec736a
[`0b75ec6`]: https://github.com/lin51kevin/worldeditor/commit/0b75ec6
[`e74c671`]: https://github.com/lin51kevin/worldeditor/commit/e74c671
[`11e2cd0`]: https://github.com/lin51kevin/worldeditor/commit/11e2cd0
[`ee961d3`]: https://github.com/lin51kevin/worldeditor/commit/ee961d3
[`f7e1e31`]: https://github.com/lin51kevin/worldeditor/commit/f7e1e31
[`f1f0884`]: https://github.com/lin51kevin/worldeditor/commit/f1f0884
[`4aa518c`]: https://github.com/lin51kevin/worldeditor/commit/4aa518c
[`4ecc92d`]: https://github.com/lin51kevin/worldeditor/commit/4ecc92d
[`aa2e2b1`]: https://github.com/lin51kevin/worldeditor/commit/aa2e2b1
[`5affc02`]: https://github.com/lin51kevin/worldeditor/commit/5affc02d
[`1e488bd`]: https://github.com/lin51kevin/worldeditor/commit/1e488bd
[`1377fb5`]: https://github.com/lin51kevin/worldeditor/commit/1377fb5
[`e96c767`]: https://github.com/lin51kevin/worldeditor/commit/e96c767
[`467e31b`]: https://github.com/lin51kevin/worldeditor/commit/467e31b
[`bbb9a2f`]: https://github.com/lin51kevin/worldeditor/commit/bbb9a2f
[`a1593a0`]: https://github.com/lin51kevin/worldeditor/commit/a1593a0
[`91965b4`]: https://github.com/lin51kevin/worldeditor/commit/91965b4
[`b0decc6`]: https://github.com/lin51kevin/worldeditor/commit/b0decc6
[`e2a953f`]: https://github.com/lin51kevin/worldeditor/commit/e2a953f
[`a6616f2`]: https://github.com/lin51kevin/worldeditor/commit/a6616f2
[`6d47dbd`]: https://github.com/lin51kevin/worldeditor/commit/6d47dbd
[`0077b35`]: https://github.com/lin51kevin/worldeditor/commit/0077b35
[`aaf838c`]: https://github.com/lin51kevin/worldeditor/commit/aaf838c
[`032e5ae`]: https://github.com/lin51kevin/worldeditor/commit/032e5ae
[`3d96299`]: https://github.com/lin51kevin/worldeditor/commit/3d96299
[`1a1317f`]: https://github.com/lin51kevin/worldeditor/commit/1a1317f
[`98b0487`]: https://github.com/lin51kevin/worldeditor/commit/98b0487
[`3b72281`]: https://github.com/lin51kevin/worldeditor/commit/3b72281
[`7874e5c`]: https://github.com/lin51kevin/worldeditor/commit/7874e5c
[`21df31f`]: https://github.com/lin51kevin/worldeditor/commit/21df31f
[`4a35dfa`]: https://github.com/lin51kevin/worldeditor/commit/4a35dfa
[`2b88168`]: https://github.com/lin51kevin/worldeditor/commit/2b88168
[`166e69e`]: https://github.com/lin51kevin/worldeditor/commit/166e69e
[`bf96e14`]: https://github.com/lin51kevin/worldeditor/commit/bf96e14
[`2f1476a`]: https://github.com/lin51kevin/worldeditor/commit/2f1476a
[`389c1db`]: https://github.com/lin51kevin/worldeditor/commit/389c1db
[`bcbd01a`]: https://github.com/lin51kevin/worldeditor/commit/bcbd01a
[`dca67bc`]: https://github.com/lin51kevin/worldeditor/commit/dca67bc
[`1621555`]: https://github.com/lin51kevin/worldeditor/commit/1621555
[`90d0fca`]: https://github.com/lin51kevin/worldeditor/commit/90d0fca
[`9c093dc`]: https://github.com/lin51kevin/worldeditor/commit/9c093dc
[`64fb27d`]: https://github.com/lin51kevin/worldeditor/commit/64fb27d
[`f3e493c`]: https://github.com/lin51kevin/worldeditor/commit/f3e493c
[`9a50ada`]: https://github.com/lin51kevin/worldeditor/commit/9a50ada
[`58512d4`]: https://github.com/lin51kevin/worldeditor/commit/58512d4
[`be84a38`]: https://github.com/lin51kevin/worldeditor/commit/be84a38
[`88a16f2`]: https://github.com/lin51kevin/worldeditor/commit/88a16f2
[`542f629`]: https://github.com/lin51kevin/worldeditor/commit/542f629
[`810b77f`]: https://github.com/lin51kevin/worldeditor/commit/810b77f
[`8ab18ea`]: https://github.com/lin51kevin/worldeditor/commit/8ab18ea
[`6ba9983`]: https://github.com/lin51kevin/worldeditor/commit/6ba9983
[`5b71a8f`]: https://github.com/lin51kevin/worldeditor/commit/5b71a8f
[`04c1209`]: https://github.com/lin51kevin/worldeditor/commit/04c1209
[`d6610da`]: https://github.com/lin51kevin/worldeditor/commit/d6610da
[`c02e2b8`]: https://github.com/lin51kevin/worldeditor/commit/c02e2b8
[`3825ffc`]: https://github.com/lin51kevin/worldeditor/commit/3825ffc
[`6a6917f`]: https://github.com/lin51kevin/worldeditor/commit/6a6917f
[`b83a90f`]: https://github.com/lin51kevin/worldeditor/commit/b83a90f
[`a57b7a8`]: https://github.com/lin51kevin/worldeditor/commit/a57b7a8
[`87138eb`]: https://github.com/lin51kevin/worldeditor/commit/87138eb
[`bf3510b`]: https://github.com/lin51kevin/worldeditor/commit/bf3510b
[`1e6f032`]: https://github.com/lin51kevin/worldeditor/commit/1e6f032
[`bbee768`]: https://github.com/lin51kevin/worldeditor/commit/bbee768
[`0c85a25`]: https://github.com/lin51kevin/worldeditor/commit/0c85a25
[`b4a362e`]: https://github.com/lin51kevin/worldeditor/commit/b4a362e
[`affc02d`]: https://github.com/lin51kevin/worldeditor/commit/affc02d
[`0f86c6d`]: https://github.com/lin51kevin/worldeditor/commit/0f86c6d
[`ea2322f`]: https://github.com/lin51kevin/worldeditor/commit/ea2322f
