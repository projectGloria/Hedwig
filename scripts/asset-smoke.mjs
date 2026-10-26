import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
await fs.mkdir("test-results", { recursive: true });
await build({
  stdin: {
    contents:
      'export { Http } from "./electron/http"; export { downloadAsset } from "./electron/download";',
    resolveDir: process.cwd(),
  },
  outfile: "test-results/asset-smoke-lib.mjs",
  platform: "node",
  format: "esm",
  bundle: true,
});
const { Http, downloadAsset } = await import(
  pathToFileURL(path.resolve("test-results/asset-smoke-lib.mjs")).toString()
);
const http = new Http(async () => undefined);
const release = await http.json("github", "/repos/jqlang/jq/releases/latest");
const asset = release.assets.find(
  (a) => /sha256sum|checksum/i.test(a.name) && a.size < 100_000,
);
if (!asset)
  throw new Error(
    "No small checksum asset available for this live smoke test.",
  );
const receipt = await downloadAsset(
  http,
  {
    id: String(asset.id),
    name: asset.name,
    url: asset.url,
    size: asset.size,
    digest: asset.digest,
  },
  path.resolve("test-results/live-release-checksums.txt"),
  AbortSignal.timeout(60_000),
  () => {},
);
if (!receipt.size) throw new Error("Empty release asset.");
console.log(
  `Live release download passed: jqlang/jq ${release.tag_name}, ${asset.name}, ${receipt.size} bytes, SHA-256 ${receipt.sha256}.`,
);
