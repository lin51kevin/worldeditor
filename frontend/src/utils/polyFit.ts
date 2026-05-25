export interface CubicPolynomial {
  a: number;
  b: number;
  c: number;
  d: number;
}

type Vector4 = [number, number, number, number];
type Matrix4 = [Vector4, Vector4, Vector4, Vector4];
type AugmentedRow = [number, number, number, number, number];

const REGULARIZATION = 1e-8;

function solveLinearSystem4(matrix: Matrix4, vector: Vector4): Vector4 {
  const augmented: [AugmentedRow, AugmentedRow, AugmentedRow, AugmentedRow] = [
    [...matrix[0], vector[0]],
    [...matrix[1], vector[1]],
    [...matrix[2], vector[2]],
    [...matrix[3], vector[3]],
  ];

  for (let pivot = 0; pivot < 4; pivot += 1) {
    let pivotRow = pivot;
    let pivotValue = Math.abs(augmented[pivot]![pivot]!);

    for (let row = pivot + 1; row < 4; row += 1) {
      const candidate = Math.abs(augmented[row]![pivot]!);
      if (candidate > pivotValue) {
        pivotValue = candidate;
        pivotRow = row;
      }
    }

    if (pivotRow !== pivot) {
      const temp = augmented[pivot]!;
      augmented[pivot] = augmented[pivotRow]!;
      augmented[pivotRow] = temp;
    }

    const divisor = augmented[pivot]![pivot]!;
    if (Math.abs(divisor) < REGULARIZATION) {
      continue;
    }

    for (let column = pivot; column <= 4; column += 1) {
      augmented[pivot]![column]! /= divisor;
    }

    for (let row = 0; row < 4; row += 1) {
      if (row === pivot) continue;
      const factor = augmented[row]![pivot]!;
      if (Math.abs(factor) < REGULARIZATION) continue;
      for (let column = pivot; column <= 4; column += 1) {
        augmented[row]![column]! -= factor * augmented[pivot]![column]!;
      }
    }
  }

  return [augmented[0][4], augmented[1][4], augmented[2][4], augmented[3][4]];
}

export function evaluateCubicPolynomial(coeffs: CubicPolynomial, ds: number): number {
  return coeffs.a + coeffs.b * ds + coeffs.c * ds * ds + coeffs.d * ds * ds * ds;
}

export function refitLaneWidth(
  sPositions: number[],
  widths: number[],
  sectionStart: number,
  sectionLength: number,
): CubicPolynomial {
  const count = Math.min(sPositions.length, widths.length);
  if (count === 0) {
    return { a: 0, b: 0, c: 0, d: 0 };
  }

  const ata: Matrix4 = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  const atb: Vector4 = [0, 0, 0, 0];

  for (let index = 0; index < count; index += 1) {
    const s = sPositions[index] ?? sectionStart;
    const width = widths[index] ?? 0;
    const ds = Math.min(sectionLength, Math.max(0, s - sectionStart));
    const basis: Vector4 = [1, ds, ds * ds, ds * ds * ds];

    for (let row = 0; row < 4; row += 1) {
      atb[row]! += basis[row]! * width;
      for (let column = 0; column < 4; column += 1) {
        ata[row]![column]! += basis[row]! * basis[column]!;
      }
    }
  }

  for (let diagonal = 0; diagonal < 4; diagonal += 1) {
    ata[diagonal]![diagonal]! += REGULARIZATION;
  }

  const [a, b, c, d] = solveLinearSystem4(ata, atb);
  return { a, b, c, d };
}
