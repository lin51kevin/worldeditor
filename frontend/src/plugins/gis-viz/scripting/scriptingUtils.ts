import type { Project } from '../../../services/platform';
import { autoDeploySignals } from '../../analysis/traffic/trafficUtils';

export interface ScriptExecutionResult {
  nextProject: Project;
  output: string;
}

export function executeScriptCommand(project: Project, rawCommand: string): ScriptExecutionResult {
  const command = rawCommand.trim();
  if (!command) {
    return { nextProject: project, output: 'No command entered.' };
  }

  if (command === 'help') {
    return {
      nextProject: project,
      output: 'Commands: help, project.summary, roads.list, project.rename <name>, traffic.deploySignals',
    };
  }

  if (command === 'project.summary') {
    return {
      nextProject: project,
      output: `Project ${project.name || '<unnamed>'}: ${project.roads.length} road(s), ${project.junctions.length} junction(s), ${project.signals.length} global signal(s).`,
    };
  }

  if (command === 'roads.list') {
    return {
      nextProject: project,
      output: project.roads.length === 0
        ? 'No roads in project.'
        : project.roads.map((road) => `${road.id}: ${road.name || '<unnamed>'} (${road.length.toFixed(1)}m)`).join('\n'),
    };
  }

  if (command.startsWith('project.rename ')) {
    const name = command.slice('project.rename '.length).trim();
    if (!name) {
      return { nextProject: project, output: 'Usage: project.rename <name>' };
    }
    return {
      nextProject: { ...project, name },
      output: `Project renamed to ${name}.`,
    };
  }

  if (command === 'traffic.deploySignals') {
    const nextProject = autoDeploySignals(project);
    const signalCount = nextProject.roads.reduce((count, road) => count + (road.signals?.length ?? 0), 0);
    return {
      nextProject,
      output: `Deployed ${signalCount} road signal(s).`,
    };
  }

  return {
    nextProject: project,
    output: `Unknown command: ${command}`,
  };
}