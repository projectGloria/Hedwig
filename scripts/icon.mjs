import { Resvg } from "@resvg/resvg-js";
import fs from "node:fs/promises";
const png = new Resvg(await fs.readFile("assets/icon.svg", "utf8"))
  .render()
  .asPng();
await fs.writeFile("assets/icon.png", png);
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header[6] = 0;
header[7] = 0;
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18);
await fs.writeFile("assets/icon.ico", Buffer.concat([header, png]));
