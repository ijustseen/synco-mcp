import { describe, expect, it } from "vitest";
import { resourcesOverlap } from "../src/shared/utils/overlap.js";

describe("resource overlap", () => {
  it("matches exact files", () => {
    expect(
      resourcesOverlap({ type: "file", path: "src/auth.ts" }, { type: "file", path: "src/auth.ts" }),
    ).toBe(true);
  });

  it("treats a directory as covering nested files", () => {
    expect(
      resourcesOverlap(
        { type: "directory", path: "src/auth" },
        { type: "file", path: "src/auth/session.ts" },
      ),
    ).toBe(true);
  });

  it("matches a single-segment glob", () => {
    expect(
      resourcesOverlap(
        { type: "glob", path: "src/auth/*.ts" },
        { type: "file", path: "src/auth/session.ts" },
      ),
    ).toBe(true);
    expect(
      resourcesOverlap(
        { type: "glob", path: "src/auth/*.ts" },
        { type: "file", path: "src/auth/nested/session.ts" },
      ),
    ).toBe(false);
  });
});
