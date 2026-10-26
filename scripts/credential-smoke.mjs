import { spawnSync } from "node:child_process";
import path from "node:path";
const exe = process.env.HEDWIG_TEST_EXE || (await import("electron")).default;
const helper = process.env.HEDWIG_TEST_EXE
  ? path.join(
      path.dirname(exe),
      "resources/app.asar/dist-electron/credential-helper.cjs",
    )
  : path.resolve("dist-electron/credential-helper.cjs");
for (const [host, expected] of [
  ["github.com", "github-test-token"],
  ["gitlab.com", "gitlab-test-token"],
  ["unrelated.example.com", ""],
]) {
  const result = spawnSync(exe, [helper, "get"], {
    input: `protocol=https\nhost=${host}\n\n`,
    encoding: "utf8",
    windowsHide: true,
    timeout: 20_000,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      HEDWIG_GITHUB_TOKEN: "github-test-token",
      HEDWIG_GITLAB_TOKEN: "gitlab-test-token",
    },
  });
  if (
    result.status !== 0 ||
    (expected
      ? !result.stdout.includes(`password=${expected}`)
      : result.stdout.trim() !== "")
  )
    throw new Error(
      `Credential-helper check failed for ${host}: ${result.error?.message || result.stderr}`,
    );
}
console.log(
  "Packaged credential helper passed: GitHub/GitLab credentials are available only to their own hosts.",
);
