import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const required = [
  "index.html",
  "styles.css",
  "app.js",
  "data/items.json",
  "dist/index.html",
  "dist/styles.css",
  "dist/app.js",
  "dist/data/items.json"
];

for (const relativePath of required) {
  await access(path.join(rootDir, relativePath));
}

const payload = JSON.parse(await readFile(path.join(rootDir, "data/items.json"), "utf8"));
if (!Array.isArray(payload.items)) throw new Error("data/items.json must contain an items array");
if (payload.items.length === 0) throw new Error("data/items.json has no items");

const sourceFamilies = new Set(payload.items.map((item) => item.sourceFamily));
for (const expected of ["BestBlogs", "ai-news-aggregator"]) {
  if (!sourceFamilies.has(expected)) throw new Error(`Missing expected source family: ${expected}`);
}

for (const item of payload.items) {
  if (!item.title || !item.url || !item.sourceFamily) {
    throw new Error(`Invalid item shape: ${JSON.stringify(item)}`);
  }
  if (String(item.id || "").startsWith("seed-")) {
    throw new Error(`Seed item must not be deployed: ${item.id}`);
  }
  const url = new URL(item.url);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`Unsafe item URL protocol: ${item.url}`);
  }
}

const index = await readFile(path.join(rootDir, "index.html"), "utf8");
if (/https?:\/\//.test(index)) {
  throw new Error("index.html should not depend on external scripts/styles");
}

console.log(`Check passed with ${payload.items.length} items.`);
