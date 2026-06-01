/**
 * WebGPU pipeline factory functions.
 * Creates render pipelines for the viewport renderer without class coupling.
 */

import { GRID_SHADER, BASIC_SHADER } from './viewportShaders';

export interface GridPipelineResult {
  pipeline: GPURenderPipeline;
  bindGroup: GPUBindGroup;
  uniformBuffer: GPUBuffer;
}

export function createGridPipeline(device: GPUDevice, format: GPUTextureFormat): GridPipelineResult {
  const shader = device.createShaderModule({ code: GRID_SHADER });

  const bindGroupLayout = device.createBindGroupLayout({
    entries: [{
      binding: 0,
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      buffer: { type: 'uniform' },
    }],
  });

  const uniformBuffer = device.createBuffer({
    size: 112,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const bindGroup = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    vertex: { module: shader, entryPoint: 'vs_main' },
    fragment: {
      module: shader,
      entryPoint: 'fs_main',
      targets: [{
        format,
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
        },
      }],
    },
    depthStencil: {
      format: 'depth32float',
      depthWriteEnabled: false,
      depthCompare: 'less-equal',
    },
    multisample: { count: 4 },
    primitive: { topology: 'triangle-list' },
  });

  return { pipeline, bindGroup, uniformBuffer };
}

export interface BasicPipelineResult {
  shaderModule: GPUShaderModule;
  pipeline: GPURenderPipeline;
  highlightPipeline: GPURenderPipeline;
  bindGroup: GPUBindGroup;
  uniformBuffer: GPUBuffer;
}

/** Standard vertex layout: 7 floats (pos3 + color4), stride 28. */
const BASIC_VERTEX_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: 28,
  attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x3' },
    { shaderLocation: 1, offset: 12, format: 'float32x4' },
  ],
};

export function createBasicPipelines(device: GPUDevice, format: GPUTextureFormat): BasicPipelineResult {
  const shaderModule = device.createShaderModule({ code: BASIC_SHADER });

  const bindGroupLayout = device.createBindGroupLayout({
    entries: [{
      binding: 0,
      visibility: GPUShaderStage.VERTEX,
      buffer: { type: 'uniform' },
    }],
  });

  const uniformBuffer = device.createBuffer({
    size: 128,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const bindGroup = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });

  const pipeline = device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: { module: shaderModule, entryPoint: 'vs_main', buffers: [BASIC_VERTEX_LAYOUT] },
    fragment: {
      module: shaderModule,
      entryPoint: 'fs_main',
      targets: [{
        format,
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
        },
      }],
    },
    depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' },
    multisample: { count: 4 },
    primitive: { topology: 'triangle-list' },
  });

  const highlightPipeline = device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: { module: shaderModule, entryPoint: 'vs_main', buffers: [BASIC_VERTEX_LAYOUT] },
    fragment: {
      module: shaderModule,
      entryPoint: 'fs_main',
      targets: [{
        format,
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
        },
      }],
    },
    depthStencil: {
      format: 'depth32float',
      depthWriteEnabled: false,
      depthCompare: 'less-equal',
      depthBias: -2,
      depthBiasSlopeScale: -2.0,
    },
    multisample: { count: 4 },
    primitive: { topology: 'triangle-list' },
  });

  return { shaderModule, pipeline, highlightPipeline, bindGroup, uniformBuffer };
}

/** Create lane line pipeline (LineVertex: 10 floats, stride 40). */
export function createLaneLinePipeline(
  device: GPUDevice, format: GPUTextureFormat, shaderModule: GPUShaderModule,
): GPURenderPipeline {
  const bindGroupLayout = device.createBindGroupLayout({
    entries: [{
      binding: 0,
      visibility: GPUShaderStage.VERTEX,
      buffer: { type: 'uniform' },
    }],
  });
  return device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    vertex: {
      module: shaderModule, entryPoint: 'vs_main',
      buffers: [{
        arrayStride: 40,
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },
          { shaderLocation: 1, offset: 12, format: 'float32x4' },
        ],
      }],
    },
    fragment: {
      module: shaderModule, entryPoint: 'fs_main',
      targets: [{ format, blend: {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
      }}],
    },
    depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' },
    multisample: { count: 4 },
    primitive: { topology: 'triangle-list' },
  });
}

/** Create billboard pipeline (BillboardVertex: 11 floats, stride 44). */
export function createBillboardPipeline(
  device: GPUDevice, format: GPUTextureFormat, shaderModule: GPUShaderModule,
): GPURenderPipeline {
  const bindGroupLayout = device.createBindGroupLayout({
    entries: [{
      binding: 0,
      visibility: GPUShaderStage.VERTEX,
      buffer: { type: 'uniform' },
    }],
  });
  return device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    vertex: {
      module: shaderModule, entryPoint: 'vs_main',
      buffers: [{
        arrayStride: 44,
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },
          { shaderLocation: 1, offset: 12, format: 'float32x4' },
        ],
      }],
    },
    fragment: {
      module: shaderModule, entryPoint: 'fs_main',
      targets: [{ format, blend: {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
      }}],
    },
    depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'less' },
    multisample: { count: 4 },
    primitive: { topology: 'triangle-list' },
  });
}
