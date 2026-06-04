/**
 * Shared test utilities for Viewport tests.
 * Contains factory functions for mock data (not vi.mock declarations).
 */
import { vi } from 'vitest';
import type { GisCoord, PlatformService, Project, UtmCoord } from '../services/platform';

export function makeProject(): Project {
  return {
    name: 'Viewport Project',
    header: {
      rev_major: 1,
      rev_minor: 6,
      name: '',
      date: '',
      north: 0,
      south: 0,
      east: 0,
      west: 0,
      geo_reference: null,
    },
    roads: [],
    junctions: [],
    signals: [],
    objects: []
  };
}

export function makeProjectWithRoad(): Project {
  return {
    ...makeProject(),
    roads: [{
      id: 'road-1',
      name: 'Road 1',
      length: 20,
      junction_id: null,
      link: { predecessor: null, successor: null },
      plan_view: [],
      elevation_profile: [],
      lane_sections: [],
    }],
  };
}

export function makeProjectWithRoadPlanView(): Project {
  return {
    ...makeProject(),
    roads: [{
      id: 'road-1',
      name: 'Road 1',
      length: 20,
      junction_id: null,
      link: { predecessor: null, successor: null },
      plan_view: [
        { s: 0, x: 0, y: 0, hdg: 0, length: 10, geo_type: 'Line' },
        { s: 10, x: 10, y: 0, hdg: 0, length: 10, geo_type: 'Line' },
      ],
      elevation_profile: [],
      lane_sections: [],
    }],
  };
}

export function makeProjectWithRoadSections(): Project {
  return {
    ...makeProject(),
    roads: [{
      id: 'road-1',
      name: 'Road 1',
      length: 30,
      junction_id: null,
      link: { predecessor: null, successor: null },
      plan_view: [],
      elevation_profile: [],
      lane_sections: [
        { s: 0, single_side: false, left: [], center: [], right: [] },
        { s: 10, single_side: false, left: [], center: [], right: [] },
        { s: 20, single_side: false, left: [], center: [], right: [] },
      ],
    }],
  };
}

export function makeCoord(): GisCoord {
  return { lat: 0, lon: 0, alt: 0 };
}

export function makeUtm(): UtmCoord {
  return { easting: 0, northing: 0, zone: 50, is_northern: true, alt: 0 };
}

export function createPlatformMock(vertices = new Float32Array([1, 2, 3])): PlatformService {
  return {
    parseOpenDrive: vi.fn().mockResolvedValue(makeProject()),
    writeOpenDrive: vi.fn().mockResolvedValue('<OpenDRIVE />'),
    openFile: vi.fn().mockResolvedValue(null),
    openFileByPath: vi.fn().mockResolvedValue(null),
    saveFile: vi.fn().mockResolvedValue(undefined),
    getPlatformInfo: () => ({ type: 'web', version: '0.1.0' }),
    wgs84ToGcj02: vi.fn().mockResolvedValue(makeCoord()),
    gcj02ToWgs84: vi.fn().mockResolvedValue(makeCoord()),
    geoToUtm: vi.fn().mockResolvedValue(makeUtm()),
    utmToGeo: vi.fn().mockResolvedValue(makeCoord()),
    generateRoadVertices: vi.fn().mockResolvedValue(vertices),
    generateSingleRoadVertices: vi.fn().mockResolvedValue(new Float32Array()),
    generateJunctionVertices: vi.fn().mockResolvedValue(new Float32Array()),
    generateLaneBoundaryVertices: vi.fn().mockResolvedValue(new Float32Array()),
    generateLaneLineVertices: vi.fn().mockResolvedValue(new Float32Array()),
    generateCenterLineVertices: vi.fn().mockResolvedValue(new Float32Array()),
    generateSignalPaintVertices: vi.fn().mockResolvedValue(new Float32Array()),
    generateSingleJunctionVertices: vi.fn().mockResolvedValue(new Float32Array()),
    pickRoadAtPoint: vi.fn().mockResolvedValue(null),
    pickJunctionAtPoint: vi.fn().mockResolvedValue(null),
    queryElevation: vi.fn().mockResolvedValue({ elevation: 0, grade: 0, grade_pct: 0 }),
    addElevationPoint: vi.fn().mockResolvedValue(makeProject()),
    deleteElevationPoint: vi.fn().mockResolvedValue(makeProject()),
    smoothElevation: vi.fn().mockResolvedValue(makeProject()),
    snapPoint: vi.fn().mockResolvedValue({ x: 0, y: 0, snapped: false, snap_type: 'None', target_id: null }),
    measureDistance: vi.fn().mockResolvedValue({ straight: 0, horizontal: 0, vertical: 0 }),
    measureAngle: vi.fn().mockResolvedValue({ radians: 0, degrees: 0 }),
    measureArea: vi.fn().mockResolvedValue({ area: 0, perimeter: 0 }),
    measureRoadLength: vi.fn().mockResolvedValue(0),
    sampleLaneBoundary: vi.fn().mockResolvedValue([]),
    getRoadTemplates: vi.fn().mockResolvedValue([
      { id: 'single', name: 'Single Lane', left_lanes: 1, right_lanes: 1, lane_width: 3.5 },
    ]),
    createRoadFromSpline: vi.fn().mockResolvedValue(makeProject()),
    roadToSpline: vi.fn().mockResolvedValue({ knots: [] }),
    moveSplineKnot: vi.fn().mockResolvedValue({ knots: [] }),
    splineToGeometries: vi.fn().mockResolvedValue([]),
    generateObjectVertices: vi.fn().mockResolvedValue(new Float32Array()),
    pickSignalAtPoint: vi.fn().mockResolvedValue(null),
    pickObjectAtPoint: vi.fn().mockResolvedValue(null),
    pickSignalAtPointCached: vi.fn().mockResolvedValue(null),
    pickObjectAtPointCached: vi.fn().mockResolvedValue(null),
    generateSingleSignalVertices: vi.fn().mockResolvedValue(new Float32Array()),
    generateSingleObjectVertices: vi.fn().mockResolvedValue(new Float32Array()),
    getSignalWorldPos: vi.fn().mockResolvedValue(null),
    getObjectWorldPos: vi.fn().mockResolvedValue(null),
    getSignalWorldPosCached: vi.fn().mockResolvedValue(null),
    getObjectWorldPosCached: vi.fn().mockResolvedValue(null),
    getLaneWorldPosCached: vi.fn().mockResolvedValue(null),
    getRoadEndpointTangent: vi.fn().mockResolvedValue(null),
    setProjectCache: vi.fn().mockResolvedValue(undefined),
    invalidateProjectCache: vi.fn().mockResolvedValue(undefined),
    hasProjectCache: vi.fn().mockResolvedValue(true),
    pickRoadAtPointCached: vi.fn().mockResolvedValue(null),
    pickJunctionAtPointCached: vi.fn().mockResolvedValue(null),
    snapPointCached: vi.fn().mockResolvedValue({ x: 0, y: 0, snapped: false, snap_type: 'None', target_id: null }),
    snapPointOnRoad: vi.fn().mockResolvedValue({ s: 0, t: 0, hdg: 0 }),
    pickLaneAtPointCached: vi.fn().mockResolvedValue(null),
    generateRoadVerticesCached: vi.fn().mockResolvedValue(vertices),
    generateBridgeTunnelVertices: vi.fn().mockResolvedValue(new Float32Array()),
    autoJunctionConnectors: vi.fn().mockResolvedValue(makeProject()),
    computeJunctionArea: vi.fn().mockResolvedValue(null),
    loadPointCloud: vi.fn().mockResolvedValue({
      handle: 1,
      summary: { count: 0, origin: [0, 0, 0], min: [0, 0, 0], max: [0, 0, 0], has_intensity: false, has_rgb: false, has_heightmap: false },
    }),
    freePointCloud: vi.fn().mockResolvedValue(undefined),
    pointCloudRenderBuffer: vi.fn().mockResolvedValue(new Float32Array()),
    extractPointCloudGround: vi.fn().mockResolvedValue({}),
    extractPointCloudMarkings: vi.fn().mockResolvedValue([]),
    vectorizePointCloud: vi.fn().mockResolvedValue([]),
    samplePointCloudGround: vi.fn().mockResolvedValue(null),
  };
}

/**
 * Creates the standard renderer mock object used across Viewport tests.
 */
export function createRendererMocks() {
  return {
    isSupported: vi.fn(),
    init: vi.fn(),
    start: vi.fn(),
    uploadRoadVertices: vi.fn(),
    uploadLaneLineVertices: vi.fn(),
    uploadOverlayVertices: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    setShowGrid: vi.fn(),
    setShowAxis: vi.fn(),
    setDimension: vi.fn(),
    setViewMode: vi.fn(),
    fitToVertices: vi.fn(),
    panToCenter: vi.fn(),
    uploadHighlightVertices: vi.fn(),
    uploadHoverVertices: vi.fn(),
    clearHover: vi.fn(),
    clearHighlight: vi.fn(),
    clearVertexCache: vi.fn(),
    lockCamera: vi.fn(),
    unlockCamera: vi.fn(),
    getCameraDistance: vi.fn().mockReturnValue(100),
    refreshSplineMarkers: vi.fn(),
    setCurveFromVertexData: vi.fn(),
    unprojectToGround: vi.fn(),
    projectWorldToScreen: vi.fn().mockReturnValue({ x: 50, y: 50 }),
    setSplinePreviewKnots: vi.fn(),
    setScaleChangeCallback: vi.fn(),
    setOverlayRenderers: vi.fn(),
    setClearColor: vi.fn(),
    setGridColor: vi.fn(),
    getMetersPerPixel: vi.fn().mockReturnValue(0.1),
    applyPan: vi.fn(),
    applyZoomFactor: vi.fn(),
    clearLinkHighlight: vi.fn(),
    uploadLinkHighlightVertices: vi.fn(),
  };
}
