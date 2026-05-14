import type { Project } from '../services/platform';

export interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  message: string;
  roadId?: string;
  junctionId?: string;
}

export function validateProject(project: Project): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // 1. Check if roads are empty
  if (project.roads.length === 0) {
    issues.push({ severity: 'info', message: 'Project has no roads' });
  }

  // 2. Check plan_view geometry completeness
  for (const road of project.roads) {
    if (!road.plan_view || road.plan_view.length === 0) {
      issues.push({ severity: 'error', message: `Road ${road.id} has no geometry`, roadId: road.id });
    }
    for (const geo of road.plan_view) {
      if (geo.length <= 0) {
        issues.push({ severity: 'error', message: `Road ${road.id} has invalid geometry length`, roadId: road.id });
      }
    }
  }

  // 3. Check for duplicate road IDs
  const ids = project.roads.map((r) => r.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length > 0) {
    issues.push({ severity: 'error', message: `Duplicate road IDs: ${dupes.join(', ')}` });
  }

  // 4. Check junction connectivity
  for (const j of project.junctions) {
    if (j.connections.length < 2) {
      issues.push({
        severity: 'warning',
        message: `Junction ${j.id} has fewer than 2 connections`,
        junctionId: j.id,
      });
    }
  }

  // 5. Check link reference validity
  const roadIds = new Set(ids);
  for (const road of project.roads) {
    if (road.link?.predecessor?.element_id && !roadIds.has(road.link.predecessor.element_id)) {
      issues.push({
        severity: 'warning',
        message: `Road ${road.id} predecessor points to non-existent road ${road.link.predecessor.element_id}`,
        roadId: road.id,
      });
    }
    if (road.link?.successor?.element_id && !roadIds.has(road.link.successor.element_id)) {
      issues.push({
        severity: 'warning',
        message: `Road ${road.id} successor points to non-existent road ${road.link.successor.element_id}`,
        roadId: road.id,
      });
    }
  }

  return issues;
}
