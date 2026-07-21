/**
 * Road Sign Entries — GB 5768 Categories
 *
 * Auto-generated from frontend/public/assets/textures/RoadSigns/*.png
 * Organized by GB 5768 (中国道路交通标志标线国标) categories:
 * - warning:       警告标志 (codes starting with 10101)
 * - prohibitory:   禁令标志 (codes starting with 10102)
 * - mandatory:     指示标志 (codes starting with 10103)
 * - supplementary: 辅助标志 (codes starting with 10104)
 */
import type { RoadSignTemplateConfig } from './schema';

/** Derive GB 5768 subcategory from Chinese sign code prefix */
function signCategory(code: string): string {
  if (code.startsWith('10101')) return 'warning';
  if (code.startsWith('10102')) return 'prohibitory';
  if (code.startsWith('10103')) return 'mandatory';
  if (code.startsWith('10104')) return 'supplementary';
  return 'other';
}

/**
 * All PNG filenames in RoadSigns/ (without extension).
 * Speed limit signs have a `_speed` suffix (e.g. `1010203800001413_30`).
 */
const SIGN_CODES: string[] = [
  // ── Warning Signs (警告标志) ──
  '1010100111001111',
  '1010100112001111',
  '1010100121001111',
  '1010100122001111',
  '1010100123001111',
  '1010100132001111',
  '1010100141001111',
  '1010100211001111',
  '1010100212001111',
  '1010100311001111',
  '1010100312001111',
  '1010100400001111',
  '1010100511001111',
  '1010100512001111',
  '1010100711001111',
  '1010100712001111',
  '1010100713001111',
  '1010100800001111',
  '1010100900001111',
  '1010101000001111',
  '1010101100001111',
  '1010101200001111',
  '1010101400001111',
  '1010101512001111',
  '1010101700001111',
  '1010101811001111',
  '1010101911001111',
  '1010102000001111',
  '1010102100001111',
  '1010102200001111',
  '1010102400001111',
  '1010102500001111',
  '1010102700001111',
  '1010102812001111',
  '1010102900001111',
  '1010103000001111',
  '1010103200001111',
  '1010103311001111',
  '1010103312001111',
  '1010103313001111',
  '1010103400001111',
  '1010103500001111',
  '1010103600001111',
  '1010103700001111',
  '1010103800001111',
  '1010103900001111',
  '1010104011001111',
  '1010104111001111',
  '1010104211001111',
  '1010104311001111',
  '1010104400001111',

  // ── Prohibitory Signs (禁令标志) ──
  '1010200100001914',
  '1010200200002012',
  '1010200300002113',
  '1010200400001213',
  '1010200500001513',
  '1010200600001413',
  '1010201600001413',
  '1010202100001413',
  '1010202211001413',
  '1010202311001413',
  '1010202400001413',
  '1010202500001413',
  '1010202600001413',
  '1010202700001413',
  '1010202800001413',
  '1010202900001413',
  '1010203000001613',
  '1010203111001713',
  '1010203200001713',
  '1010203300001413',
  '1010203400001413',
  '1010203500001413',

  // ── Mandatory Signs (指示标志) ──
  '1010300100002413',
  '1010300200002413',
  '1010300300002413',
  '1010300400002413',
  '1010300500002413',
  '1010300600002413',
  '1010300700002413',
  '1010300800002413',
  '1010300900002413',
  '1010301000002413',
  '1010301100002413',
  '1010301211002416',
  '1010301212002416',
  '1010301213002416',
  '1010301300002413',
  '1010301400002413',
  '1010301500002413',
  '1010301600002416',
  '1010301700002416',
  '1010301800002616',
  '1010301911002416',
  '1010301912002416',
  '1010301913002416',
  '1010301914002416',
  '1010301915002416',
  '1010301916002416',
  '1010301917002416',
  '1010301918002416',
  '1010302011002416',
  '1010302012002413',
  '1010302012002416',
  '1010302014002413',
  '1010302014002416',
  '1010302016002416',
  '1010302111002416',
  '1010302200002416',

  // ── Supplementary Signs (辅助标志) ──
  '1010400214132516',
  '1010400312002516',
  '1010400412003516',
  '1010400413112516',
  '1010400414122516',
  '1010400416122516',
  '1010400417112516',
  '1010400417133916',
  '1010400417143916',
  '1010400417153916',
];

/** Speed limit sign variants (base code + speed values) */
const SPEED_LIMIT_ENTRIES: Array<{ code: string; speed: string }> = [
  { code: '1010203800001413', speed: '5' },
  { code: '1010203800001413', speed: '10' },
  { code: '1010203800001413', speed: '15' },
  { code: '1010203800001413', speed: '20' },
  { code: '1010203800001413', speed: '25' },
  { code: '1010203800001413', speed: '30' },
  { code: '1010203800001413', speed: '40' },
  { code: '1010203800001413', speed: '50' },
  { code: '1010203800001413', speed: '60' },
  { code: '1010203800001413', speed: '70' },
  { code: '1010203800001413', speed: '80' },
  { code: '1010203800001413', speed: '90' },
  { code: '1010203800001413', speed: '100' },
  { code: '1010203800001413', speed: '110' },
  { code: '1010203800001413', speed: '120' },
];

// Build template entries from sign codes
const signEntries: RoadSignTemplateConfig[] = SIGN_CODES.map((code) => ({
  id: `tpl:rsign:${code}`,
  labelKey: `templatePanel.roadSigns.${code}`,
  icon: '🔶',
  thumbnailUrl: `/assets/textures/RoadSigns/${code}.png`,
  signCode: code,
  signalType: code,
  subcategory: signCategory(code),
  defaultWidth: 0.8,
  defaultHeight: 0.8,
}));

// Add speed limit entries
const speedEntries: RoadSignTemplateConfig[] = SPEED_LIMIT_ENTRIES.map(({ code, speed }) => ({
  id: `tpl:rsign:${code}_${speed}`,
  labelKey: `templatePanel.roadSigns.speedLimit_${speed}`,
  icon: `${speed}`,
  thumbnailUrl: `/assets/textures/RoadSigns/${code}_${speed}.png`,
  signCode: `${code}_${speed}`,
  signalType: code,
  subcategory: 'prohibitory',
  defaultWidth: 0.8,
  defaultHeight: 0.8,
}));

export const roadSignEntries: RoadSignTemplateConfig[] = [...signEntries, ...speedEntries];
