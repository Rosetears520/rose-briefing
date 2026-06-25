import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

for (const file of ["index.html", "styles.css", "app.js", "favicon.svg"]) {
  await cp(path.join(rootDir, file), path.join(distDir, file));
}

await cp(path.join(rootDir, "data"), path.join(distDir, "data"), { recursive: true });

console.log(`Built static site at ${path.relative(process.cwd(), distDir)}`);
