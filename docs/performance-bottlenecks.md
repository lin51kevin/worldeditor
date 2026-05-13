# WorldEditor Next 性能瓶颈诊断报告

> 生成时间: 2026-05-13  
> 适用版本: 重构后代码库 (commit 104081d 及之后)

---

## 概述

本报告基于对 WorldEditor Next 代码库的全面审查，识别出影响运行时性能的关键瓶颈。代码近期经历了大规模重构，在**代码组织、可维护性、模块化**方面显著改善，但**核心运行时性能问题未发生变化**。

### 重构变化总览

| 组件 | 重构前 | 重构后 | 改善 |
|------|--------|--------|------|
| `editorStore.ts` | 1115 行 | 拆为 `slices/` (5 个 slice) | ✅ 架构清晰 |
| `Viewport.tsx` | 1557 行 | 901 行 | ✅ 提取 5 个 hooks |
| `renderer.ts` | 1568 行 | 786 行 | ✅ 提取 controller/factory/builder |
| Rust `eval.rs` | 单文件 | line/arc/spiral_eval 三模块 | ✅ 职责分离 |
| `opendrive/parser.rs` | 单文件 | parser/ 子目录 (9 文件) | ✅ 模块化 |
| `spline.rs` | 单文件 | spline/ 子目录 | ✅ 类型分离 |
| `road_ops.rs` | 单文件 | split/weld 子模块 | ✅ 功能分离 |
| `we-wasm/src/render/` | 单文件 | 4 个子模块 | ✅ 渲染分层 |

---

## 🚨 P0 - 严重瓶颈（需优先处理）

### 1. `pushUndo()` 全量深拷贝

**位置**: `frontend/src/stores/slices/types.ts`

```typescript
export function pushUndo(state: EditorState): Partial<EditorState> {
  const undoStack = [...state.undoStack, structuredClone(state.project)].slice(-MAX_UNDO);
  return { undoStack, redoStack: [] };
}
```

**问题**:
- 每次编辑操作（移动道路、添加标线、修改宽度等）都触发 `structuredClone(state.project)`
- Project 包含所有 roads[]、junctions[]、signals[]、objects[]、lanes[]
- 大型 OpenDRIVE 场景可能有数百条道路，每条含大量车道/标线数据
- **拖拽移动道路时，每帧 1 次深拷贝**（60fps = 每秒 60 次完整 project 深拷贝）
- 50 步 undo 栈 = 最多 50 份 project 副本常驻内存

**影响**: 大场景编辑操作时明显卡顿，拖拽不流畅

**建议方案**:
1. **Command Pattern** (推荐): 只存操作描述（如 `{type: 'moveRoad', roadId: '1', dx: 5, dy: 3}`），undo 时反向执行
2. **Structural Sharing**: 使用 Immer (`use-immer`) 替代手动展开，共享未修改的子树引用
3. **分层 Undo**: 道路级别变化只深拷贝 roads[]，信号变化只深拷贝 signals[]

**优先级**: 🔴 最高 - 影响所有编辑操作的即时体验

---

### 2. `updateMesh` 全量重生成

**位置**: `frontend/src/components/Viewport.tsx`

```typescript
const updateMesh = useCallback(async () => {
  const [roadVerts, junctionVerts, laneLineVerts, centerLineVerts, signalVerts, objectVerts] =
    await Promise.all([
      service.generateRoadVertices(visibleProject, 2.0, display.colorMode),
      service.generateJunctionVertices(visibleProject),
      service.generateLaneLineVertices(visibleProject, 2.0),
      service.generateCenterLineVertices(visibleProject, 2.0),
      service.generateSignalPaintVertices(visibleProject, 2.0),
      service.generateObjectVertices(visibleProject),
    ]);
  // ... merge and upload
}, [project, status, display.*]);
```

**问题**:
- `project` 变化 → 6 个 WASM 函数并行调用，全量生成所有道路/路口/标线/信号/物体的顶点
- **改一条道路的名字，500 条道路全部重新生成顶点**
- `display.hiddenRoadIds` / `display.hiddenJunctionIds` 变化也触发全量重生成（切换图层可见性）
- 大场景（100+ 道路）时，每次操作都有明显延迟

**影响**: 任何 project 变化都导致全场景重绘，大场景下操作响应慢

**建议方案**:
1. **增量更新**: 维护 `dirtyRoadIds: Set<string>`，只重新生成变化的道路
2. **道路级缓存**: `Map<roadId, GPUBuffer>`，缓存每个道路的顶点 buffer
3. **按需合并**: 预分配大 staging buffer，只覆写变化部分

**优先级**: 🔴 最高 - 大场景核心性能瓶颈

---

### 3. GPU Buffer 反复创建/销毁

**位置**: `frontend/src/viewport/renderer.ts`

```typescript
uploadRoadVertices(vertexData: Float32Array): void {
  for (const m of this.meshes) { m.vertexBuffer.destroy(); }
  this.meshes = [];
  
  const buffer = this.device.createBuffer({
    size: vertexData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  // ... upload and push
}
```

**问题**:
- 每次 `updateMesh` = 旧 GPU buffer 销毁 + 新 buffer 创建 + 全量数据上传
- 大场景 10MB+ 顶点数据，频繁创建/销毁触发 GPU driver 开销
- 无 buffer 复用机制

**影响**: GPU 内存碎片化，driver overhead，低端设备更明显

**建议方案**:
1. **Buffer Pool**: 预分配大 buffer（`COPY_DST`），用 `writeBuffer` 增量更新
2. **粒度管理**: 按道路粒度管理 buffer，只更新变化的道路
3. **容量预留**: 分配 2x 当前容量，减少扩容频率

**优先级**: 🔴 高 - GPU 资源管理基础优化

---

## ⚠️ P1 - 中等瓶颈（大场景/高频交互时明显）

### 4. Picking 遍历全部道路

**位置**: `crates/we-core/src/picking.rs`

```rust
pub fn pick_road(project: &Project, x: f64, y: f64, threshold: f64) -> Option<PickResult> {
    for road in &project.roads {
        if road.render_hidden { continue; }
        if let Some(result) = distance_to_road(road, x, y) { ... }
    }
}
```

**问题**:
- `spatial_index.rs` 存在但 **picking 完全没有使用它**
- 每次鼠标点击都遍历全部道路
- `pick_lane` 更严重：对每条道路 → 每个 section → 每个 lane → 每个采样点计算距离

**影响**: 大场景（500+ 道路）时鼠标拾取有明显延迟

**建议方案**:
- `spatial_index.query_point(x, y, threshold)` 预筛选候选道路
- 只在候选道路上做精细 lane 拾取

**优先级**: 🟡 中高 - 交互响应关键路径

---

### 5. Snapping 遍历全部道路

**位置**: `crates/we-core/src/snapping.rs`

```rust
fn snap_to_endpoint(...) -> Option<SnapResult> {
    for road in &project.roads {
        let endpoints = get_road_endpoints(road); // 每次都 sample_road_reference_line
        // ...
    }
}
```

**问题**:
- 绘制新道路时，鼠标每移动一帧 → `snap_point` → 遍历全部道路
- `get_road_endpoints` 每次调用 `sample_road_reference_line(road, road.length)` 生成全量参考线，只为取首尾两点

**影响**: 绘制道路时鼠标卡顿，尤其大场景

**建议方案**:
1. 缓存端点列表（`HashMap<roadId, (Point, Point)>`），project 变化时更新
2. 使用 `SpatialIndex` 预过滤
3. `get_road_endpoints` 改为直接从 `plan_view[0]` 和 `plan_view.last()` 计算

**优先级**: 🟡 中 - 绘图模式关键路径

---

### 6. 选中高亮重新生成 Mesh

**位置**: `frontend/src/components/Viewport.tsx` - 选择变化 useEffect

```typescript
const highlightVerts = await service.generateRoadVertices(highlightProject, 2.0);
renderer.uploadHighlightVertices(tintVertices(highlightVerts, color));
```

**问题**:
- 切换选中 = 调用 WASM 生成高亮 mesh → 逐顶点修改颜色 → 上传 GPU
- 框选多条道路时循环调用
- tintVertices 是 JS 逐顶点遍历修改（O(n)）

**影响**: 选择切换有延迟，多选时更慢

**建议方案**:
1. **Stencil Mask**: 用 stencil buffer 标记选中道路，shader 直接改变颜色
2. **Offset 索引**: 上传主 mesh 时存储每条道路的 `bufferOffset + vertexCount`，高亮时用 uniform 颜色

**优先级**: 🟡 中 - 常用交互操作

---

### 7. SpatialIndex 去重用 Vec::contains O(n)

**位置**: `crates/we-core/src/spatial_index.rs`

```rust
let mut seen = Vec::new();
if seen.contains(&idx) { continue; } // O(n)
seen.push(idx);
```

**问题**: query_range 中元素去重用 `Vec::contains()`，每次查询都是 O(n²)

**建议**: 改为 `HashSet<usize>`，O(1) 去重

**优先级**: 🟢 低 - easy win

---

## 📝 P2 - 架构级建议（为未来大规模场景准备）

### 8. 缺少 Entity-Component 缓存层

当前每次都从 JSON/TS 对象重新计算。建议建立 lazy cache:

```typescript
interface ProjectCache {
  refLines: Map<string, RefLinePoint[]>;      // 参考线采样结果
  aabbs: Map<string, Aabb>;                   // 道路 AABB
  endpoints: Map<string, [Point, Point]>;     // 端点缓存
  spatialIndex: SpatialIndex;                 // 空间索引
}
```

在 project 结构变化时失效相关缓存。

### 9. 缺少 Frustum Culling

当前所有 mesh 每帧都绘制，无视锥体裁剪。大场景中视口外道路仍参与 draw call。

**建议**: 为每条道路存储 AABB，每帧检查视锥体内，跳过不可见。

### 10. WASM ↔ JS 通信开销

每次 `updateMesh` 6 次 WASM 调用，每次都序列化整个 project JSON:
- `generateRoadVertices(visibleProject, ...)` → project 通过 JSON 传入
- 6 次调用 = 6 次 JSON 序列化 + 6 次 Float32Array 返回

**建议**:
- 一次性传入 project，WASM 端合并生成所有顶点，单次返回
- 或使用 SharedArrayBuffer + postMessage 避免 JSON

---

## 📊 重构前后对比

| 问题 | 重构前 | 重构后 | 备注 |
|------|--------|--------|------|
| `structuredClone` 全量深拷贝 | ❌ 存在 | ❌ 仍存在 | 拆到 types.ts，逻辑未变 |
| 全量 mesh 重生成 | ❌ 存在 | ❌ 仍存在 | updateMesh 模式未变 |
| GPU buffer 反复创建/销毁 | ❌ 存在 | ❌ 仍存在 | uploadRoadVertices 策略未变 |
| picking 遍历全部道路 | ❌ 存在 | ❌ 仍存在 | 未使用 spatial_index |
| snapping 遍历全部道路 | ❌ 存在 | ❌ 仍存在 | 未优化 |
| query_range Vec.contains | ❌ 存在 | ❌ 仍存在 | 应改 HashSet |
| 代码可维护性 | ⚠️ 1500+ 行 | ✅ 清晰模块化 | **大幅改善** |
| 架构分层 | ⚠️ 混杂 | ✅ 职责清晰 | **大幅改善** |

---

## 🎯 建议优化顺序

| 优先级 | 问题 | 预期收益 | 工作量 | 风险 |
|--------|------|---------|--------|------|
| **1** | pushUndo → Immer/Command | 拖拽帧率 3-10x | 中 | 低 |
| **2** | updateMesh 增量更新 | 大场景延迟 5-20x | 高 | 中 |
| **3** | picking/snapping + SpatialIndex | 鼠标响应 10-50x | 低 | 低 |
| **4** | GPU Buffer Pool | 减少 driver 开销 | 中 | 低 |
| **5** | 高亮改 stencil/uniform | 选择切换即时 | 中 | 中 |
| **6** | Frustum Culling | 大场景帧率 2-5x | 中 | 中 |
| **7** | WASM 单次调用合并 | 减少序列化 | 低 | 低 |

---

## 💡 实施建议

### 短期（本周）
1. 用 Immer 替换 `pushUndo` 中的 `structuredClone`（1-2 天）
2. picking/snapping 接入 SpatialIndex（1 天）
3. spatial_index 去重改 HashSet（30 分钟）

### 中期（本月）
4. updateMesh 增量更新 + 道路级缓存（1-2 周）
5. GPU Buffer Pool（3-5 天）

### 长期（下季度）
6. Command Pattern 完整 undo 系统（2-3 周）
7. Frustum Culling + LOD（2 周）

---

## 附录：关键文件清单

| 文件 | 行数 | 负责瓶颈 |
|------|------|---------|
| `frontend/src/stores/slices/types.ts` | ~200 | pushUndo structuredClone |
| `frontend/src/components/Viewport.tsx` | 901 | updateMesh 全量重生成 |
| `frontend/src/viewport/renderer.ts` | 786 | GPU buffer 管理 |
| `crates/we-core/src/picking.rs` | 405 | picking 遍历 |
| `crates/we-core/src/snapping.rs` | 389 | snapping 遍历 |
| `crates/we-core/src/spatial_index.rs` | 362 | 去重 O(n) |
