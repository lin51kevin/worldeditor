import { describe, it, expect } from 'vitest';
import {
  perspectiveMatrix,
  lookAtMatrix,
  multiplyMatrices,
  arraysEqual,
  invertMatrix4,
  transformPoint,
  niceNumber,
} from './viewportMath';

/** Identity matrix (column-major 4x4). */
function identity(): Float32Array {
  return new Float32Array([1, 0, 0, 0,  0, 1, 0, 0,  0, 0, 1, 0,  0, 0, 0, 1]);
}

describe('viewportMath', () => {
  describe('perspectiveMatrix', () => {
    it('should produce a 16-element Float32Array', () => {
      const m = perspectiveMatrix(Math.PI / 4, 1.0, 0.1, 1000);
      expect(m).toHaveLength(16);
    });

    it('should have positive diagonal entries', () => {
      const m = perspectiveMatrix(Math.PI / 4, 1.0, 0.1, 1000);
      expect(m[0]!).toBeGreaterThan(0);
      expect(m[5]!).toBeGreaterThan(0);
    });

    it('fourth column w-row should be -1', () => {
      const m = perspectiveMatrix(Math.PI / 4, 1.0, 0.1, 1000);
      // In column-major, col 3 row 2 = index 14 (forward depth)
      // The w-divide row: index 11 should be -1
      expect(m[11]).toBe(-1);
    });
  });

  describe('lookAtMatrix', () => {
    it('should produce 16-element Float32Array', () => {
      const m = lookAtMatrix([0, 0, 5], [0, 0, 0], [0, 1, 0]);
      expect(m).toHaveLength(16);
    });

    it('looking from +Z at origin: X axis should be world X', () => {
      const m = lookAtMatrix([0, 0, 5], [0, 0, 0], [0, 1, 0]);
      // Column 0 (rows 0-2) = right vector = [1, 0, 0]
      expect(m[0]).toBeCloseTo(1, 5);
      expect(m[1]).toBeCloseTo(0, 5);
      expect(m[2]).toBeCloseTo(0, 5);
    });
  });

  describe('multiplyMatrices', () => {
    it('identity × identity = identity', () => {
      const I = identity();
      const result = multiplyMatrices(I, I);
      for (let i = 0; i < 16; i++) {
        expect(result[i]).toBeCloseTo(I[i]!, 10);
      }
    });

    it('should be non-commutative for non-identity matrices', () => {
      const a = perspectiveMatrix(Math.PI / 4, 1.5, 0.1, 100);
      const b = lookAtMatrix([1, 2, 3], [0, 0, 0], [0, 1, 0]);
      const ab = multiplyMatrices(a, b);
      const ba = multiplyMatrices(b, a);
      // AB ≠ BA in general for projection and view matrices
      let different = false;
      for (let i = 0; i < 16; i++) {
        if (Math.abs(ab[i]! - ba[i]!) > 1e-4) { different = true; break; }
      }
      expect(different).toBe(true);
    });
  });

  describe('arraysEqual', () => {
    it('should return true for identical arrays', () => {
      const a = new Float32Array([1, 2, 3]);
      const b = new Float32Array([1, 2, 3]);
      expect(arraysEqual(a, b)).toBe(true);
    });

    it('should return false for different arrays', () => {
      const a = new Float32Array([1, 2, 3]);
      const b = new Float32Array([1, 2, 4]);
      expect(arraysEqual(a, b)).toBe(false);
    });
  });

  describe('invertMatrix4', () => {
    it('should invert identity to identity', () => {
      const I = identity();
      const inv = invertMatrix4(I);
      expect(inv).not.toBeNull();
      for (let i = 0; i < 16; i++) {
        expect(inv![i]).toBeCloseTo(I[i]!, 5);
      }
    });

    it('should return null for singular matrix', () => {
      // All-zero matrix is singular
      const zero = new Float32Array(16);
      expect(invertMatrix4(zero)).toBeNull();
    });

    it('M × M⁻¹ ≈ identity for invertible matrix', () => {
      const m = lookAtMatrix([1, 2, 5], [0, 0, 0], [0, 1, 0]);
      const inv = invertMatrix4(m);
      expect(inv).not.toBeNull();
      const product = multiplyMatrices(m, inv!);
      // Diagonal should be ≈ 1, off-diagonal ≈ 0
      for (let col = 0; col < 4; col++) {
        for (let row = 0; row < 4; row++) {
          const expected = col === row ? 1 : 0;
          expect(product[col * 4 + row]).toBeCloseTo(expected, 4);
        }
      }
    });
  });

  describe('transformPoint', () => {
    it('should leave point unchanged when multiplied by identity', () => {
      const p: [number, number, number] = [3, 4, 5];
      const result = transformPoint(identity(), p);
      expect(result[0]).toBeCloseTo(3, 10);
      expect(result[1]).toBeCloseTo(4, 10);
      expect(result[2]).toBeCloseTo(5, 10);
    });

    it('should translate point correctly with translation matrix', () => {
      // Translation matrix (column-major): T(tx, ty, tz)
      const tx = 1, ty = 2, tz = 3;
      const T = new Float32Array([
        1, 0, 0, 0,   // col 0
        0, 1, 0, 0,   // col 1
        0, 0, 1, 0,   // col 2
        tx, ty, tz, 1, // col 3
      ]);
      const result = transformPoint(T, [0, 0, 0]);
      expect(result[0]).toBeCloseTo(tx, 10);
      expect(result[1]).toBeCloseTo(ty, 10);
      expect(result[2]).toBeCloseTo(tz, 10);
    });
  });

  describe('niceNumber', () => {
    it('should return 1 for values <= 0', () => {
      expect(niceNumber(0)).toBe(1);
      expect(niceNumber(-5)).toBe(1);
    });

    it('should round up to 1-2-5 sequence', () => {
      expect(niceNumber(1)).toBe(1);
      expect(niceNumber(1.5)).toBe(2);
      expect(niceNumber(3)).toBe(5);
      expect(niceNumber(6)).toBe(10);
      expect(niceNumber(75)).toBe(100);
      expect(niceNumber(450)).toBe(500);
    });

    it('should work for fractions', () => {
      expect(niceNumber(0.3)).toBe(0.5);
      expect(niceNumber(0.15)).toBe(0.2);
    });
  });
});
