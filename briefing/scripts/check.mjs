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
if (payload.items.length < 1000) throw new Error(`Expected expanded data set, got only ${payload.items.length} items`);

const sourceFamilies = new Set(payload.items.map((item) => item.sourceFamily));
for (const expected of ["BestBlogs", "ai-news-aggregator", "X/Twitter"]) {
  if (!sourceFamilies.has(expected)) throw new Error(`Missing expected source family: ${expected}`);
}

const xItems = payload.items.filter((item) => item.sourceFamily === "X/Twitter");
if (xItems.length < 50) throw new Error(`Expected X/Twitter items, got only ${xItems.length}`);

const aggregatorPlatforms = new Set(
  payload.items
    .filter((item) => item.sourceFamily === "ai-news-aggregator")
    .map((item) => item.siteName)
    .filter(Boolean)
);
if (aggregatorPlatforms.size < 8) {
  throw new Error(`Expected broad ai-news-aggregator platform coverage, got ${aggregatorPlatforms.size}`);
}

const generatedAt = new Date(payload.generatedAt).getTime();
if (!Number.isNaN(generatedAt)) {
  const maxFutureSkewMs = 60 * 60 * 1000;
  const futureItem = payload.items.find((item) => new Date(item.publishedAt).getTime() > generatedAt + maxFutureSkewMs);
  if (futureItem) {
    throw new Error(`Item publishedAt is unexpectedly after generatedAt: ${futureItem.title} (${futureItem.publishedAt})`);
  }
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
