# 3DGS 渲染实现与 SuperSplat 的技术对比

本文对比 worldeditor-next（下称"本实现"）与 SuperSplat 在 3D Gaussian Splatting 的数据格式、加载、显存布局、排序/剔除、LOD 与预算、着色上的实现差异，并给出实测数据与后续改进方向。

## 0. 依据与局限

| 来源 | 说明 |
| --- | --- |
| 本实现 | 直接阅读 `frontend/src/viewport/gaussian/`、`frontend/src/integration/`、`crates/we-core/src/pointcloud/sog.rs` |
| SuperSplat | SuperSplat 基于 PlayCanvas 引擎。其渲染行为以 PlayCanvas 官方文档为准（见文末链接），**未阅读 SuperSplat / PlayCanvas 源码**，文档未写明的内部实现不下断言 |
| 实测 | `tools/ply-to-sog/e2e`：Playwright 驱动的 Chrome（WebGPU），同一台机器（RTX 3070 8 GB，1280x720）。SuperSplat 通过 `https://superspl.at/editor?load=<url>` 加载同一份数据 |

实测的主要局限：

- SuperSplat 编辑器状态栏文本无法读取，加载耗时用"GPU 显存爬升曲线"估算，口径与本实现的 `loadMs` 不完全一致。
- SuperSplat 的帧时间被 vsync 限制在 16.7 ms，无法反映其真实 GPU 耗时；本实现的帧时间用读回栅栏（fence）测得，是真实 GPU 时间。两者**不能直接比大小**。
- 测试场景的 LOD 文件只有 LOD0，因此 SuperSplat 的 LOD 机制在该场景下没有收益。

## 1. 总览

| 维度 | 本实现 | SuperSplat（PlayCanvas） |
| --- | --- | --- |
| 数据格式 | SOG v3 / Streamed SOG（单 LOD 全量，或多 LOD 按视野流式）/ PLY | SOG v3 / Streamed SOG（含 LOD）/ PLY |
| SOG 解码 | Rust 编译为 WASM，Web Worker 池并行 | 文档未说明 |
| 显存布局 | 紧凑纹理数组（SH1 约 48 B/点）：f32 位置 + 32 位量化四元数，f16 对数尺度/不透明度/SH，按排序索引读取（无拷贝） | 先拷贝进每个相机/图层的 work buffer，再全局排序和渲染 |
| 排序 | WebGPU 计算着色器 LSD 基数排序（24 位深度键、3 趟），仅排序可见点；WebGPU 之外回退 CPU Worker 排序 | WebGPU：每帧在 GPU 上剔除并排序；WebGL：CPU Worker 排序 |
| 排序频率 | 限速，间隔由 GPU 时间戳实测的排序耗时决定（约 3.3 倍耗时，16～200 ms），期间复用旧序 | 文档称 GPU 排序"每帧"执行 |
| 剔除 | 截锥剔除（保守、像素一致）+ 屏幕大小稀疏化（交互预算） | GPU 排序渲染器在 GPU 上剔除 |
| LOD / 预算 | Streamed SOG 含多级 LOD 时按视野流式驻留（距离选 LOD、splat 预算、LIMIT/TARGET 两种模式）；另有相机移动时的"交互预算" | Streamed SOG 按距离选 LOD，受全局 splat 预算约束 |
| 多组件排序 | 场景与动态车辆分别绘制，靠遮挡深度通道处理前后关系 | 所有组件的点一起全局排序 |
| 深度缓冲 | 场景写入"不透明核心"深度，供车辆被遮挡 | splat 不写深度 |
| SOG v3 特性 | 支持 v3 的 opacity>1 "不透明核心"剖面、`antialiased` 模型、SH 到 4 阶；忽略 `2dgs`/blind | 支持 opacity>1 的"不透明核心"剖面、antialiased/2dgs 模型、blind 数据 |

## 2. 数据格式与加载

### 2.1 SOG v3

SOG 把每个 Gaussian 存成多张无损 WebP 图中同一像素位置的数据（`means_l/u`、`scales`、`quats`、`sh0`、可选 `shN_*`），位置为 16 位对数域量化，旋转为 24 位指数映射，尺度/颜色走 256 项码本，不透明度字节为 `(b/204)²`（上限 1.5625）。官方称相对 PLY 约小 15～20 倍。

本实现的解码在 `crates/we-core/src/pointcloud/sog.rs`，输出内部的打包布局 v2（f32 位置、f16 不透明度/SH），上传时再量化为紧凑 GPU 布局（见 §3.1），渲染器无需 SOG 专用路径。

与规范的差距（见 `sog.rs` 文件头注释）：

| 特性 | 规范 | 本实现 |
| --- | --- | --- |
| opacity > 1 | 推荐"不透明核心"剖面，保持总质量 | 已实现：解码保留 >1 的不透明度（上限 1.5625），着色器按规范剖面绘制 |
| `model: antialiased` | 用 Mip-Splatting 滤波替代 0.3 px² 膨胀，并按行列式缩放不透明度 | 已实现（`splatModel` 经元数据传到着色器） |
| `model: 2dgs` | 第三个尺度为零厚度轴 | 未实现，忽略 |
| SH 4 阶 | 支持 1～4 阶 | 已实现（SH4 约 48 B/点特征层） |
| blind 数据 | 应用自定义每点数据 | 未实现，忽略 |

### 2.2 Streamed SOG

`lod-meta.json` 描述空间树，叶子指向各 LOD 的分块文件。PlayCanvas 按相机距离为每个区域选择一个 LOD，并在全局 splat 预算内调整（`TARGET` 模式把预算用满；`LIMIT` 模式只在超预算时降级）。

本实现默认加载一个 LOD（LOD0），把全部分块按树序流式解码并增量上传到 GPU，不持有整份点云在 JS 内存里。这解决了"能不能装下"，但不解决"要不要全装"。

`lodStreaming` 选项（需要 GPU 排序和带多级 LOD 的 `lod-meta.json`）补上了后一半：按相机位置为每个叶子选 LOD（`floor(log2(距离/基准距离)+bias)`，距离不小于叶子对角线的 1/4），对 `bias` 二分使所需文件的 splat 总数不超过预算；被选中的文件整块解码后写入显存中的"常驻存储"（首次适配的槽位分配器，释放时合并空闲段），不再需要的单元延迟约 4 s 释放，失败的单元 5 s 后重试。多级 LOD 数据可用 `tools/ply-to-sog` 的 `--format lod --lod-levels N --lod-ratio r` 离线生成。

### 2.3 加载流水线

```mermaid
flowchart LR
  A[下载 chunk 的 meta.json 与 WebP] --> B[Worker 内 WASM 解码为打包布局]
  B --> C[Worker 内按 GPU 纹理顺序重排为分层平面]
  C -->|零拷贝转移| D[主线程: writeTexture / writeBuffer]
  D --> E[显存纹理数组]
```

要点：

- **Worker 池**：每个 worker 自带一份 WASM 实例，一次处理一个 chunk，数量为 `min(6, 逻辑核数-2)`。第一个 chunk 单独先解码，因为它决定所有 chunk 共享的渲染原点。
- **重排在 worker 内完成**：主线程只把已排好的行数据交给 `writeTexture`，行字节数是 256 的倍数时不再拷贝。
- **不可用时回退**：浏览器或 CSP 拦截 blob worker、WASM 位置未知时自动回到主线程解码。
- 解码/重排的时间不占用主线程，页面在加载期间保持响应。

### 2.4 加载实测（RTX 3070，65.9M 点，SH1）

| 阶段 | 耗时 |
| --- | --- |
| 本实现，主线程解码（优化前） | 约 43～44 s（其中解码 27.5 s、重排上传 11.8 s、等待下载 4.2 s，全部串行占用主线程） |
| 本实现，Worker 池 + 重排移入 worker | 约 13～16 s |
| SuperSplat | 编辑器就绪约 6 s（边加载边显示）；GPU 显存爬到 90% 约 81 s |

现在剩余的 13 s 主要受 GPU 上传带宽限制（约 5.3 GB 数据，主线程在 `writeTexture` 调用上耗时约 9 s），解码已不是瓶颈。

对比时注意：SuperSplat 是渐进显示，"可用"更早。本实现现在也支持 `progressive`：第一个切片上传后立即开始绘制（要求 GPU 排序，否则退回到加载完才显示），`onFirstReady` 在首次可见时触发，`onProgress` 逐块/逐切片上报；`load` 的 Promise 仍在最后一个点上传后才 resolve，轨迹回放等仍等它完成。

## 3. 显存布局

### 3.1 本实现

每个点（SH1）：

| 数据 | 大小 |
| --- | --- |
| 变换：1 层 RGBA32Uint（位置 f32 三个位 + 32 位 smallest-three 四元数） | 16 B |
| 特征：4 层 RGBA16F（4 个头元素：对数尺度 3 + 不透明度 1，再加 9 个 SH 系数，补零） | 32 B |
| **纹理合计** | **48 B/点**（原为 80 B） |
| 排序相关缓冲（顺序、位置、半径、排序键与散射缓冲等） | 约 32 B/点（未变） |

位置保持 f32，旋转/尺度为有损量化（旋转误差约 0.3°，尺度相对误差约 3e-3）；12.4M 点场景新旧布局截图的 PSNR 为 52 dB。特征层数为 `ceil((4 + 3×系数数)/4)`（SH0 为 2，SH1 为 4，SH4 为 20）。旧布局没有保留为开关。排序缓冲里的位置/半径仍是独立缓冲，改为在键计算时直接读纹理可再省约 16 B/点，尚未做。

纹理按"页"组成数组，单页点数受 `maxTextureDimension2D` 限制，不受存储缓冲绑定大小限制。

### 3.2 SuperSplat

按文档，splat 先从资源（各格式的纹理流）拷贝到每个相机/图层的 work buffer，在 work buffer 中全局排序后渲染。这带来全局排序和拷贝时修改（`setWorkBufferModifier`）等能力，代价是资源之外还需要一份 work buffer 的显存。文档没有给出每点字节数，**本文不估算**。

### 3.3 实测显存（峰值减去基线）

| 场景 | SuperSplat | 本实现 |
| --- | --- | --- |
| 65.9M 点 | 约 5.0 GiB | 约 4.5 GiB（优化前）；Worker 版本测得峰值 5.7～6.3 GiB（基线不同，增量未逐次对齐） |
| 12.4M 点 | 约 1.3 GiB（PLY 与 SOG 一致） | 约 1.3～1.4 GiB |

结论：紧凑布局后，12.4M 点场景实测显存增量由 1433 MiB 降到 1070 MiB（-25%），静止帧由 17.7 ms 降到 12.9 ms，移动帧由 18.4 ms 降到 13.0 ms，加载时间不变（约 3.3 s）。表中"本实现"为紧凑布局之前的数据；启用 LOD 流式后显存由预算而不是场景总量决定（见 §6）。

## 4. 排序与剔除

### 4.1 本实现的 GPU 排序

位于 `splatSortCompute.ts`，全部在同一个渲染命令编码器内完成：

1. **键计算**：每个点计算 24 位归一化视深度键；被截锥剔除、在相机后面或被稀疏化的点写入保留的最大键，并统计每个工作组的存活数与总数（即间接绘制的实例数）。
2. **存活数前缀和**，3. **紧凑化**：存活点的索引按原顺序连续写出（位掩码 + popcount，不用原子竞争）。
4. **尺寸计算**：由一个线程根据存活总数算出基数排序的规模。
5. **基数排序**：对存活点做 3 趟稳定的 8 位 LSD 基数排序。

之后用 `drawIndirect` 绘制，实例数来自 GPU 上的存活数。关键性质：除键计算外，排序与绘制的开销随**可见点数**而不是点云总数增长；排序结果是键的确定函数，同一相机下每帧一致，不闪烁。24 位键在 200 m 深度范围内约 6 µm 分辨率，远小于点的屏幕尺寸。

### 4.2 排序频率与陈旧窗口

本实现对排序限速（`gpuSortIntervalMs`）：间隔取 GPU 时间戳实测排序耗时的约 3.3 倍（占空比约 30%），限制在 16～200 ms；设备不支持 `timestamp-query` 时退回按点数估算（最小 50 ms）。12.4M 点实测排序约 10.5 ms，间隔约 35 ms（原为 58 ms）。两次排序之间复用上一次的顺序，并给截锥剔除加 0.25 NDC 的保护边，避免刚进入视野的点缺失。

PlayCanvas 文档称其 GPU 排序渲染器"每帧"剔除并排序。**这仍是两者的实质差异**，只是窗口缩小：

- 本实现把 GPU 排序占用控制在约 30% 的占空比，相机快速移动时画面顺序陈旧窗口约 35 ms（12.4M 点）；
- 换来的是大场景不会"GPU 全在排序"。

### 4.3 CPU 排序

WebGPU 不可用或点数不超过 16M（`CPU_SORT_MAX_SPLATS`）时，本实现保留 PlayCanvas 风格的 Worker 排序（直方图 + 基数细化）。超过 16M 的分块上传强制使用 GPU 排序。PlayCanvas 在 WebGL 上同样回退到 CPU Worker 排序，文档指出异步排序在相机快速移动时会短暂出现陈旧顺序。

## 5. 着色

本实现的着色器（`splatShader.ts`）：

- 3D 协方差由缩放和四元数重建，经透视雅可比做 EWA 投影，得到 2D 椭圆；
- 2D 协方差对角加 **0.3 px²** 低通膨胀，不对不透明度补偿；
- 次轴方差下限 0.1 px²，主/次轴半径上限 1024 px；
- 屏幕直径小于 2 px 或大于视口的点被丢弃（防止近平面雅可比爆炸产生的大色块）；
- 高斯衰减在 r²=4 处归一化，α < 1/255 丢弃，输出预乘 alpha；
着色已支持 SH 到 4 阶、opacity>1 的不透明核心剖面和 antialiased 模型。

颜色阶段曾因"动态下标的私有数组溢出到本地内存"而慢 12 倍，现已改为一组普通私有变量，5.3M 点视图的 GPU 时间从 114 ms 降到 9 ms。

与 PlayCanvas 的剩余差异：不支持 `2dgs` 模型与 blind 数据。新增的 opacity>1 与 antialiased 路径**尚未与 SuperSplat 做逐像素对比**，目前只有着色器的单元测试和 WGSL 校验。

## 6. LOD 与预算

| | 本实现 | SuperSplat |
| --- | --- | --- |
| 目的 | 在不丢点的前提下限制相机移动时的单帧成本 | 把整个场景的 splat 数控制在预算内 |
| 机制 | 相机移动时，屏幕上较小的点按 (size/τ)² 的概率保留；τ 由测得的可见点数反馈调节 | 按距离为每个区域选 LOD，整体距离因子由预算调节 |
| 静止时 | 约 350 ms 后以全精度重排 | 保持预算内的 LOD |
| 数据驻留 | 默认全部点常驻显存；开启 `lodStreaming` 后只保留预算内的 LOD 单元 | 只加载/保留所需 LOD |
| 对远处细节的影响 | 移动时稀疏，静止后恢复 | 远处用更粗的 LOD |
| 依赖 | 默认无需离线 LOD；显存级 LOD 需要多级 LOD 数据（`ply-to-sog --format lod`） | 需要 LOD 数据（可由 SplatTransform 生成） |

交互预算（`setSplatInteractiveBudget`，默认 400 万）实测：65.9M 点、约 6000 万点可见的广角视角，相机移动时单帧 GPU 时间从 2.8 s 降到 43 ms。代价是移动时远处细节变稀，停止后有一次较重的全精度重排。

显存级 LOD 现已实现（`lodStreaming`，默认关闭）。在 71c 场景（12.4M 点，4 级 LOD：12.4M / 3.7M / 1.1M / 0.34M，预算 300 万）实测：首帧可用 约 1.0 s（全量 3.4 s），显存增量约 400 MiB（全量 1070～1140 MiB），静止帧 3.3 ms（全量 13 ms），常驻 254 万 splat。与 SuperSplat 的差异：一个单元是某个 LOD 的整个 chunk 文件（整块解码、整块驻留），粒度取决于 SplatTransform 的分块；视野剔除目前仅在排序阶段做，不影响驻留选择。

## 7. 与动态车辆的合成

PlayCanvas 对所有 GSplat 组件做全局排序，splat 不写深度，因此与网格之间的前后关系需要额外手段（文档建议用网格近似写入深度）。

本实现的需求是"静态重建场景 + 动态车辆（NPC / 自车）"：

- 场景和车辆分别绘制（车辆为实例化绘制，不会随每帧车辆位置重新排序场景）；
- 场景的"不透明核心"（α 较高的点）额外写入一张深度，车辆按该深度测试，从而被建筑、树木遮挡；
- 遮挡通道只绘制 GPU 排序得到的可见列表，65.9M 点场景在 10 m 视角下从 457 ms 降到 24 ms。

代价：场景中的半透明点与车辆之间没有真正的混合排序，车辆边缘与半透明植被的交叠可能与全局排序的结果不同。

## 8. 差距与后续

五项改造的现状：

1. **显存紧凑布局**：已完成（纹理 80 → 48 B/点，显存 -25%，帧时间 -27%）。未完成：排序缓冲中的独立位置/半径缓冲（再省约 16 B/点）。
2. **区域/LOD 流式加载**：已完成（`lodStreaming`，常驻存储 + 槽位分配 + 距离选 LOD + 离线 `--format lod`）。宿主默认关闭，经 `sceneSplatLodBudget` 启用。未完成：按单个 chunk 文件的更细粒度驻留、单 SOG 的行范围解码。
3. **SOG v3 完整支持**：opacity > 1 剖面、`antialiased` 、SH 4 阶已完成；`2dgs` 与 blind 不在范围内。
4. **更高频排序**：已完成（按实测 GPU 排序耗时自适应间隔，12.4M 点从 58 ms 降到约 35 ms）。未完成：用当前计数代替全量的间接调度。
5. **加载进度可用性**：已完成（`progressive` / `onFirstReady` / `onProgress`，宿主已接入百分比提示）。未完成：单 SOG 的逐行解码（目前按切片上报，首个切片需要整个文件解码完）。

## 9. 复现

```bash
cd tools/ply-to-sog
# 本实现：流式场景，真实 GPU 帧时间（--fence 1），关闭 vsync
NO_VSYNC=1 node e2e/run.mjs --mode streamed --path <id>/lod-meta.json \
  --target <x,y,z> --frame 100 --frames 40 --fence 1 --budget 4000000
# SuperSplat
node e2e/supersplat.mjs --file <path>/sog/lod-meta.json --wait 120000
```

`--budget` 为交互预算，`--frame` 为取景距离（米），`--viewport` 可改分辨率。`run.mjs` 输出 `loadMs`、`visibleSplats`、帧时间分位数和显存；`supersplat.mjs` 输出编辑器就绪时间和显存爬升。

## 参考

- SOG v3 规范：https://developer.playcanvas.com/user-manual/gaussian-splatting/formats/sog/
- Splat 渲染架构（全局排序、work buffer）：https://developer.playcanvas.com/user-manual/gaussian-splatting/rendering-architecture/
- Work buffer 格式：https://developer.playcanvas.com/user-manual/gaussian-splatting/rendering-architecture/work-buffer-format/
- 渲染器（CPU/GPU 排序、深度缓冲）：https://developer.playcanvas.com/user-manual/gaussian-splatting/rendering-architecture/renderers/
- Streamed SOG（LOD 与预算）：https://developer.playcanvas.com/user-manual/gaussian-splatting/building/lod-streaming/
