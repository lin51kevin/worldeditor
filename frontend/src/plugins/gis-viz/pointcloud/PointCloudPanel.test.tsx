import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import PointCloudPanel from './PointCloudPanel';
import { usePointCloudStore } from './pointcloudState';

describe('PointCloudPanel Gaussian fidelity status', () => {
  beforeEach(() => {
    usePointCloudStore.getState().reset();
  });

  it('shows an explicit full-mode capacity failure', () => {
    usePointCloudStore.getState().setSplatLoaded(
      1,
      'scene.ply',
      new Uint32Array(0),
      3,
      2,
      {
        count: 5,
        min: [0, 0, 0],
        max: [1, 1, 1],
        has_rgb: true,
        has_intensity: false,
        has_heightmap: false,
      },
    );
    usePointCloudStore.getState().setSplatUploadStatus({
      outcome: 'failed',
      sourceCount: 5,
      uploadedCount: 0,
      requestedShDegree: 3,
      effectiveShDegree: 3,
      renderMode: 'full',
      resourceMode: 'none',
      fallbackReason: 'order-buffer-capacity-exceeded',
    });

    render(<PointCloudPanel />);

    expect(screen.getByTestId('splat-fidelity-status')).toBeInTheDocument();
    expect(screen.getByText('0 / 5')).toBeInTheDocument();
    expect(screen.getByText('3 → 3')).toBeInTheDocument();
    expect(screen.getByText(/全局排序缓冲/)).toBeInTheDocument();
  });
});
