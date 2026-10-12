import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

process.chdir(fileURLToPath(new URL(".", import.meta.url)));
const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
await build({
  absWorkingDir: fileURLToPath(new URL(".", import.meta.url)),
  entryPoints: [fileURLToPath(new URL("src/main.js", import.meta.url))],
  tsconfigRaw: {},
  outfile: "main.js",
  bundle: true,
  external: ["obsidian"],
  platform: "browser",
  format: "cjs",
  target: "es2018",
  banner: { js: `/* ${manifest.name} v${manifest.version} | MIT License | Built from src/ */` },
});
console.log(`Built ${manifest.name} v${manifest.version}.`);
