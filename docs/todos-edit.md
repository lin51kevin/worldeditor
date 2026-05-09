# WorldEditor Next 编辑功能实施计划

## 一、现状分析

### 当前 worldeditor-next 编辑功能状态
1. **基础框架已建立**：Tauri + Rust + React 架构
2. **渲染基础完成**：WebGPU 视口渲染、网格、坐标系
3. **基本交互缺失**：几乎没有编辑相关功能
4. **数据结构简单**：基本的路网存储，缺少复杂编辑所需的数据结构
5. **前端组件初步**：基本UI组件，缺少专业编辑控件

### C# 版 WorldEditor 编辑功能参考
1. **完整的编辑架构**：
   - Action 系统（ActionBase、ActionHistory）
   - 图层系统（LayerBase、LayerManager）
   - 撤销重做
2. **核心编辑能力**：
   - Spline 样条编辑（EditableSplineBase）
   - 道路中心线编辑（EditKnotMouseMove）
   - 切线控制、软选择
   - Gizmo 交互系统
3. **专业编辑工具**：
   - Adjust Knots、Optimize、Make CenterLine、Make LaneLines
   - 车道截面编辑、交叉口编辑
   - 高度编辑、法线编辑

---

## 二、实施总体策略

**采用渐进式重构 + 插件化架构**：
1. **Phase 1**：核心编辑框架（Action 系统 + 基本交互）| 2-3周
2. **Phase 2**：Spline 编辑（道路基础编辑）| 3-4周
3. **Phase 3**：车道与截面编辑 | 3-4周
4. **Phase 4**：高级编辑功能（交叉口、信号灯、对象）| 4-5周
5. **Phase 5**：专业工具（高程、批量处理）| 3-4周

**总计**：15-20周完成核心编辑功能

---

## 三、详细实施计划

### Phase 1：核心编辑框架 (2-3周)

#### 目标
建立可扩展的编辑基础设施

#### Rust 后端 (we-core/we-service)
1. **Action 系统**
2. **图层管理**
3. **选择系统**

#### 前端 (React + Zustand)
1. **编辑状态管理**
2. **基础 UI 组件**
3. **事件系统**

#### 测试
- Action 系统的单元测试
- 选择系统的集成测试
- 基础交互的 E2E 测试

### Phase 2：Spline 编辑 (3-4周)

#### 目标
实现道路中心线编辑，移植 C# 版核心功能

#### Rust 后端
1. **样条数据结构**
2. **编辑算法移植**
   - `EditKnotMouseMove` 的逻辑
   - 切线计算（C# 中的 `ChangeTangent.ComputeTangent`）
   - 软选择（SoftSelection）
   - 约束计算（SplineKnotsFrame）
3. **拾取与命中检测**

#### 前端
1. **Gizmo 控件**
2. **切线程可视化**
3. **属性编辑**

#### 功能实现
1. **基本编辑操作**：
   - 添加/删除样条点
   - 移动样条点（2D/3D）
   - 调整切线
   - 插入/删除样条段

2. **专业工具**：
   - Adjust Knots
   - Optimize
   - Resample
   - Convert to CenterLine

### Phase 3：车道与截面编辑 (3-4周)

#### 目标
完善 OpenDRIVE 核心编辑功能

#### Rust 后端
1. **车道截面模型**
2. **车道编辑操作**
   - 添加/删除车道
   - 调整车道宽度（沿 s 方向）
   - 车道属性编辑（类型、线型等）
   - 车道连接编辑（predecessor/successor）
3. **截面重建算法**
   - 基于中心线生成车道截面
   - 车道边界计算
   - 横坡（crossfall）计算

#### 前端
1. **车道编辑器 UI**
2. **截面可视化**

#### 功能实现
1. **车道编辑**：
   - 添加/删除车道
   - 调整车道宽度曲线
   - 编辑车道属性
   - 设置车道连接

2. **截面工具**：
   - 分割/合并截面
   - 复制截面属性
   - 批量调整车道

### Phase 4：高级编辑功能 (4-5周)

#### 目标
实现交叉口、信号灯、对象等高级功能

#### Rust 后端
1. **交叉口模型**
2. **信号灯与对象**
3. **批量操作**
   - 多对象同时编辑
   - 属性批量修改
   - 几何变换工具（移动、旋转、缩放）

#### 前端
1. **交叉口编辑器**
2. **对象放置工具**

#### 功能实现
1. **交叉口编辑**：
   - 创建/删除交叉口
   - 编辑连接关系
   - 车道链接编辑
   - 优先级设置

2. **对象管理**：
   - 信号灯放置与编辑
   - 道路物体放置（标志、护栏等）
   - 对象属性编辑

3. **批量工具**：
   - 多选操作
   - 属性传递
   - 几何对齐

### Phase 5：专业工具与优化 (3-4周)

#### 目标
完善编辑体验，添加专业工具

#### Rust 后端
1. **高程编辑**
2. **吸附系统**
3. **性能优化**
   - 增量更新
   - 空间索引（R-tree）
   - 缓存系统

#### 前端
1. **高级工具 UI**
2. **视图增强**

#### 功能实现
1. **高程编辑工具**：
   - 高度调整（点/线/面）
   - 横坡编辑
   - 高程平滑

2. **吸附系统**：
   - 网格吸附
   - 对象吸附
   - 智能吸附（端点、中点、垂点）

3. **测量工具**：
   - 距离测量
   - 角度测量
   - 面积测量

---

## 四、关键技术挑战与解决方案

### 挑战 1：编辑性能
- **问题**：复杂路网的实时编辑响应
- **解决方案**：
  1. Rust 增量计算
  2. WebGPU 选择性重绘
  3. 数据分块加载

### 挑战 2：精度保持
- **问题**：编辑过程中保持几何精度
- **解决方案**：
  1. 双精度浮点运算
  2. 误差补偿算法
  3. 数据验证机制

### 挑战 3：交互复杂性
- **问题**：多种编辑模式的平滑切换
- **解决方案**：
  1. 状态机管理编辑模式
  2. 上下文感知工具切换
  3. 渐进式复杂度暴露

### 挑战 4：与 C# 版兼容
- **问题**：保持数据格式和功能兼容
- **解决方案**：
  1. 共享数据规范（OpenDRIVE）
  2. 功能对等测试
  3. 迁移工具开发

---

## 五、质量保证

### 测试策略
1. **单元测试**：算法核心逻辑
2. **集成测试**：编辑操作完整流程
3. **E2E 测试**：用户交互场景
4. **性能测试**：大数据量编辑响应

### 代码质量
1. **类型安全**：TypeScript 严格模式 + Rust 类型系统
2. **错误处理**：全面错误枚举 + 用户友好提示
3. **文档**：API 文档 + 用户指南 + 示例

### 用户体验
1. **响应式设计**：从笔记本到工作站
2. **快捷键支持**：专业用户效率
3. **自定义配置**：工具布局、快捷键、主题

---

## 六、交付物与里程碑

### 里程碑 1 (4周)
- ✅ 核心编辑框架可运行
- ✅ 基本选择的交互
- ✅ 撤销/重做功能

### 里程碑 2 (8周)
- ✅ Spline 编辑功能完整
- ✅ 道路中心线创建与编辑
- ✅ 专业编辑工具（Adjust Knots 等）

### 里程碑 3 (12周)
- ✅ 车道截面编辑完整
- ✅ OpenDRIVE 关键功能覆盖
- ✅ 交叉口编辑基础

### 里程碑 4 (16周)
- ✅ 高级编辑功能完善
- ✅ 信号灯与对象编辑
- ✅ 批量操作工具

### 里程碑 5 (20周)
- ✅ 专业工具（高程、吸附等）
- ✅ 性能优化完成
- ✅ 用户文档完善

---

## 七、资源需求

### 开发团队
- **Rust 开发** (1-2人)：核心算法、后端架构
- **前端开发** (1-2人)：UI 交互、可视化
- **测试工程师** (1人)：质量保证

### 开发环境
- **硬件**：支持 WebGPU 的 GPU（Vulkan/Metal）
- **软件**：Rust 1.70+、Node.js 18+、Tauri 2

### 文档与培训
- 内部 API 文档
- 用户操作手册
- 迁移指南（C# → Rust）

---

## 八、风险评估与缓解

### 技术风险
1. **WebGPU 兼容性**：渐进增强 + 降级方案
2. **Rust 生态成熟度**：提前技术验证 + 备用方案
3. **性能瓶颈**：早期性能 profiling + 优化策略

### 项目风险
1. **范围蔓延**：严格的需求管理 + 优先级排序
2. **资源变动**：模块化设计 + 知识共享
3. **时间压力**：增量交付 + 每周进度评审

---

## 附录：核心数据结构定义

### Action 系统结构
```rust
// we-core/src/action.rs
pub trait EditorAction: Send + Sync {
    fn id(&self) -> &str;
    fn execute(&mut self, ctx: &ActionContext) -> Result<(), ActionError>;
    fn undo(&mut self) -> Result<(), ActionError>;
    fn redo(&mut self) -> Result<(), ActionError>;
}

pub struct ActionHistory {
    undo_stack: Vec<Box<dyn EditorAction>>,
    redo_stack: Vec<Box<dyn EditorAction>>,
    max_size: usize,
}
```

### 样条编辑数据结构
```rust
// we-core/src/geometry/spline.rs
pub struct SplineKnot {
    position: [f64; 3],
    tangent_in: [f64; 3],
    tangent_out: [f64; 3],
    type: KnotType,
}

pub struct EditableSpline {
    knots: Vec<SplineKnot>,
    geoframe: GeographicFrame,
    display_color: [f32; 4],
}
```

### 车道截面数据结构
```rust
// we-core/src/model/lane_section.rs
pub struct LaneSection {
    id: String,
    s_offset: f64,
    lanes: Vec<Lane>,
    crossfall_left: Vec<f64>,
    crossfall_right: Vec<f64>,
}

pub struct Lane {
    id: i32,
    type: LaneType,
    width: Vec<f64>,
    road_mark: RoadMark,
}
```

### 交叉口数据结构
```rust
// we-core/src/model/junction.rs
pub struct Junction {
    id: String,
    connections: Vec<Connection>,
    priority: JunctionPriority,
}

pub struct Connection {
    incoming_road: String,
    connecting_road: String,
    lane_links: Vec<LaneLink>,
}
```

---

## 九、优先级划分

### 高优先级（必须实现）
1. 核心编辑框架
2. 样条基本编辑（移动、添加、删除点）
3. 撤销/重做系统
4. 基础选择系统
5. 车道基本编辑

### 中优先级（重要功能）
1. 切线编辑
2. 软选择
3. 车道截面编辑
4. 属性面板
5. 基础Gizmo控件

### 低优先级（增强功能）
1. 高级吸附系统
2. 批量操作工具
3. 高程编辑
4. 复杂交叉口编辑
5. 性能优化

---

## 十、参考文档

1. **C# 版源代码**：`/mnt/f/WorldEditor/Source/`
2. **编辑相关核心文件**：
   - `/mnt/f/WorldEditor/Source/LibEditorDataModel/Core/Framework/ActionBase.cs`
   - `/mnt/f/WorldEditor/Source/LibEditorView/ModuleRoad/Action/ContextRoad/Edit/EditKnotMouseMove.cs`
   - `/mnt/f/WorldEditor/Source/LibEditorView/ModuleShape/Action/Edit/EditableSplineBase.cs`
3. **TODO 列表**：`/mnt/f/WorldEditor/Requirements/TODO.txt`
4. **项目计划**：`/mnt/f/worldeditor-next/plan.md`
5. **UI 设计**：`/mnt/f/worldeditor-next/UI_DESIGN.md`

---

**文档创建时间**：2026-05-09 20:09  
**最后更新时间**：2026-05-09 20:09  
**创建者**：大虾 (世界编辑器 Next 项目组)