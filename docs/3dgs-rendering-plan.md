# 完整 3DGS 渲染管线实施计划

> 状态：**完整 SH + 显式保真策略已实现**（Phase 1–8 核心链路）· 目标仓库：`worldeditor-next`（渲染引擎）+ `simone-web/WebPages`（宿主集成）
> 背景：测试资产 `data-root/assets/20003/20003.ply` 是 3D Gaussian Splatting 文件；当前引擎仅把它当作按高度着色的点云渲染。本文档规划把它升级为完整的 3DGS 渲染管线。
>
> **实现进度（2026-07-08）**：Phase 1–6 完成并通过测试。真实文件 `E:/data-root/assets/20003/20003.ply`（76561 splats, SH degree 1）端到端验证通过（9/9 检查）。
> - Phase 1 Rust：`crates/we-core/src/pointcloud/gaussian.rs`（`GaussianCloud` + PLY 解析 + transform 激活/协方差）
> - Phase 2 WASM：`crates/we-wasm/src/pointcloud.rs`（`load_gaussian_splats`/`gaussian_splat_buffer_sh`/`gaussian_splat_meta`/`free_gaussian_splats`）
> - Phase 3–5 前端：`frontend/src/viewport/gaussian/`（排序 Worker + WGSL EWA 管线 + SuperSplat 风格纹理数组资源）
> - Phase 6 SDK：`rnkNextSdk.ts` 新增 `uploadGaussianSplats`/`clearGaussianSplats`（可选方法，旧 bundle 降级）
> - **保真状态（2026-07-22）**：默认 `full` 模式不再自动降为 SH0 或抽稀。position/scale/quaternion 转置到 RGBA32F `texture_2d_array`，opacity/SH 转置到 RGBA16F `texture_2d_array`；仅全局排序索引使用 storage buffer。容量不足会返回结构化失败/回退状态。


---

## 1. 目标与范围

**目标**：把 `f_dc/f_rest`（球谐颜色）、`opacity`、`scale`、`rot` 全部解析并渲染为真正的各向异性高斯椭球，带视角相关着色和正确的 alpha 混合。

**当前实现**：

| 数据 | 现状 | 需要 |
|---|---|---|
| `f_dc_0..2` | ✅ 原始 SH 系数 | texture array |
| `f_rest_0..44` | ✅ degree 1–3 视角相关 SH | RGBA16F |
| `opacity` | ✅ sigmoid 激活 + 混合 | RGBA16F |
| `scale_0..2` | ✅ exp 激活 | RGBA32F |
| `rot_0..3` | ✅ 归一化四元数 | RGBA32F |
| 渲染 | ✅ 投影椭圆 splat + 全局排序混合 | 单次 draw |

---

## 2. 架构决策

两种主流实现路线：

| 方案 | 描述 | 取舍 |
|---|---|---|
| **A. 实例化四边形 EWA splatting + Worker 排序**（推荐）| 每个高斯 = 1 个屏幕空间 billboard 四边形，顶点着色器投影 3D→2D 协方差，片元按高斯衰减混合；CPU Worker 基数排序 | 成熟（antimatter15/splat、PlayCanvas、three.js），复杂度可控，够编辑器预览 |
| B. 瓦片化 compute 光栅器 | 参考 CUDA 光栅器的 WebGPU 移植：compute 排序 + tile binning + 逐瓦片混合 | 质量/性能最高，但极复杂，对编辑器预览过度设计 |

**采用方案 A。**

**核心技术选择**：

- 高斯属性存入分页 **texture array**：3 层/page RGBA32F transform + 1/4/7/13 层/page RGBA16F opacity/SH（SH0/1/2/3）；每帧只重写**一个全局排序索引缓冲**（`u32×N`）。
- 顶点着色器：`instance_index → sortedIndex → (x,y,page)`，按属性层读取，逐帧计算 2D 投影 + SH；全云仍为一次 draw，保持全局混合顺序。
- 仅当纹理数组 API/容量不可用且完整数据能装入单 packed storage binding 时，使用明确上报的兼容回退。`full` 模式不能静默减少 SH 或数量；`decimated` 模式才按质量/采样/容量缩减。
- 排序在 **Web Worker**（复用现有 `workerRenderBuffer7` 的 worker 基础设施），相机移动超阈值才重排。

---

## 3. 3DGS 渲染数学（片元级）

**3D 协方差**（世界空间）：

$$\Sigma = R\,S\,S^\top R^\top,\quad S=\mathrm{diag}(e^{s_0},e^{s_1},e^{s_2}),\ R=\text{quat2mat}(\text{normalize}(q))$$

**投影到 2D**（相机空间均值 $t=W\mu$，$W$=view）：

$$J=\begin{bmatrix} f_x/t_z & 0 & -f_x t_x/t_z^2 \\ 0 & f_y/t_z & -f_y t_y/t_z^2 \end{bmatrix},\quad \Sigma' = J\,W_{3\times3}\,\Sigma\,W_{3\times3}^\top J^\top + \begin{bmatrix}0.3&0\\0&0.3\end{bmatrix}$$

（对角项 +0.3 做抗锯齿膨胀，保证 ≥1px）

**Conic 与衰减**：$\text{conic}=\Sigma'^{-1}$，片元 $\alpha=\text{opacity}\cdot\exp(-\tfrac12 d^\top\text{conic}\,d)$，四边形半径取 $\sim3\sqrt{\lambda_{\max}}$。

**视角相关 SH**（方向 $\hat d=\text{normalize}(\mu-\text{camPos})$）：

$$c = \text{SH}_0 f_{dc} + \sum_{l\ge1}\text{basis}_l(\hat d)\,f_{rest} + 0.5,\quad c=\max(c,0)$$

其中 $\text{SH}_0 = \tfrac{1}{2\sqrt{\pi}} \approx 0.28209479$。

**混合**：后到前排序，预乘 alpha，`src=one, dst=one-minus-src-alpha`。

**深度交互**（与路面共存）：splat 在不透明几何之后绘制，`depthCompare: greater`（现有 reverse-Z），`depthWriteEnabled: false`（splat 之间靠排序，不写深度；但被不透明几何正确遮挡）。

---

## 4. 分阶段实施计划

### Phase 0 — 技术验证（spike）

- 用一个已知 splat 文件，在独立 WebGPU demo 里验证"实例四边形 + 单帧 CPU 排序 + band-0 混合"能出正确画面。
- **产出**：确认 MSAA(count=4) 下 splat 混合可接受，或决定改用独立非 MSAA 目标 + 合成。

### Phase 1 — Rust：解析并保留完整 splat 属性

文件：`crates/we-core/src/pointcloud/ply.rs`、`model.rs`、新增 `gaussian.rs`

- 新增 `GaussianCloud` 模型：`positions, sh_coeffs(展平, sh_degree), opacity, scale, rotation`。
- PLY 解析：识别 `f_dc_*`、`f_rest_*`（按数量推断 SH degree）、`opacity`、`scale_*`、`rot_*`。
- 激活：`opacity=sigmoid`、`scale=exp`、`rot=normalize`。
- 保留 6-float 预计算协方差供领域 API 使用；GPU 主路径传递 f32 scale/rotation，并在 WGSL 重建协方差。
- **测试**：Rust 单测——解析属性数量、SH degree 推断、协方差正确性、sigmoid/exp 激活、极小 scale 与四元数归一化。

### Phase 2 — WASM 绑定

文件：`crates/we-wasm/src/pointcloud.rs`

- `load_gaussian_splats(bytes) -> handle`
- `gaussian_splat_buffer_sh(handle) -> Uint32Array`（布局 v2，f32 transform + f16 opacity/SH，见 §5）
- `gaussian_splat_meta(handle) -> {count, shDegree, shStride, layoutVersion, layoutName, origin, min, max}`
- `free_gaussian_splats(handle)`
- 复用现有 origin 平移精度处理；深度排序位置由前端从 SH buffer 首三分量抽取（无需单独 positions 导出）。
- **测试**：`wasm-pack test` 往返一致性。

### Phase 3 — 深度排序（Worker）

文件：新增 `frontend/src/viewport/gaussian/sortWorker.ts`

- 输入：splat 位置数组（一次性）、每帧 camPos+viewDir。
- 深度 = `dot(viewDir, μ-camPos)`；16-bit 计数/基数排序（antimatter15 方案）。
- 输出：`Uint32Array` 排序索引（transferable）。
- 相机移动 < 阈值时跳过重排。
- **测试**：排序单调性、边界（0/1 splat）。

### Phase 4 — WebGPU splat 管线

文件：`frontend/src/viewport/pipelineFactory.ts`（新增内联 WGSL + `createGaussianSplatPipeline`）

- 新 bind group：相机 uniform（viewProj, camPos, focal, viewport, shDegree）+ splat storage buffer。
- 顶点着色器：`instance_index → sortedIndex`，读 storage，算 2D conic + SH 颜色，输出四边形角 + conic + 预乘色。
- 片元着色器：高斯衰减 × opacity，预乘 alpha 输出。
- pipeline：blend 预乘 over，`depth32float / greater / write=false`，MSAA 对齐主目标，四边形 triangle-strip 实例化。
- **测试**：pipeline 创建冒烟测试（复用现有 `renderer.test.ts` 模式）。

### Phase 5 — 渲染器集成

文件：`frontend/src/viewport/renderer.ts`、`rendererFrame.ts`

- 复用已加的**独立缓冲**模式（`actorPointCloudMeshes` 的思路）：新增 `gaussianSplatBuffer/count/sortedIndexBuffer/bindGroup`。
- `uploadGaussianSplats(buffer, shDegree, layoutVersion)` / `updateSplatOrder(indices)` / `clearGaussianSplats()`。
- 渲染 pass：**在不透明几何之后**绘制 splat（`RendererFrameInternals` 加字段 + draw 分支）。
- 相机移动时触发 worker 重排 → `updateSplatOrder`。
- `captureFrame` 复用同 pass → 缩略图自动覆盖。

### Phase 6 — SDK 桥接 + WebPages 集成

文件：`frontend/src/integration/rnkNextSdk.ts`、WebPages `sdk.ts`/`types.ts`/`WorldEditorNextEngine.ts`/`engineConfig.ts`/`Scene3DController.tsx`

- SDK：`uploadGaussianSplats/clearGaussianSplats`（可选方法，旧 bundle 降级）。
- engineConfig：`npcRenderMode: "box" | "points" | "splat"`。
- Scene3DController：NPC 的 `.ply` 走 splat 路径（fetch → `load_gaussian_splats` → 上传 + 排序）。
- 独立 app：点云查看器 color mode 之外加 "splat" 模式（默认 elevation 需切换）。

### Phase 7 — 视角相关高阶 SH（已实现）

- 顶点着色器实现 degree 1–3 SH 求值。
- `full` 模式保留请求 SH；不再按容量自动降为 SH0。显式 `decimated` 仅减少 splat，不改变 SH。

### Phase 8 — LOD / 抽稀 / 性能

- 按屏幕投影面积/距离剔除微小 splat；splat 数超预算时按 opacity×size 抽稀（复用 `maxPointsPerActor` 思路）。
- 多 NPC：每个模型独立 storage buffer + 独立排序，或合并 + 全局排序。

---

## 5. 输入布局与 GPU 纹理数组

**当前布局 v2：`transform-f32-opacity-sh-f16`**

| 字段 | 类型 | 字节 |
|---|---|---|
| position | 3×f32 | 12 |
| activated scale | 3×f32 | 12 |
| normalized quaternion `(w,x,y,z)` | 4×f32 | 16 |
| opacity | 1×f16 | 2 |
| raw SH（coeff-major RGB） | `(degree+1)²×3×f16` | degree 相关 |

每条记录为 10 个 f32/u32 字后接 `opacity, SH...` 的 f16 pair（奇数 half 补零）。
SH degree 0/1/2/3 的 stride 分别为 12/17/24/35 个 u32，即 48/68/96/140 B。
shader 根据 scale/quaternion 重建 `Σ = R diag(scale²) Rᵀ`，避免 scale 平方后再压成 f16 的下溢。

元数据必须声明 `layoutVersion=2`；旧的隐式 f16-covariance 布局或错误 stride 会被拒绝，不能静默解码。
上传时按 splat 索引分页：`x=i%width`、`y=(i%pageCapacity)/width`、`page=i/pageCapacity`。每页 transform 占 3 个 RGBA32F array layer，feature 占 `ceil((1+3(degree+1)²)/4)` 个 RGBA16F layer。上传逐行填充，`bytesPerRow` 对齐 256 字节并遵守 `queue.writeTexture` 范围；设备的 `maxTextureDimension2D`、`maxTextureArrayLayers` 决定容量。

排序只保留一个 `u32 × N` storage buffer，同时检查 `maxBufferSize` 与 `maxStorageBufferBindingSize`。因此一次 draw 的全局后到前顺序不被资源分页破坏。

---

## 6. 测试策略

- **Rust 单测**：属性解析、SH degree 推断、激活函数、协方差、往返。
- **WASM 测试**：`wasm-pack test` 缓冲一致性。
- **Worker 单测**：排序正确性/单调性/边界。
- **管线冒烟测试**：pipeline 创建（headless 或 mock device）。
- **视觉回归**：已加入程序生成的
  `tests/fixtures/gaussian/anisotropic-sh0.ply`，并由 Playwright 在真实
  WebGPU 画布中校验各向异性覆盖、SH0 色彩和完整上传状态。Windows
  Chromium 基线固定为 `gaussian-anisotropic-sh0-chromium-win32.png`。
- **性能基准**：1M splat 的排序耗时 + 帧时间。

---

## 7. 性能预算与风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 百万级 splat 内存 | 140MB+（SH3） | opacity/SH f16、显式 decimated 模式 |
| 每帧 CPU 排序 | 卡顿 | Worker + 移动阈值重排；默认限制为 30 FPS 且静止时保证最终排序；后期 GPU 基数排序 |
| MSAA 下 splat 混合 | 边缘质量/性能 | 独立非 MSAA float 目标 + 合成 |
| reverse-Z 深度交互 | splat 与路面遮挡错误 | `greater` + `write=false`，Phase 0 验证 |
| 纹理数组不可用/层数不足 | 无法走默认高保真路径 | 明确 packed 兼容回退（仅容量完整时）或结构化失败；UI/SDK 展示原因 |
| 全 SH 带宽 | 帧率 | 用户显式选择 `decimated`，不静默降低 SH |

---

## 8. 出货流程（每次 Rust/WASM 改动后）

沿用已验证的链路：

1. `wasm-pack build crates/we-wasm --target web --out-dir ../../frontend/wasm/pkg --release`
2. `vite build --config vite.rnk-next.config.ts`
3. 拷贝 `dist-rnk/worldeditor-next-sdk.js` + `wasm/pkg/we_wasm_bg.wasm` → `WebPages/src/vendor/we-next/`
4. WebPages `tsc` + 语法/wasm magic 校验

---

## 9. 里程碑排序

```mermaid
graph LR
  P0[Phase 0 验证] --> P1[Phase 1 Rust解析]
  P1 --> P2[Phase 2 WASM]
  P2 --> P4[Phase 4 管线]
  P3[Phase 3 排序Worker] --> P5
  P4 --> P5[Phase 5 渲染器集成]
  P5 --> P6[Phase 6 WebPages集成]
  P6 --> M1{{里程碑1: band-0 splat 可见}}
  M1 --> P7[Phase 7 高阶SH]
  P7 --> P8[Phase 8 LOD/性能]
  P8 --> M2{{里程碑2: 完整3DGS}}
```

- **里程碑 1（band-0 splat）**：Phase 0–6 完成 → 正确椭球形状 + 基础颜色 + 混合，已远超当前点云。
- **里程碑 2（完整 3DGS）**：+ Phase 7–8 → 视角相关着色 + LOD，达到图一级别。

---

## 附录 A — 关键代码位置参考

| 组件 | 文件 |
|---|---|
| PLY 解析器 | `crates/we-core/src/pointcloud/ply.rs` |
| 点云模型 | `crates/we-core/src/pointcloud/model.rs` |
| 渲染缓冲构建 | `crates/we-core/src/pointcloud/render.rs` |
| WASM 绑定 | `crates/we-wasm/src/pointcloud.rs` |
| 管线工厂（内联 WGSL）| `frontend/src/viewport/pipelineFactory.ts` |
| 渲染器 | `frontend/src/viewport/renderer.ts` |
| 渲染 pass | `frontend/src/viewport/rendererFrame.ts` |
| SDK 桥接 | `frontend/src/integration/rnkNextSdk.ts` |
| 宿主引擎适配 | `WebPages/src/utils/rnk-next/WorldEditorNextEngine.ts` |
| 宿主 3D 场景控制器 | `WebPages/src/views/CaseEdit/MarkerLayer/Scene3D/Scene3DController.tsx` |

## 附录 B — 现有基础（已完成，可复用）

- 独立 actor 点云 GPU 缓冲（`actorPointCloudMeshes`）——splat 缓冲可沿用同模式。
- PLY 的 `f_dc` → band-0 RGB 解码（`sh_dc_to_u8`）——Phase 1 保留 SH 系数的前置。
- origin 平移精度处理（大坐标 → f64 保精度后偏移）。
- WASM/bundle 重建 + 向 WebPages re-vendor 的完整链路。
