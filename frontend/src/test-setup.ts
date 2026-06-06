import '@testing-library/jest-dom';
import i18n from './i18n';

// Force Chinese locale in tests so text assertions match zh translations
void i18n.changeLanguage('zh');

// ── WebGPU constant stubs ──────────────────────────────────────────────────
// jsdom does not expose WebGPU browser globals. Define the numeric constants
// so that modules referencing GPUShaderStage / GPUTextureUsage / GPUBufferUsage
// can be imported and unit-tested without a real GPU context.
if (typeof globalThis.GPUShaderStage === 'undefined') {
  (globalThis as unknown as Record<string, unknown>).GPUShaderStage = {
    VERTEX: 1,
    FRAGMENT: 2,
    COMPUTE: 4,
  };
}
if (typeof globalThis.GPUTextureUsage === 'undefined') {
  (globalThis as unknown as Record<string, unknown>).GPUTextureUsage = {
    COPY_SRC: 1,
    COPY_DST: 2,
    TEXTURE_BINDING: 4,
    STORAGE_BINDING: 8,
    RENDER_ATTACHMENT: 16,
  };
}
if (typeof globalThis.GPUBufferUsage === 'undefined') {
  (globalThis as unknown as Record<string, unknown>).GPUBufferUsage = {
    MAP_READ: 1,
    MAP_WRITE: 2,
    COPY_SRC: 4,
    COPY_DST: 8,
    INDEX: 16,
    VERTEX: 32,
    UNIFORM: 64,
    STORAGE: 128,
    INDIRECT: 256,
    QUERY_RESOLVE: 512,
  };
}
