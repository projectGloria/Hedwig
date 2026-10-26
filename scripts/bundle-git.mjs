import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
const destination = path.resolve("vendor/git");
const gitExe = process.env.HEDWIG_GIT_ROOT
  ? path.join(process.env.HEDWIG_GIT_ROOT, "cmd/git.exe")
  : execFileSync("where.exe", ["git"], { encoding: "utf8" })
      .trim()
      .split(/\r?\n/)[0];
const source = path.resolve(path.dirname(gitExe), "..");
if (source === destination || !path.isAbsolute(source))
  throw new Error("Invalid Git distribution root.");
await fs.access(path.join(source, "LICENSE.txt"));
const version = execFileSync(gitExe, ["--version"], {
  encoding: "utf8",
}).trim();
const lfs = execFileSync(gitExe, ["lfs", "version"], {
  encoding: "utf8",
}).trim();
await fs.mkdir(destination, { recursive: true });
for (const name of [
  "bin",
  "cmd",
  "etc",
  "usr",
  "ucrt64",
  "mingw64",
  "LICENSE.txt",
]) {
  const item = path.join(source, name);
  try {
    await fs.access(item);
  } catch {
    continue;
  }
  await fs.cp(item, path.join(destination, name), {
    recursive: true,
    force: true,
  });
}
// Git for Windows carries its component license notices in usr/share/licenses and */share/licenses.
// Include the explicit LFS MIT license as well, since not every installed distribution includes it.
const license = await fetch(
  "https://raw.githubusercontent.com/git-lfs/git-lfs/main/LICENSE.md",
);
if (!license.ok) throw new Error("Could not retrieve the Git LFS license.");
await fs.writeFile(
  path.join(destination, "GIT-LFS-LICENSE.md"),
  await license.text(),
);
await fs.writeFile(
  path.join(destination, "HEDWIG-DISTRIBUTION.txt"),
  `Bundled unmodified Git for Windows distribution\n${version}\n${lfs}\n\nGit for Windows source, build recipes and release source archives:\nhttps://github.com/git-for-windows/git/releases\nhttps://github.com/git-for-windows/build-extra\nGit LFS source: https://github.com/git-lfs/git-lfs/releases\nComponent notices: LICENSE.txt, usr/share/licenses, ucrt64/share/licenses (or mingw64/share/licenses).\n`,
);
execFileSync(path.join(destination, "cmd/git.exe"), ["--version"], {
  stdio: "inherit",
});
execFileSync(path.join(destination, "cmd/git.exe"), ["lfs", "version"], {
  stdio: "inherit",
});
console.log("Git and LFS bundled with license notices.");
