import type { Project } from "./types";

function normParentId(parentId: string | null | undefined): string | null {
  const trimmed = (parentId ?? "").trim();
  return trimmed ? trimmed : null;
}

export function getProjectAncestors(projects: Project[], id: string): Project[] {
  const byId = new Map<string, Project>();
  for (const p of projects) byId.set(p.id, p);

  const chain: Project[] = [];
  const visited = new Set<string>();
  let cur: string | null = id.trim() || null;

  while (cur) {
    if (visited.has(cur)) break;
    visited.add(cur);
    const p = byId.get(cur);
    if (!p) break;
    chain.push(p);
    cur = normParentId(p.parentId);
  }
  chain.reverse();
  return chain;
}

export function getProjectDescendantIds(projects: Project[], rootId: string): Set<string> {
  const result = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (result.has(cur)) continue;
    result.add(cur);
    for (const p of projects) {
      if (normParentId(p.parentId) === cur) {
        stack.push(p.id);
      }
    }
  }
  return result;
}

export function getDirectChildProjects(projects: Project[], parentId: string | null): Project[] {
  const target = normParentId(parentId);
  return projects.filter((p) => normParentId(p.parentId) === target);
}

export interface FlattenedProjectItem {
  project: Project;
  depth: number;
  fullPath: string;
  indentedLabel: string;
}

export function flattenProjectTree(
  projects: Project[],
  excludeSubtreeOfId?: string,
): FlattenedProjectItem[] {
  const excluded = excludeSubtreeOfId
    ? getProjectDescendantIds(projects, excludeSubtreeOfId)
    : new Set<string>();
  const validIds = new Set(projects.filter((p) => !excluded.has(p.id)).map((p) => p.id));

  const out: FlattenedProjectItem[] = [];
  const visited = new Set<string>();

  const visit = (proj: Project, depth: number, prefix: string) => {
    if (visited.has(proj.id) || excluded.has(proj.id)) return;
    visited.add(proj.id);
    const fullPath = prefix ? `${prefix} / ${proj.name}` : proj.name;
    const indent = depth > 0 ? `${"　".repeat(depth)}└─ ` : "";
    out.push({
      project: proj,
      depth,
      fullPath,
      indentedLabel: `${indent}${proj.name}`,
    });
    for (const child of projects) {
      if (normParentId(child.parentId) === proj.id) {
        visit(child, depth + 1, fullPath);
      }
    }
  };

  for (const p of projects) {
    const pid = normParentId(p.parentId);
    if (!pid || !validIds.has(pid)) {
      visit(p, 0, "");
    }
  }
  // Safety pass in case any orphan cycles remained
  for (const p of projects) {
    if (!visited.has(p.id) && !excluded.has(p.id)) {
      visit(p, 0, "");
    }
  }

  return out;
}

export function getProjectPathLabel(projects: Project[], projectId: string): string {
  const ancestors = getProjectAncestors(projects, projectId);
  if (ancestors.length === 0) return projectId;
  return ancestors.map((p) => p.name).join(" / ");
}
