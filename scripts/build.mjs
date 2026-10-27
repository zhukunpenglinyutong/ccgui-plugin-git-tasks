import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [resolve(root, "src/main.js")],
  outfile: resolve(root, "main.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  legalComments: "none",
  logLevel: "info",
  banner: {
    js: "/* github-tasks · built from src/ by scripts/build.mjs — do not edit by hand */",
  },
});

// 市场 Release 从 dist/ 取三件套；本地「从目录安装」仍用根目录 main.js。
const dist = resolve(root, "dist");
await mkdir(dist, { recursive: true });
for (const file of ["main.js", "manifest.json", "styles.css"]) {
  await copyFile(resolve(root, file), resolve(dist, file));
}
