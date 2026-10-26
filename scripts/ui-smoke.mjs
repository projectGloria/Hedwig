import { _electron as electron } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
const userData = path.resolve("test-results/ui-profile");
await fs.mkdir("test-results", { recursive: true });
const env = { ...process.env, HEDWIG_TEST_USER_DATA: userData };
delete env.ELECTRON_RUN_AS_NODE;
const exe = process.env.HEDWIG_TEST_EXE;
const application = await electron.launch({
  ...(exe ? { executablePath: exe, args: [] } : { args: ["."] }),
  env,
});
try {
  const page = await application.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page
    .getByRole("heading", { name: "Keep the code. Keep the release." })
    .waitFor();
  await page.screenshot({
    path: "test-results/hedwig-home.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Connected accounts" }).click();
  await page.getByRole("dialog", { name: "Connected accounts" }).waitFor();
  await page.getByText("One-time app registration").first().click();
  await page.screenshot({ path: "test-results/hedwig-accounts.png" });
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.getByRole("heading", { name: "Transfer history" }).waitFor();
  await page.getByRole("button", { name: "New download" }).first().click();
  await page
    .getByLabel("Repository URL")
    .fill("https://example.org/unsupported/repo");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Only HTTPS repositories" })
    .waitFor();
  // Exercise safeStorage in the real Electron main process without storing any real credentials.
  const secure = await application.evaluate(({ safeStorage }) => {
    const value = "hedwig-test-secret";
    return (
      safeStorage.isEncryptionAvailable() &&
      safeStorage.decryptString(safeStorage.encryptString(value)) === value
    );
  });
  if (!secure)
    throw new Error("Windows credential encryption round-trip failed.");
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    "Electron UI smoke passed: navigation, account setup, URL validation, encrypted storage.",
  );
} finally {
  await application.close();
}
