# XODR 解析一致性对比 — 操作指南

本文档说明如何使用 XODR 解析一致性对比框架，验证 WorldEditor-Next (Rust) 与 WorldEditorOnline (TS) 的解析结果是否一致。

## 快速开始

```bash
# 运行全部对比测试
cargo test --package we-core --test xodr_comparison -- --nocapture

# 运行单个文件对比
cargo test --package we-core --test xodr_comparison compare_highway -- --nocapture
cargo test --package we-core --test xodr_comparison compare_junction_crosswalk_signal -- --nocapture
cargo test --package we-core --test xodr_comparison compare_parkinglot -- --nocapture
```

`--nocapture` 参数会打印详细的对比报告，包含每个字段的匹配/差异信息。

## 文件结构

```
crates/we-core/tests/
├── baseline_model.rs          # Baseline JSON 反序列化模型
└── xodr_comparison.rs         # 对比测试逻辑 + 测试用例

tests/fixtures/xodr/
├── highway.xodr               # 源 XODR 文件
├── junction_crosswalk_signal.xodr
├── parkinglot.xodr
└── baseline/                  # WorldEditorOnline 导出的 baseline JSON
    ├── highway.baseline.json
    ├── junction_crosswalk_signal.baseline.json
    └── parkinglot.baseline.json
```

## 添加新的对比文件

### 第 1 步：导出 Baseline JSON

在 WorldEditorOnline 浏览器中打开目标 `.xodr` 文件，然后在控制台执行：

```javascript
// 方法 1：复制到剪贴板
copy(JSON.stringify(Editor.Instance.roadNetwork.toJson(), null, 2));

// 方法 2：下载为文件
const blob = new Blob(
  [JSON.stringify(Editor.Instance.roadNetwork.toJson(), null, 2)],
  { type: 'application/json' }
);
const a = document.createElement('a');
a.href = URL.createObjectURL(blob);
a.download = 'my_file.baseline.json';
a.click();
```

将导出的 JSON 保存到 `tests/fixtures/xodr/baseline/<name>.baseline.json`。

### 第 2 步：确保 XODR 源文件存在

将对应的 `.xodr` 文件放到 `tests/fixtures/xodr/<name>.xodr`。

### 第 3 步：添加测试用例

在 `crates/we-core/tests/xodr_comparison.rs` 底部添加新测试：

```rust
#[test]
fn compare_my_new_file() {
    let xodr = include_str!("../../../tests/fixtures/xodr/my_new_file.xodr");
    let baseline =
        include_str!("../../../tests/fixtures/xodr/baseline/my_new_file.baseline.json");

    let ctx = run_comparison(xodr, baseline, "my_new_file");

    println!(
        "Summary: {} passed, {} diffs",
        ctx.passed.len(),
        ctx.diffs.len()
    );

    // 硬断言：道路数量必须一致
    let project = parse_xodr(xodr).unwrap();
    let baseline_data: BaselineNetwork = serde_json::from_str(baseline).unwrap();
    assert_eq!(
        project.roads.len(),
        baseline_data.roads.len(),
        "Road count must match"
    );
}
```

> **注意**：如果 WorldEditorOnline 会生成源 XODR 中不存在的虚拟道路（如 parkinglot），
> 需要将 `assert_eq!` 改为 `assert!(project.roads.len() <= baseline_data.roads.len())`。

## 对比报告解读

运行测试后，输出格式如下：

```
============================================================
Comparison Report: junction_crosswalk_signal
============================================================
Passed: 731 fields
Failed: 28 fields

Differences:
  ✗ roads[268].signals[176].is_dynamic | baseline=true | ours=false | Signal dynamic flag
  ✗ roads[4].objects[17].corners.count | baseline=5 | ours=4 | Corner count
```

- **Passed**: 两端数据一致的字段数量
- **Failed**: 存在差异的字段数量
- **每行差异**：字段路径 | baseline 值 | 我们的值 | 说明

## 对比范围

当前框架对比以下维度：

| 维度 | 对比字段 | 容差 |
|------|----------|------|
| **Road** | id, name, junction_id, length, signal/object/lane count | length: ±0.5m |
| **Signal** | id, s, t, z_offset, h_offset, width, height, type, orientation, is_dynamic | 坐标: ±1e-3 |
| **Object** | id, type, s, t, z_offset, hdg, width, height, corner count | 坐标: ±1e-3 |
| **Junction** | id, connection count, contact_point, lane_links | 精确匹配 |
| **Lane** | lane_section count | 精确匹配 |

## 已知差异

以下差异是两个系统的设计差异，**不是 bug**：

### 1. `is_dynamic` 标志不一致

WorldEditorOnline 将道路标线类信号（箭头、斑马线等）的 `dynamic` 设为 `1`，
而 XODR 原文中这些信号的 `dynamic="no"`。我们的解析器忠实于 XODR 原文。

**影响**：junction_crosswalk_signal 中 24 个 signal 的 dynamic 标志不同。

### 2. 角点数量差 1

我们的解析器会移除闭合多边形的重复首尾顶点（normalize），baseline 保留了 5 个点（含重复）。

**影响**：crosswalk 对象的 `corners.count` 为 4 vs 5。

### 3. 生成道路

WorldEditorOnline 在解析后会生成额外的连接道路（如 parkinglot 从 15 条增至 150 条），
这些道路不在 XODR 源文件中。

## 字段映射参考

WorldEditorOnline 与 WorldEditor-Next 的数据结构差异映射：

### Road

| WorldEditorOnline | WorldEditor-Next | 说明 |
|---|---|---|
| `id` (number) | `id` (string) | ID 类型不同，对比时转字符串 |
| `name` | `name` | 直接对比 |
| `junctionId` (-1=无) | `junction_id` (None=无) | -1 映射为 None |
| `knots[last].s` | `length` | 长度从 knots 末尾 s 值计算 |
| `knots[]` | `plan_view[]` | 几何表示完全不同（控制点 vs 参数几何） |
| `leftLaneSections` + `rightLaneSections` | `lane_sections[]` | 合并为统一结构 |
| `roadSignals[]` | `signals[]` | 字段名不同 |
| `roadObjects[]` | `objects[]` | 字段名不同 |
| `predecessor` / `successor` | `link` | 链接结构不同 |

### Signal

| WorldEditorOnline | WorldEditor-Next | 说明 |
|---|---|---|
| `orientation` (0/1/-1) | `orientation` ("+"/"-"/"none") | 数值 vs 字符串 |
| `dynamic` (0/1) | `is_dynamic` (bool) | 数值 vs 布尔 |
| `type` | `signal_type` | 字段名不同 |
| `subtype` (可能为 0) | `signal_subtype` | 0 映射为空字符串 |
| `country` (可能为 0) | `country` | 0 映射为空字符串 |

### Object

| WorldEditorOnline | WorldEditor-Next | 说明 |
|---|---|---|
| `type` (小写) | `object_type` (ObjectType 枚举) | 枚举转小写对比 |
| `cornerKnots[].position` | `corners[]` (Point3D) | 世界坐标 vs 局部坐标 |
| `orientation` (0/-1) | `orientation` (0.0/180.0) | 数值含义不同 |
| `isCrosswalk` / `isStopLine` | 通过 `object_type` 枚举区分 | 布尔标志 vs 枚举 |

### Junction

| WorldEditorOnline | WorldEditor-Next | 说明 |
|---|---|---|
| `connections[].contactPoint` (0/1) | `contact_point` (Start/End) | 数值 vs 枚举 |
| `connections[].incomingRoadId` | `incoming_road` (String) | 类型不同 |
| `connections[].connectingRoadId` | `connecting_road` (String) | 类型不同 |
| `connections[].laneLinks[].fromLaneId` | `lane_links[].from` | 字段名不同 |

## 扩展对比维度

如需添加新的对比维度（如高程、车道宽度等），修改 `xodr_comparison.rs`：

1. 在 `ComparisonContext` 中使用现有的 `assert_eq` / `assert_f64_near` / `assert_count` 方法
2. 在对应的 `compare_*` 函数中添加新字段对比
3. 如需新的 baseline 字段，在 `baseline_model.rs` 中添加对应的 `Deserialize` 字段
