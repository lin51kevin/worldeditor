export { type TemplateCatalog, type RoadTemplateConfig, type JunctionTemplateConfig, type SignalTemplateConfig, type MarkingTemplateConfig, type RoadObjectTemplateConfig, type SignTemplateConfig, type RoadObjectTypeKey, type SignTypeKey, type LaneConfig, type MarkConfig, type SectionConfig } from './schema';
export { buildRoadFromConfig, buildJunctionFromConfig, buildSignalFromConfig, buildMarkFromConfig, buildRoadObjectFromConfig, buildSignFromConfig, buildLaneSection, genId } from './engine';
export { loadCatalog, validateCatalog, mergeCatalogs, parseExternalCatalog } from './loader';
export { default as defaultCatalog } from './defaultCatalog';
