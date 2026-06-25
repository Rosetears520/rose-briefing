import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const REQUIRED_FILES = [
  "index.html",
  "styles.css",
  "app.js",
  "data/items.json",
  "dist/index.html",
  "dist/styles.css",
  "dist/app.js",
  "dist/data/items.json"
];

const ITEM_KEYS = [
  "id",
  "title",
  "url",
  "publishedAt",
  "summary",
  "score",
  "family",
  "channel",
  "publisher",
  "collection",
  "topic",
  "language",
  "originType"
];

const LEGACY_KEYS = ["sourceFamily", "sourceName", "siteName", "tags"];
const REQUIRED_FAMILIES = ["curated", "aggregator", "community", "official"];
const ALLOWED_FAMILIES = new Set(REQUIRED_FAMILIES);
const ALLOWED_CHANNELS = new Set(["curated-rss", "official-rss", "official-social", "community-social", "aggregator-json"]);
const ALLOWED_CHANNELS_BY_FAMILY = new Map([
  ["curated", new Set(["curated-rss"])],
  ["aggregator", new Set(["aggregator-json"])],
  ["community", new Set(["community-social"])],
  ["official", new Set(["official-rss", "official-social"])]
]);
const REQUIRED_SOURCE_NAMES = ["BestBlogs", "ai-news-aggregator", "X/Twitter via SuYxh OPML", "Hugging Face Blog"];
const REQUIRED_OFFICIAL_RSS_COLLECTIONS = ["Hugging Face Blog"];

for (const relativePath of REQUIRED_FILES) {
  await access(path.join(rootDir, relativePath));
}

const payload = JSON.parse(await readFile(path.join(rootDir, "data/items.json"), "utf8"));
if (!Array.isArray(payload.items)) throw new Error("data/items.json must contain an items array");
if (!Array.isArray(payload.sources)) throw new Error("data/items.json must contain a sources array");
if (payload.items.length === 0) throw new Error("data/items.json has no items");
if (payload.items.length < 1000) throw new Error(`Expected expanded data set, got only ${payload.items.length} items`);

const sourceNames = new Set(payload.sources.map((source) => source?.name).filter(Boolean));
for (const expected of REQUIRED_SOURCE_NAMES) {
  if (!sourceNames.has(expected)) throw new Error(`Missing required source entry: ${expected}`);
}

const families = new Set(payload.items.map((item) => item.family));
for (const expected of REQUIRED_FAMILIES) {
  if (!families.has(expected)) throw new Error(`Missing expected family: ${expected}`);
}

const communityItems = payload.items.filter((item) => item.family === "community");
if (communityItems.length < 50) throw new Error(`Expected community items, got only ${communityItems.length}`);

const officialItems = payload.items.filter((item) => item.family === "official");
if (officialItems.length < 50) throw new Error(`Expected official items, got only ${officialItems.length}`);
const officialRssItems = officialItems.filter((item) => item.channel === "official-rss");
if (officialRssItems.length < 20) throw new Error(`Expected official RSS items, got only ${officialRssItems.length}`);
const officialRssFeeds = new Set(officialRssItems.map((item) => item.collection).filter(Boolean));
if (officialRssFeeds.size < 3) throw new Error(`Expected at least 3 official RSS feeds, got ${officialRssFeeds.size}`);
for (const expected of REQUIRED_OFFICIAL_RSS_COLLECTIONS) {
  if (!officialRssFeeds.has(expected)) throw new Error(`Missing required official RSS collection: ${expected}`);
}
const officialSocialItems = officialItems.filter((item) => item.channel === "official-social");
if (officialSocialItems.length < 50) throw new Error(`Expected official social items, got only ${officialSocialItems.length}`);
for (const item of officialSocialItems) {
  if (!isOfficialSocialPostUrl(item.url, item.publisher)) {
    throw new Error(`Official social item URL does not match publisher handle: ${item.publisher} -> ${item.url}`);
  }
}

const aggregatorCollections = new Set(
  payload.items
    .filter((item) => item.family === "aggregator")
    .map((item) => item.collection)
    .filter(Boolean)
);
if (aggregatorCollections.size < 8) {
  throw new Error(`Expected broad ai-news-aggregator platform coverage, got ${aggregatorCollections.size}`);
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
  assertItemShape(item);
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

function assertItemShape(item) {
  const keys = Object.keys(item).sort();
  const expectedKeys = [...ITEM_KEYS].sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error(`Invalid item keys: ${JSON.stringify(keys)}`);
  }

  for (const legacyKey of LEGACY_KEYS) {
    if (legacyKey in item) {
      throw new Error(`Legacy taxonomy field must not be published: ${legacyKey}`);
    }
  }

  if (!item.id || !item.title || !item.url || !item.family || !item.channel || !item.publisher || !item.collection || !item.originType) {
    throw new Error(`Invalid item shape: ${JSON.stringify(item)}`);
  }
  if (!ALLOWED_FAMILIES.has(item.family)) {
    throw new Error(`Unknown family: ${item.family}`);
  }
  if (!ALLOWED_CHANNELS.has(item.channel)) {
    throw new Error(`Unknown channel: ${item.channel}`);
  }
  const allowedChannels = ALLOWED_CHANNELS_BY_FAMILY.get(item.family);
  if (!allowedChannels?.has(item.channel)) {
    throw new Error(`Invalid family/channel pairing: ${item.family}/${item.channel}`);
  }
  if (!Array.isArray(item.topic)) {
    throw new Error(`topic must be an array: ${JSON.stringify(item)}`);
  }
  if (!item.topic.every((value) => typeof value === "string")) {
    throw new Error(`topic must contain only strings: ${JSON.stringify(item)}`);
  }
  if (!(item.language === null || typeof item.language === "string")) {
    throw new Error(`language must be string|null: ${JSON.stringify(item)}`);
  }
  if (!(item.score === null || Number.isFinite(item.score))) {
    throw new Error(`score must be number|null: ${JSON.stringify(item)}`);
  }
}

function isOfficialSocialPostUrl(value, publisher) {
  const handle = String(publisher || "").match(/@([A-Za-z0-9_]+)/)?.[1]?.toLowerCase();
  if (!handle) return false;
  try {
    const parsed = new URL(String(value));
    if (!["x.com", "twitter.com"].includes(parsed.hostname.toLowerCase())) return false;
    return parsed.pathname.split("/").filter(Boolean)[0]?.toLowerCase() === handle;
  } catch {
    return false;
  }
}
