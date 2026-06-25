import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");
const outputPath = path.join(dataDir, "items.json");

const MAX_ITEMS = 700;
const BESTBLOGS_RSS = "https://www.bestblogs.dev/zh/feeds/rss?category=ai&minScore=80";
const AI_NEWS_JSON = "https://raw.githubusercontent.com/SuYxh/ai-news-aggregator/main/data/latest-24h.json";

const seedItems = [
  {
    id: "seed-bestblogs",
    title: "BestBlogs AI 高分 RSS 源已配置",
    url: "https://www.bestblogs.dev/zh/feeds/rss?category=ai&minScore=80",
    sourceFamily: "BestBlogs",
    sourceName: "BestBlogs",
    siteName: "BestBlogs",
    publishedAt: new Date().toISOString(),
    summary: "运行 npm run update 后会替换为实时数据。",
    tags: ["AI", "RSS"],
    score: null
  },
  {
    id: "seed-ai-news",
    title: "ai-news-aggregator 静态 JSON 源已配置",
    url: "https://github.com/SuYxh/ai-news-aggregator",
    sourceFamily: "ai-news-aggregator",
    sourceName: "SuYxh/ai-news-aggregator",
    siteName: "ai-news-aggregator",
    publishedAt: new Date().toISOString(),
    summary: "运行 npm run update 后会拉取 latest-24h.json。",
    tags: ["AI", "JSON"],
    score: null
  }
];

async function main() {
  await mkdir(dataDir, { recursive: true });

  const warnings = [];
  const batches = await Promise.allSettled([fetchBestBlogs(), fetchAiNewsAggregator()]);
  const items = [];

  for (const result of batches) {
    if (result.status === "fulfilled") {
      items.push(...result.value.items);
      warnings.push(...result.value.warnings);
    } else {
      warnings.push(result.reason?.message ?? String(result.reason));
    }
  }

  let normalized = dedupe(items)
    .sort((a, b) => dateValue(b.publishedAt) - dateValue(a.publishedAt))
    .slice(0, MAX_ITEMS);

  if (normalized.length === 0) {
    throw new Error("No live items were fetched; preserving existing data instead of publishing seed data.");
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    itemCount: normalized.length,
    maxItems: MAX_ITEMS,
    sources: [
      { name: "BestBlogs", type: "rss", url: BESTBLOGS_RSS },
      { name: "ai-news-aggregator", type: "json", url: AI_NEWS_JSON }
    ],
    warnings,
    items: normalized
  };

  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Wrote ${normalized.length} items to ${path.relative(process.cwd(), outputPath)}`);
  if (warnings.length > 0) {
    console.warn(`Warnings: ${warnings.join(" | ")}`);
  }
}

async function fetchBestBlogs() {
  const xml = await fetchText(BESTBLOGS_RSS);
  const itemBlocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => match[1]);
  const items = itemBlocks.map((block, index) => {
    const title = readXmlTag(block, "title");
    const url = readXmlTag(block, "link");
    const description = cleanText(readXmlTag(block, "description"));
    const keywords = splitTags(readXmlTag(block, "keywords"));
    const category = readXmlTag(block, "category");
    const author = readXmlTag(block, "author");
    const scoreText = readXmlTag(block, "score");

    return normalizeItem({
      id: readXmlTag(block, "guid") || `bestblogs-${index}`,
      title,
      url,
      sourceFamily: "BestBlogs",
      sourceName: author || "BestBlogs",
      siteName: "BestBlogs",
      publishedAt: parseDate(readXmlTag(block, "pubDate")),
      summary: description,
      tags: [...new Set([category, ...keywords].filter(Boolean))],
      score: Number.isFinite(Number(scoreText)) ? Number(scoreText) : null
    });
  }).filter(Boolean);

  return { items, warnings: [] };
}

async function fetchAiNewsAggregator() {
  const data = await fetchJson(AI_NEWS_JSON);
  const rawItems = Array.isArray(data.items) ? data.items : [];
  const items = rawItems.map((item) => normalizeItem({
    id: item.id,
    title: item.title_bilingual || item.title_zh || item.title_en || item.title,
    url: item.url,
    sourceFamily: "ai-news-aggregator",
    sourceName: item.source || item.site_name || "ai-news-aggregator",
    siteName: item.site_name || item.site_id || "ai-news-aggregator",
    publishedAt: item.published_at || item.first_seen_at || item.last_seen_at,
    summary: item.title_original && item.title_original !== item.title ? item.title_original : "",
    tags: [item.site_name, item.source].filter(Boolean),
    score: null
  })).filter(Boolean);

  const warnings = [];
  if (data.generated_at) warnings.push(`ai-news-aggregator generated at ${data.generated_at}`);
  return { items, warnings };
}

function normalizeItem(input) {
  const title = cleanText(input.title);
  const url = cleanUrl(input.url);
  if (!title || !url) return null;

  const publishedAt = parseDate(input.publishedAt) || new Date().toISOString();
  return {
    id: String(input.id || hash(`${title}|${url}`)),
    title,
    url,
    sourceFamily: input.sourceFamily || "Unknown",
    sourceName: cleanText(input.sourceName) || input.sourceFamily || "Unknown",
    siteName: cleanText(input.siteName) || input.sourceFamily || "Unknown",
    publishedAt,
    summary: trim(cleanText(input.summary), 360),
    tags: [...new Set((input.tags || []).map(cleanText).filter(Boolean))].slice(0, 8),
    score: Number.isFinite(input.score) ? input.score : null
  };
}

function dedupe(items) {
  const byKey = new Map();
  for (const item of items) {
    const urlKey = canonicalUrlKey(item.url);
    const titleKey = item.title.toLowerCase().replace(/\s+/g, " ").slice(0, 120);
    const key = urlKey || titleKey;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      continue;
    }
    byKey.set(key, mergeItems(existing, item));
  }
  return [...byKey.values()];
}

function mergeItems(a, b) {
  const newer = dateValue(b.publishedAt) > dateValue(a.publishedAt) ? b : a;
  const older = newer === b ? a : b;
  return {
    ...newer,
    sourceName: [...new Set([a.sourceName, b.sourceName].filter(Boolean))].join(" / "),
    siteName: [...new Set([a.siteName, b.siteName].filter(Boolean))].join(" / "),
    tags: [...new Set([...a.tags, ...b.tags])].slice(0, 10),
    summary: newer.summary || older.summary,
    score: newer.score ?? older.score
  };
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { "user-agent": "rose-briefing/0.1" } });
    if (!response.ok) throw new Error(`${url} returned ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

function readXmlTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeEntities(match[1].replace(/^<!\[CDATA\[|\]\]>$/g, "")) : "";
}

function decodeEntities(value = "") {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function cleanText(value = "") {
  return decodeEntities(String(value))
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanUrl(value = "") {
  const raw = decodeEntities(String(value)).trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function canonicalUrlKey(value = "") {
  try {
    const parsed = new URL(value);
    for (const key of [...parsed.searchParams.keys()]) {
      if (key.startsWith("utm_") || key === "entry") parsed.searchParams.delete(key);
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return value;
  }
}

function splitTags(value = "") {
  return cleanText(value).split(/[，,、]/).map((part) => part.trim()).filter(Boolean);
}

function parseDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function dateValue(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function trim(value, length) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

function hash(value) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

main().catch(async (error) => {
  console.error(error);
  if (!existsSync(outputPath)) {
    await mkdir(dataDir, { recursive: true });
    await writeFile(outputPath, `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      itemCount: seedItems.length,
      maxItems: MAX_ITEMS,
      sources: [],
      warnings: [`update failed: ${error.message}`],
      items: seedItems
    }, null, 2)}\n`, "utf8");
  } else {
    const existing = await readFile(outputPath, "utf8");
    console.warn(`Preserved existing ${existing.length} byte data file.`);
  }
  process.exitCode = 1;
});
