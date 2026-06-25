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
for (const expected of ["BestBlogs", "ai-news-aggregator", "X/Twitter", "Official"]) {
  if (!sourceFamilies.has(expected)) throw new Error(`Missing expected source family: ${expected}`);
}

const xItems = payload.items.filter((item) => item.sourceFamily === "X/Twitter");
if (xItems.length < 50) throw new Error(`Expected X/Twitter items, got only ${xItems.length}`);

const officialItems = payload.items.filter((item) => item.sourceFamily === "Official");
if (officialItems.length < 50) throw new Error(`Expected Official items, got only ${officialItems.length}`);
const officialRssItems = officialItems.filter((item) => officialChannel(item) === "official-rss");
if (officialRssItems.length < 20) throw new Error(`Expected Official RSS items, got only ${officialRssItems.length}`);
const officialRssFeeds = new Set(officialRssItems.map((item) => item.sourceName).filter(Boolean));
if (officialRssFeeds.size < 3) throw new Error(`Expected at least 3 Official RSS feeds, got ${officialRssFeeds.size}`);
const officialXItems = officialItems.filter((item) => officialChannel(item) === "official-x");
if (officialXItems.length < 50) throw new Error(`Expected Official X items, got only ${officialXItems.length}`);
for (const item of officialXItems) {
  if (!isOfficialXPostUrl(item.url, item.sourceName)) {
    throw new Error(`Official X item URL does not match source handle: ${item.sourceName} -> ${item.url}`);
  }
}

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
if (/<(?:script|link|style)[^>]+(?:src|href)\s*=\s*["']https?:\/\//i.test(index)) {
  throw new Error("index.html should not depend on external scripts/styles");
}

console.log(`Check passed with ${payload.items.length} items.`);

function officialChannel(item) {
  if (item.channel) return item.channel;
  return isXPostUrl(item.url) ? "official-x" : "official-rss";
}

function isXPostUrl(value) {
  try {
    const parsed = new URL(String(value));
    return ["x.com", "twitter.com"].includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function isOfficialXPostUrl(value, sourceName) {
  const handle = String(sourceName || "").match(/@([A-Za-z0-9_]+)/)?.[1]?.toLowerCase();
  if (!handle) return false;
  try {
    const parsed = new URL(String(value));
    if (!["x.com", "twitter.com"].includes(parsed.hostname.toLowerCase())) return false;
    return parsed.pathname.split("/").filter(Boolean)[0]?.toLowerCase() === handle;
  } catch {
    return false;
  }
}
