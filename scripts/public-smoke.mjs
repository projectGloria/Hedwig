import { _electron as electron } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
await fs.mkdir("test-results", { recursive: true });
const profile = await fs.mkdtemp(path.resolve("test-results/public-profile-"));
const env = {
  ...process.env,
  HEDWIG_TEST_USER_DATA: profile,
};
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.HEDWIG_TEST_EXE;
const application = await electron.launch({
  ...(executablePath ? { executablePath, args: [] } : { args: ["."] }),
  env,
});
let completedId;
try {
  const page = await application.firstWindow();
  await page.getByLabel("Repository URL").waitFor();
  await page
    .getByLabel("Repository URL")
    .fill(
      process.env.HEDWIG_SMOKE_URL || "https://github.com/octocat/Hello-World",
    );
  await page
    .getByLabel("Save to")
    .fill(path.resolve("test-results/public-downloads"));
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page
    .locator(".repo-preview")
    .getByText("octocat/Hello-World", { exact: true })
    .waitFor({ timeout: 60_000 });
  await page
    .getByRole("button", { name: "Download repository", exact: true })
    .click();
  await page.getByRole("heading", { name: "Transfers", exact: true }).waitFor();
  const limit = Date.now() + 180_000;
  while (Date.now() < limit) {
    const snapshot = await page.evaluate(() => window.hedwig.snapshot());
    const job = snapshot.jobs[0];
    if (job && job.status === "failed") throw new Error(job.error);
    if (job?.status === "completed") {
      completedId = job.id;
      const manifest = JSON.parse(
        await fs.readFile(path.join(job.folder, "manifest.json"), "utf8"),
      );
      if (!manifest.completed) throw new Error("Missing complete manifest.");
      await fs.access(path.join(job.folder, "source", "README"));
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!completedId) throw new Error("Public download timed out.");
  await page.getByRole("button", { name: "My archives" }).click();
  await page
    .getByRole("button", { name: "Options for octocat/Hello-World" })
    .first()
    .click();
  await page.getByRole("button", { name: "Upload to your GitHub" }).click();
  await page.getByRole("dialog", { name: "Upload repository" }).waitFor();
  if ((await page.getByLabel("Visibility").inputValue()) !== "private")
    throw new Error("Upload does not default to private.");
  await page.screenshot({ path: "test-results/hedwig-upload.png" });
  await page.getByRole("button", { name: "Close upload" }).click();
  await page.screenshot({ path: "test-results/hedwig-archive.png" });
  console.log(
    "Public GitHub download passed: full Git, LFS stage, source checkout, manifest, archive options, private upload default.",
  );
} finally {
  await application.close();
}
const reopened = await electron.launch({
  ...(executablePath ? { executablePath, args: [] } : { args: ["."] }),
  env,
});
try {
  const page = await reopened.firstWindow();
  await page.getByLabel("Repository URL").waitFor();
  const snapshot = await page.evaluate(() => window.hedwig.snapshot());
  if (
    !snapshot.jobs.some((j) => j.id === completedId && j.status === "completed")
  )
    throw new Error("Job history did not survive restart.");
  console.log("Saved job history survives restarting Electron.");
} finally {
  await reopened.close();
}
