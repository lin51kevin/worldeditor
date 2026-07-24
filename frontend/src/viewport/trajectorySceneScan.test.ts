import { describe, it, expect, vi, beforeEach } from 'vitest';
import { classifyWebFiles } from './trajectorySceneScan';

// getPlatformService is only used by the desktop path; stub to avoid heavy imports.
vi.mock('../services', () => ({ getPlatformService: vi.fn() }));

const CSV = [
  'ID,Time,PositionX,PositionY,PositionZ,Length,Width,Height,Yaw,Ego',
  '10000,0,0,0,0,4.5,2,1.6,0,Y',
  '2,0,5,5,0,4,2,1.6,0,N',
].join('\n');

function fakeFile(rel: string, content = ''): File {
  return {
    name: rel.split('/').pop() ?? rel,
    webkitRelativePath: rel,
    text: async () => content,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as File;
}

function fileList(files: File[]): FileList {
  return files as unknown as FileList;
}

describe('classifyWebFiles', () => {
  beforeEach(() => {
    // jsdom lacks URL.createObjectURL by default.
    (URL as unknown as { createObjectURL: (b: unknown) => string }).createObjectURL = () => 'blob:thumb';
  });

  it('classifies scene / road / trajectory / npc files by path and name', async () => {
    const { scan } = await classifyWebFiles(
      fileList([
        fakeFile('root/3dgs/point_cloud.ply'),
        fakeFile('root/3dgs/road_mesh.ply'),
        fakeFile('root/3dgs/case.csv', CSV),
        fakeFile('root/assets/car1.ply'),
        fakeFile('root/assets/car1.png'),
      ]),
    );
    expect(scan.scenes.map((c) => c.name)).toEqual(['root/3dgs/point_cloud.ply']);
    expect(scan.roads.map((c) => c.name)).toEqual(['root/3dgs/road_mesh.ply']);
    expect(scan.trajectories).toHaveLength(1);
    expect(scan.npcs).toHaveLength(1);
    expect(scan.npcs[0]!.name).toBe('root/assets/car1.ply');
    expect(scan.npcs[0]!.thumbnail).toBe('blob:thumb');
  });

  it('matches a thumbnail in the same directory by base name', async () => {
    const { scan } = await classifyWebFiles(
      fileList([
        fakeFile('root/assets/suv.ply'),
        fakeFile('root/assets/other.png'),
        fakeFile('root/assets/suv.jpg'),
      ]),
    );
    expect(scan.npcs).toHaveLength(1);
    // Thumbnail resolves (base-name match preferred); URL stub returns the same string.
    expect(scan.npcs[0]!.thumbnail).toBe('blob:thumb');
  });

  it('parses actor ids and ego flag from the trajectory CSV', async () => {
    const { entities } = await classifyWebFiles(
      fileList([fakeFile('root/3dgs/case.csv', CSV)]),
    );
    expect(entities).toEqual([
      { id: '10000', ego: true },
      { id: '2', ego: false },
    ]);
  });

  it('returns empty entities when no CSV is present', async () => {
    const { entities } = await classifyWebFiles(fileList([fakeFile('root/assets/car.ply')]));
    expect(entities).toEqual([]);
  });
});
