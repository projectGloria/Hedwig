import { describe, it, expect } from "vitest";
import {
  parseRepo,
  safeName,
  assetNames,
  within,
  publicError,
} from "../electron/core";
import { resolveSubmodule } from "../electron/git";
import { latestGitlab } from "../electron/providers";
describe("repository and archive paths", () => {
  it("normalises GitHub release pages and nested GitLab groups", () => {
    expect(
      parseRepo("https://github.com/storytold/photocraft/releases/tag/v1")
        .fullName,
    ).toBe("storytold/photocraft");
    expect(
      parseRepo("https://gitlab.com/group/sub/project/-/releases").fullName,
    ).toBe("group/sub/project");
    expect(parseRepo("https://github.com/o/r.git").cloneUrl).toBe(
      "https://github.com/o/r.git",
    );
  });
  it.each([
    "file:///tmp/repo",
    "https://github.com.evil.test/a/b",
    "https://token@github.com/a/b",
    "https://github.com/a",
    "https://gitlab.com/group/%2e%2e%2fescape",
    "https://github.com:4430/a/b",
  ])("rejects unsupported or ambiguous source %s", (value) =>
    expect(() => parseRepo(value)).toThrow(),
  );
  it("makes Windows-safe collision-free names", () => {
    expect(safeName("CON.txt")).toBe("_CON.txt");
    expect(safeName("../../file:evil.exe")).not.toContain("/");
    expect(
      assetNames([
        { id: "1", name: "A.zip" },
        { id: "2", name: "a.zip" },
        { id: "3", name: "a-1.zip" },
      ]),
    ).toEqual(["A.zip", "a-1.zip", "a-1-1.zip"]);
    expect(() => within(process.cwd(), "..", "outside")).toThrow();
  });
  it("resolves relative submodules using Git directory semantics", () => {
    expect(
      resolveSubmodule("https://github.com/team/root.git", "../sub.git"),
    ).toBe("https://github.com/team/sub.git");
    expect(
      resolveSubmodule(
        "https://gitlab.com/group/main.git",
        "git@gitlab.com:group/sub.git",
      ),
    ).toBe("https://gitlab.com/group/sub.git");
    expect(() =>
      resolveSubmodule("https://github.com/a/b", "file:///etc/passwd"),
    ).toThrow();
  });
  it("does not include future GitLab releases", () => {
    expect(
      latestGitlab(
        [
          { tag_name: "old", released_at: "2020-01-01" },
          { tag_name: "future", released_at: "2099-01-01" },
          { tag_name: "new", released_at: "2024-01-01" },
        ],
        Date.parse("2025-01-01"),
      ).tag_name,
    ).toBe("new");
  });
  it("redacts tokens and URL query strings from errors", () =>
    expect(
      publicError(
        new Error("https://secret@github.com/o/r?token=hidden ghp_abcdef"),
      ),
    ).not.toMatch(/secret|hidden|ghp_/));
});
