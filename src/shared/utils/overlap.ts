import type { ResourceClaim, ResourceType } from "../../domain/types.js";

export type ResourceRef = {
  type: ResourceType;
  path: string;
};

function normalize(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+$/, "");
}

function globToRegExp(pattern: string): RegExp {
  const escaped = normalize(pattern).replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const source = escaped.replaceAll("*", "[^/]*");
  return new RegExp(`^${source}$`);
}

function directoryContains(directory: string, candidate: string): boolean {
  const dir = normalize(directory);
  const path = normalize(candidate);
  return path === dir || path.startsWith(`${dir}/`);
}

export function resourcesOverlap(a: ResourceRef, b: ResourceRef): boolean {
  const left = { type: a.type, path: normalize(a.path) };
  const right = { type: b.type, path: normalize(b.path) };

  if (left.type === "glob") {
    return globToRegExp(left.path).test(right.path) || (right.type === "glob" && left.path === right.path);
  }
  if (right.type === "glob") {
    return globToRegExp(right.path).test(left.path);
  }
  if (left.type === "directory" || right.type === "directory") {
    return directoryContains(left.path, right.path) || directoryContains(right.path, left.path);
  }
  return left.path === right.path;
}

export function findOverlaps(incoming: ResourceRef[], active: ResourceClaim[]): ResourceClaim[] {
  return active.filter((claim) =>
    incoming.some((resource) =>
      resourcesOverlap(resource, { type: claim.resourceType, path: claim.resourcePath }),
    ),
  );
}
