import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Git } from "../electron/git";
import { keyFor } from "../electron/core";
const exec = promisify(execFile);
let root: string;
let git: Git;
const signal = () => new AbortController().signal;
async function command(cwd: string, ...args: string[]) {
  return (
    await exec(
      "git",
      [
        "-c",
        "user.name=Hedwig Test",
        "-c",
        "user.email=test@hedwig.local",
        "-c",
        "protocol.file.allow=always",
        ...args,
      ],
      { cwd, windowsHide: true },
    )
  ).stdout.trim();
}
async function repo(name: string) {
  const folder = path.join(root, name);
  await fs.mkdir(folder);
  await command(folder, "init", "-b", "main");
  await fs.writeFile(path.join(folder, "README.md"), name);
  await command(folder, "add", ".");
  await command(folder, "commit", "-m", "initial");
  return folder;
}
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "hedwig-git-"));
  const hooks = path.join(root, "hooks");
  await fs.mkdir(hooks);
  git = new Git({
    binary: "git",
    runtime: process.execPath,
    helper: path.resolve("dist-electron/credential-helper.cjs"),
    emptyHooks: hooks,
    token: async () => undefined,
  });
});
afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
describe("real Git archives", () => {
  it("preserves branches, tags and a separate checkout", async () => {
    const source = await repo("source");
    await command(source, "branch", "feature");
    await command(source, "tag", "v1.0");
    const mirror = path.join(root, "archive.git");
    await git.mirror(source, mirror, signal(), () => {});
    expect(
      await git.run(["show-ref", "--heads", "--tags"], mirror, signal()),
    ).toContain("refs/heads/feature");
    expect(await git.run(["show-ref", "--tags"], mirror, signal())).toContain(
      "refs/tags/v1.0",
    );
    const checkout = path.join(root, "checkout");
    await git.checkout(mirror, checkout, "main", signal(), () => {});
    expect(await fs.readFile(path.join(checkout, "README.md"), "utf8")).toBe(
      "source",
    );
  }, 30_000);
  it("fetches real LFS objects and restores content in the checkout", async () => {
    const source = await repo("lfs-source");
    await command(source, "lfs", "install", "--local");
    await command(source, "lfs", "track", "*.bin");
    await fs.writeFile(path.join(source, "asset.bin"), Buffer.alloc(65536, 7));
    await command(source, "add", ".");
    await command(source, "commit", "-m", "LFS asset");
    const mirror = path.join(root, "lfs.git");
    await git.mirror(source, mirror, signal(), () => {});
    await git.lfs(mirror, signal(), () => {});
    const checkout = path.join(root, "lfs-checkout");
    await git.checkout(mirror, checkout, "main", signal(), () => {});
    expect((await fs.readFile(path.join(checkout, "asset.bin"))).length).toBe(
      65536,
    );
    const destination = path.join(root, "lfs-destination.git");
    await command(root, "init", "--bare", destination);
    await git.push(
      mirror,
      pathToFileURL(destination).toString(),
      signal(),
      () => {},
    );
    expect(await command(destination, "rev-parse", "refs/heads/main")).toBe(
      await command(source, "rev-parse", "HEAD"),
    );
    const objectDirectories = await fs.readdir(
      path.join(destination, "lfs", "objects"),
    );
    expect(objectDirectories.length).toBeGreaterThan(0);
  }, 30_000);
  it("archives removed historical submodules and nested commits", async () => {
    const nested = await repo("nested");
    const sub = await repo("sub");
    const parent = await repo("parent");
    await command(sub, "submodule", "add", nested, "nested");
    await command(
      sub,
      "config",
      "-f",
      ".gitmodules",
      "submodule.nested.url",
      "https://github.com/fixture/nested.git",
    );
    await command(sub, "add", ".");
    await command(sub, "commit", "-m", "nested module");
    await command(parent, "submodule", "add", sub, "sub");
    await command(
      parent,
      "config",
      "-f",
      ".gitmodules",
      "submodule.sub.url",
      "https://github.com/fixture/sub.git",
    );
    await command(parent, "add", ".");
    await command(parent, "commit", "-m", "historical module");
    await command(parent, "rm", "-f", "sub");
    await command(parent, "commit", "-m", "remove module");
    const mirror = path.join(root, "parent.git");
    await git.mirror(parent, mirror, signal(), () => {});
    const destination = path.join(root, "submodules");
    await fs.mkdir(destination);
    await git.mirror(
      sub,
      path.join(destination, keyFor("https://github.com/fixture/sub.git")),
      signal(),
      () => {},
    );
    await git.mirror(
      nested,
      path.join(destination, keyFor("https://github.com/fixture/nested.git")),
      signal(),
      () => {},
    );
    await git.submodules(
      "https://github.com/fixture/parent.git",
      mirror,
      destination,
      signal(),
      () => {},
    );
    const index = JSON.parse(
      await fs.readFile(path.join(destination, "index.json"), "utf8"),
    );
    expect(index.map((i: any) => i.url)).toEqual(
      expect.arrayContaining([
        "https://github.com/fixture/sub.git",
        "https://github.com/fixture/nested.git",
      ]),
    );
    expect(index.every((i: any) => i.commits.length > 0)).toBe(true);
  }, 60_000);
  it("handles an empty repository without attempting a nonexistent default branch", async () => {
    const source = path.join(root, "empty");
    await fs.mkdir(source);
    await command(source, "init", "-b", "main");
    const mirror = path.join(root, "empty.git");
    await git.mirror(source, mirror, signal(), () => {});
    const checkout = path.join(root, "empty-checkout");
    await git.checkout(mirror, checkout, "main", signal(), () => {});
    await expect(
      fs.access(path.join(checkout, ".git")),
    ).resolves.toBeUndefined();
  }, 30_000);
});
