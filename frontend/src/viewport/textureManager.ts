/**
 * TextureManager — Loads PNG textures into GPUTextures and caches them.
 *
 * Used by the SpriteRenderer to bind textures for billboard/paint rendering.
 * Textures are loaded lazily on first request and cached for subsequent frames.
 */

import { getAssetUrl } from '../utils/assetUrl';

/** Texture manifest structure (loaded from /assets/textures/manifest.json). */
export interface TextureManifest {
  basePath: string;
  trafficLights: Record<string, string>;
  roadPaints: Record<string, string>;
  roadSigns: Record<string, string> & { _prefix: string; _suffix: string; _speedLimitBase: string };
  objects: Record<string, string>;
}

export class TextureManager {
  private device: GPUDevice;
  private cache = new Map<string, GPUTexture>();
  private loading = new Map<string, Promise<GPUTexture>>();
  private manifest: TextureManifest | null = null;
  private sampler: GPUSampler;
  private placeholder: GPUTexture | null = null;

  constructor(device: GPUDevice) {
    this.device = device;
    this.sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
  }

  getSampler(): GPUSampler {
    return this.sampler;
  }

  /** Load the texture manifest JSON. Call once at init. */
  async loadManifest(): Promise<void> {
    try {
      const manifestUrl = getAssetUrl('assets/textures/manifest.json');
      const resp = await fetch(manifestUrl);
      this.manifest = await resp.json() as TextureManifest;
      // Override basePath with platform-aware resolved URL base
      this.manifest.basePath = getAssetUrl('assets/textures');
    } catch (e) {
      console.warn('[TextureManager] Failed to load manifest:', e);
    }
  }

  /** Resolve a signal type+subtype to a texture path using the manifest.
   * @param value - signal value (e.g. speed limit number), used for speed limit sign filename */
  resolveSignalTexture(signalType: string, signalSubtype: string, value?: string): string | null {
    if (!this.manifest) return null;

    // Check if it's a road paint (Graphics type)
    if (signalType === 'Graphics') {
      const path = this.manifest.roadPaints[signalSubtype]
        ?? this.manifest.roadPaints['_default'];
      return path ? `${this.manifest.basePath}/${path}` : null;
    }

    // Try traffic light lookup (type or type:subtype)
    const compositeKey = `${signalType}:${signalSubtype}`;
    const tlPath = this.manifest.trafficLights[compositeKey]
      ?? this.manifest.trafficLights[signalType]
      ?? null;
    if (tlPath) {
      return `${this.manifest.basePath}/${tlPath}`;
    }

    // Try road sign lookup by type code
    const { _prefix, _suffix, _speedLimitBase } = this.manifest.roadSigns;
    const cleanType = signalType.replace(/,/g, '');

    // Check explicit mapping first (e.g. "206" → specific PNG path)
    const dotType = `${signalType}`;
    const explicitPath = this.manifest.roadSigns[dotType];
    if (explicitPath && !explicitPath.startsWith('_')) {
      return `${this.manifest.basePath}/${explicitPath}`;
    }

    // Speed limit signs: use value (speed number) as suffix
    if (cleanType === _speedLimitBase) {
      const speed = value || signalSubtype || '';
      if (speed) {
        return `${this.manifest.basePath}/${_prefix}${cleanType}_${speed}${_suffix}`;
      }
    }
    // Generic sign: use type code directly as filename
    const signPath = `${this.manifest.basePath}/${_prefix}${cleanType}${_suffix}`;
    return signPath;
  }

  /** Resolve an object type to its thumbnail path. */
  resolveObjectThumbnail(objectType: string): string | null {
    if (!this.manifest) return null;
    const path = this.manifest.objects[objectType];
    return path ? `${this.manifest.basePath}/${path}` : null;
  }

  /** Get or load a texture by URL path. Returns placeholder while loading. */
  getTexture(url: string): GPUTexture {
    const cached = this.cache.get(url);
    if (cached) return cached;

    // Start async load if not already in progress
    if (!this.loading.has(url)) {
      this.loading.set(url, this.loadTexture(url));
    }

    return this.getPlaceholder();
  }

  /** Check if a texture URL is fully loaded and available. */
  isLoaded(url: string): boolean {
    return this.cache.has(url);
  }

  /** Preload a batch of texture URLs. Returns when all are loaded. */
  async preload(urls: string[]): Promise<void> {
    const unique = [...new Set(urls)].filter(u => !this.cache.has(u));
    await Promise.all(unique.map(url => this.loadTextureIfNeeded(url)));
  }

  private async loadTextureIfNeeded(url: string): Promise<GPUTexture> {
    if (this.cache.has(url)) return this.cache.get(url)!;
    if (this.loading.has(url)) return this.loading.get(url)!;
    const promise = this.loadTexture(url);
    this.loading.set(url, promise);
    return promise;
  }

  private async loadTexture(url: string): Promise<GPUTexture> {
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'premultiply' });

      const texture = this.device.createTexture({
        size: { width: bitmap.width, height: bitmap.height },
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });

      this.device.queue.copyExternalImageToTexture(
        { source: bitmap },
        { texture },
        { width: bitmap.width, height: bitmap.height },
      );

      bitmap.close();
      this.cache.set(url, texture);
      this.loading.delete(url);
      return texture;
    } catch (e) {
      console.warn(`[TextureManager] Failed to load texture: ${url}`, e);
      this.loading.delete(url);
      const ph = this.getPlaceholder();
      this.cache.set(url, ph);
      return ph;
    }
  }

  /** 1×1 white placeholder texture (returned while real textures load). */
  private getPlaceholder(): GPUTexture {
    if (!this.placeholder) {
      this.placeholder = this.device.createTexture({
        size: { width: 1, height: 1 },
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      this.device.queue.writeTexture(
        { texture: this.placeholder },
        new Uint8Array([255, 255, 255, 255]),
        { bytesPerRow: 4 },
        { width: 1, height: 1 },
      );
    }
    return this.placeholder;
  }

  /** Release all cached textures. */
  destroy(): void {
    for (const tex of this.cache.values()) {
      tex.destroy();
    }
    this.cache.clear();
    this.loading.clear();
    if (this.placeholder) {
      this.placeholder.destroy();
      this.placeholder = null;
    }
  }
}
