/**
 * 返回所有样条切线控制点（白点）的世界坐标及其 knot 索引和端点类型。
 * 用于前端命中检测和拖拽。
 *
 * @param knots 样条节点数组 [x, y, z][]
 * @param tangentOverrides 手动切线覆盖 { [knotIndex]: [tx, ty, tz] }
 * @returns Array<{ knotIndex: number, type: 'in' | 'out', x: number, y: number, z: number }>
 */
export function getSplineHandlePoints(
  knots: Array<[number, number, number]>,
  tangentOverrides?: Record<number, [number, number, number]>,
): Array<{ knotIndex: number, type: 'in' | 'out', x: number, y: number, z: number }> {
  const result: Array<{ knotIndex: number, type: 'in' | 'out', x: number, y: number, z: number }> = [];
  if (knots.length < 2) return result;
  // Catmull-Rom/Hermite 切线 (可被 tangentOverrides 覆盖)
  const tangentAt = (i: number): [number, number, number] => {
    if (tangentOverrides && i in tangentOverrides) return tangentOverrides[i]!;
    const n = knots.length;
    if (n === 1) return [0, 0, 0];
    if (i === 0) return [knots[1]![0] - knots[0]![0], knots[1]![1] - knots[0]![1], knots[1]![2] - knots[0]![2]];
    if (i === n - 1) return [knots[n - 1]![0] - knots[n - 2]![0], knots[n - 1]![1] - knots[n - 2]![1], knots[n - 1]![2] - knots[n - 2]![2]];
    return [0.5 * (knots[i + 1]![0] - knots[i - 1]![0]), 0.5 * (knots[i + 1]![1] - knots[i - 1]![1]), 0.5 * (knots[i + 1]![2] - knots[i - 1]![2])];
  };
  for (let i = 0; i < knots.length; i++) {
    const [kx, ky, kz] = knots[i]!;
    const [tvx, tvy] = tangentAt(i);
    const tLen = Math.hypot(tvx, tvy);
    if (tLen < 1e-6) continue;
    // Clamp visual handle length与渲染一致
    const scale = Math.min(4.0 / tLen, 0.3);
    // out 端点
    result.push({ knotIndex: i, type: 'out', x: kx + tvx * scale, y: ky + tvy * scale, z: kz });
    // in 端点
    result.push({ knotIndex: i, type: 'in', x: kx - tvx * scale, y: ky - tvy * scale, z: kz });
  }
  return result;
}
