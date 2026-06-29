import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");
const outputPath = path.join(dataDir, "items.json");

const MAX_ITEMS = 7000;
const X_ITEMS_PER_FEED = 20;
const X_FEED_CONCURRENCY = 8;
const OFFICIAL_RSS_ITEMS_PER_FEED = 30;
const MIN_OFFICIAL_RSS_FEEDS = 3;
const MIN_OFFICIAL_RSS_ITEMS = 20;
const MIN_OFFICIAL_SOCIAL_ITEMS = 50;
const MAX_FETCH_BYTES = 8_000_000;
const MAX_AI_NEWS_FUTURE_SKEW_MS = 60 * 60 * 1000;
const MAX_RSS_FUTURE_SKEW_MS = 60 * 60 * 1000;
const MIN_ITEMS_BY_FAMILY = {
  curated: 1,
  aggregator: 1000,
  community: 50,
  official: 50
};
const ALLOWED_CHANNELS_BY_FAMILY = new Map([
  ["curated", new Set(["blogs"])],
  ["aggregator", new Set(["aggregator"])],
  ["community", new Set(["x"])],
  ["official", new Set(["blogs", "x"])]
]);

const BESTBLOGS_RSS = "https://www.bestblogs.dev/zh/feeds/rss?category=ai&minScore=80";
const AI_NEWS_JSON = "https://raw.githubusercontent.com/SuYxh/ai-news-aggregator/main/data/latest-7d.json";
const SUYXH_OPML_FEEDS_JSON = "https://raw.githubusercontent.com/SuYxh/ai-news-aggregator/main/data/opml-feeds.json";
const OFFICIAL_X_FEEDS = [
  {
    groupName: "AI Companies",
    name: "Tibo Sottiaux(@thsottiaux)",
    url: "https://nitter.net/thsottiaux/rss",
    linkHost: "x.com"
  }
];
const BESTBLOGS_SITE = "BestBlogs";
const AI_NEWS_SITE_FALLBACK = "ai-news-aggregator";
const OFFICIAL_RSS_FEEDS = [
  { org: "OpenAI", name: "OpenAI News", url: "https://openai.com/news/rss.xml", language: "en" },
  { org: "Google AI", name: "Google AI Blog", url: "https://blog.google/innovation-and-ai/technology/ai/rss/", language: "en" },
  { org: "Mistral AI", name: "Mistral AI News", url: "https://mistral.ai/rss.xml", language: "en" },
  { org: "Microsoft AI", name: "Microsoft AI", url: "https://news.microsoft.com/source/topics/ai/feed/", language: "en" },
  { org: "Qwen", name: "Qwen Blog", url: "https://qwenlm.github.io/blog/index.xml", language: "en" },
  { org: "Hugging Face", name: "Hugging Face Blog", url: "https://huggingface.co/blog/feed.xml", language: "en" }
];

const seedItems = [
  {
    id: "seed-bestblogs",
    title: "BestBlogs AI 高分 RSS 源已配置",
    url: BESTBLOGS_RSS,
    publishedAt: new Date().toISOString(),
    summary: "运行 npm run update 后会替换为实时数据。",
    score: null,
    family: "curated",
    channel: "blogs",
    site: BESTBLOGS_SITE,
    publisher: "BestBlogs",
    topic: ["ai", "rss"],
    language: "zh",
    originType: "curated-secondary"
  },
  {
    id: "seed-ai-news",
    title: "ai-news-aggregator 静态 JSON 源已配置",
    url: "https://github.com/SuYxh/ai-news-aggregator",
    publishedAt: new Date().toISOString(),
    summary: "运行 npm run update 后会拉取 latest-7d.json。",
    score: null,
    family: "aggregator",
    channel: "aggregator",
    site: AI_NEWS_SITE_FALLBACK,
    publisher: "SuYxh/ai-news-aggregator",
    topic: ["ai", "json"],
    language: "zh",
    originType: "aggregated-hotlist"
  }
];

async function main() {
  await mkdir(dataDir, { recursive: true });

  const warnings = [];
  const existingItems = await readExistingItems();
  const batches = await Promise.allSettled([fetchBestBlogs(), fetchAiNewsAggregator(), fetchOfficialRssFeeds()]);
  batches.push(await settle(fetchXgoFeeds()));
  let items = [];

  for (const result of batches) {
    if (result.status === "fulfilled") {
      items.push(...result.value.items);
      warnings.push(...result.value.warnings);
    } else {
      warnings.push(result.reason?.message ?? String(result.reason));
    }
  }

  for (const family of requiredFamilies()) {
    const minimum = MIN_ITEMS_BY_FAMILY[family] ?? 1;
    const currentCount = items.filter((item) => item.family === family).length;
    if (currentCount < minimum) {
      const fallbackItems = existingItems.filter((item) => item.family === family);
      if (fallbackItems.length >= minimum) {
        items = items.filter((item) => item.family !== family);
        items.push(...fallbackItems);
        warnings.push(`${family} fetch returned ${currentCount} items; reused ${fallbackItems.length} existing items`);
      }
    }
  }

  items = ensureOfficialSubsources(items, existingItems, warnings);

  const normalized = dedupe(items)
    .sort((a, b) => dateValue(b.publishedAt) - dateValue(a.publishedAt))
    .slice(0, MAX_ITEMS);

  if (normalized.length === 0) {
    throw new Error("No live items were fetched; preserving existing data instead of publishing seed data.");
  }

  assertRequiredSources(normalized);

  const payload = {
    generatedAt: new Date().toISOString(),
    itemCount: normalized.length,
    maxItems: MAX_ITEMS,
    sources: [
      { name: "BestBlogs", type: "rss", url: BESTBLOGS_RSS },
      { name: "ai-news-aggregator", type: "json", url: AI_NEWS_JSON },
      ...OFFICIAL_RSS_FEEDS.map((feed) => ({ name: feed.name, type: "rss", url: feed.url })),
      ...OFFICIAL_X_FEEDS.map((feed) => ({ name: feed.name, type: "rss", url: feed.url })),
      { name: "X/Twitter via SuYxh OPML", type: "rss", url: SUYXH_OPML_FEEDS_JSON }
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

async function readExistingItems() {
  if (!existsSync(outputPath)) return [];
  try {
    const payload = JSON.parse(await readFile(outputPath, "utf8"));
    return Array.isArray(payload.items)
      ? payload.items.map((item) => normalizeItem(item)).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function assertRequiredSources(items) {
  const families = new Set(items.map((item) => item.family));
  for (const expected of requiredFamilies()) {
    if (!families.has(expected)) {
      throw new Error(`Missing required family ${expected}; preserving existing data instead of publishing partial data.`);
    }
    const count = items.filter((item) => item.family === expected).length;
    const minimum = MIN_ITEMS_BY_FAMILY[expected] ?? 1;
    if (count < minimum) {
      throw new Error(`Family ${expected} has only ${count} items; preserving existing data instead of publishing partial data.`);
    }
  }

  const officialBlogsCount = countOfficialChannel(items, "blogs");
  if (officialBlogsCount < MIN_OFFICIAL_RSS_ITEMS) {
    throw new Error(`Official blogs has only ${officialBlogsCount} items; preserving existing data instead of publishing partial data.`);
  }
  const officialBlogSites = countOfficialBlogSites(items);
  if (officialBlogSites < MIN_OFFICIAL_RSS_FEEDS) {
    throw new Error(`Official blogs has only ${officialBlogSites} sites; preserving existing data instead of publishing partial data.`);
  }
  const officialXCount = countOfficialChannel(items, "x");
  if (officialXCount < MIN_OFFICIAL_SOCIAL_ITEMS) {
    throw new Error(`Official X has only ${officialXCount} items; preserving existing data instead of publishing partial data.`);
  }
}

function ensureOfficialSubsources(items, existingItems, warnings) {
  const officialBlogsCount = countOfficialChannel(items, "blogs");
  const officialBlogSites = countOfficialBlogSites(items);
  const officialXCount = countOfficialChannel(items, "x");
  if (officialBlogsCount >= MIN_OFFICIAL_RSS_ITEMS && officialBlogSites >= MIN_OFFICIAL_RSS_FEEDS && officialXCount >= MIN_OFFICIAL_SOCIAL_ITEMS) {
    return items;
  }

  const existingOfficial = existingItems.filter((item) => item.family === "official");
  const existingBlogsCount = countOfficialChannel(existingOfficial, "blogs");
  const existingBlogSites = countOfficialBlogSites(existingOfficial);
  const existingXCount = countOfficialChannel(existingOfficial, "x");
  if (existingBlogsCount >= MIN_OFFICIAL_RSS_ITEMS && existingBlogSites >= MIN_OFFICIAL_RSS_FEEDS && existingXCount >= MIN_OFFICIAL_SOCIAL_ITEMS) {
    warnings.push(`Official subsource coverage low (blogs ${officialBlogsCount}/${officialBlogSites} sites, x ${officialXCount}); reused ${existingOfficial.length} existing official items`);
    return [...items.filter((item) => item.family !== "official"), ...existingOfficial];
  }

  return items;
}

function countOfficialChannel(items, channel) {
  return items.filter((item) => item.family === "official" && item.channel === channel).length;
}

function countOfficialBlogSites(items) {
  return new Set(items
    .filter((item) => item.family === "official" && item.channel === "blogs")
    .map((item) => item.site)
    .filter(Boolean)).size;
}

function requiredFamilies() {
  return ["curated", "aggregator", "community", "official"];
}

async function settle(promise) {
  try {
    return { status: "fulfilled", value: await promise };
  } catch (error) {
    return { status: "rejected", reason: error };
  }
}

async function fetchBestBlogs() {
  const xml = await fetchText(BESTBLOGS_RSS);
  const itemBlocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => match[1]);
  const items = itemBlocks.map((block, index) => {
    const title = readXmlTag(block, "title");
    const url = readXmlTag(block, "link");
    const description = readXmlTag(block, "description");
    const descriptionText = cleanText(description);
    const keywords = splitTags(readXmlTag(block, "keywords"));
    const category = readXmlTag(block, "category");
    const author = readXmlTag(block, "author");
    const scoreText = readXmlTag(block, "score");

    return normalizeItem({
      id: readXmlTag(block, "guid") || `bestblogs-${index}`,
      title,
      url,
      publishedAt: normalizeRssDate(readXmlTag(block, "pubDate")),
      summary: descriptionText,
      score: Number.isFinite(Number(scoreText)) ? Number(scoreText) : null,
      family: "curated",
      channel: "blogs",
      site: BESTBLOGS_SITE,
      publisher: extractBestBlogsSource(descriptionText) || author || "BestBlogs",
      topic: [...new Set([category, ...keywords].filter(Boolean))],
      language: extractBestBlogsLanguage(descriptionText) || detectLanguage([title, descriptionText]),
      originType: "curated-secondary"
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
    publishedAt: normalizeAiNewsDate(item),
    summary: item.title_original && item.title_original !== item.title ? item.title_original : "",
    score: null,
    family: "aggregator",
    channel: "aggregator",
    site: item.site_name || item.site_id || item.source || AI_NEWS_SITE_FALLBACK,
    publisher: item.source || item.publication || item.site_name || item.site_id || AI_NEWS_SITE_FALLBACK,
    topic: [],
    language: detectLanguage([item.title_original, item.title_zh, item.title_en, item.title]),
    originType: "aggregated-hotlist"
  })).filter(Boolean);

  const warnings = [];
  if (data.generated_at) {
    warnings.push(`ai-news-aggregator latest-7d: ${rawItems.length} raw items, ${data.site_count ?? "?"} platforms, ${data.source_count ?? "?"} sources`);
  }
  return { items, warnings };
}

async function fetchOfficialRssFeeds() {
  const feedResults = await mapWithConcurrency(OFFICIAL_RSS_FEEDS, 4, async (feed) => {
    const items = await fetchRssItems(feed.url, {
      family: "official",
      channel: "blogs",
      site: feed.name,
      publisher: feed.org,
      language: feed.language,
      originType: "direct-official"
    }, OFFICIAL_RSS_ITEMS_PER_FEED);
    return { items };
  });

  const items = [];
  const failures = [];
  for (const result of feedResults) {
    if (result.status === "fulfilled") items.push(...result.value.items);
    else failures.push(result.reason?.message ?? String(result.reason));
  }

  const warnings = [`Official RSS: ${items.length} items from ${OFFICIAL_RSS_FEEDS.length - failures.length}/${OFFICIAL_RSS_FEEDS.length} feeds`];
  if (failures.length > 0) warnings.push(`Official RSS failed feeds: ${failures.length}`);
  return { items, warnings };
}

async function fetchRssItems(url, defaults, limit) {
  const xml = await fetchText(url);
  const itemBlocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => match[1]);
  return itemBlocks.slice(0, limit).map((block, index) => normalizeItem({
    id: readXmlTag(block, "guid") || readXmlTag(block, "link") || `${defaults.family}-${hash(`${url}-${index}`)}`,
    title: readXmlTag(block, "title"),
    url: readXmlTag(block, "link"),
    publishedAt: normalizeRssDate(readXmlTag(block, "pubDate") || readXmlTag(block, "dc:date")),
    summary: readXmlTag(block, "description"),
    score: null,
    family: defaults.family,
    channel: defaults.channel,
    site: defaults.site,
    publisher: readXmlTag(block, "dc:creator") || readXmlTag(block, "author") || defaults.publisher,
    topic: splitTags(readXmlTag(block, "category")),
    language: defaults.language,
    originType: defaults.originType
  })).filter(Boolean);
}

async function fetchXgoFeeds() {
  const groups = await fetchJson(SUYXH_OPML_FEEDS_JSON);
  const feeds = [...flattenXgoFeeds(groups), ...OFFICIAL_X_FEEDS];
  const feedResults = await mapWithConcurrency(feeds, X_FEED_CONCURRENCY, fetchOneXgoFeed);
  const items = [];
  const failures = [];

  for (const result of feedResults) {
    if (result.status === "fulfilled") {
      items.push(...result.value.items);
    } else {
      failures.push(result.reason?.message ?? String(result.reason));
    }
  }

  const officialCount = items.filter((item) => item.family === "official").length;
  const communityCount = items.filter((item) => item.family === "community").length;
  const warnings = [`xgo feeds: ${officialCount} official items, ${communityCount} community items from ${feeds.length - failures.length}/${feeds.length} feeds`];
  if (failures.length > 0) warnings.push(`X/Twitter failed feeds: ${failures.length}`);
  return { items, warnings };
}

function flattenXgoFeeds(groups) {
  if (!Array.isArray(groups)) return [];
  return groups.flatMap((group) => (group.feeds || [])
    .filter((feed) => isSafeXgoFeedUrl(feed.url))
    .map((feed) => ({
      groupName: group.name || "X/Twitter",
      name: feed.name || "X/Twitter",
      url: feed.url
    })));
}

function isSafeXgoFeedUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname === "api.xgo.ing";
  } catch {
    return false;
  }
}

async function fetchOneXgoFeed(feed) {
  const xml = await fetchText(feed.url);
  const itemBlocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => match[1]);
  const official = isOfficialXgoFeed(feed);
  const items = itemBlocks.slice(0, X_ITEMS_PER_FEED).map((block, index) => {
    const itemUrl = canonicalXItemUrl(feed, readXmlTag(block, "link"), readXmlTag(block, "guid"));
    const officialItem = official && isOfficialXgoItemUrl(feed, itemUrl);
    const title = readXmlTag(block, "title");
    const summary = readXmlTag(block, "description");
    return normalizeItem({
      id: readXmlTag(block, "guid") || `xgo-${hash(`${feed.url}-${index}`)}`,
      title,
      url: itemUrl,
      publishedAt: normalizeRssDate(readXmlTag(block, "pubDate") || readXmlTag(block, "dc:date")),
      summary,
      score: null,
      family: officialItem ? "official" : "community",
      channel: "x",
      site: "X/Twitter",
      publisher: feed.name,
      topic: [],
      language: detectLanguage([title, summary]),
      originType: officialItem ? "official-social" : "community-post"
    });
  }).filter(Boolean);

  return { items };
}

function canonicalXItemUrl(feed, value, guid) {
  if (feed.linkHost !== "x.com") return value;
  const handle = officialHandle(feed);
  const statusId = statusIdFromXLikeUrl(value) || cleanText(guid).match(/^\d+$/)?.[0];
  return handle && statusId ? `https://x.com/${handle}/status/${statusId}` : value;
}

function statusIdFromXLikeUrl(value) {
  try {
    const parsed = new URL(decodeEntities(String(value)).trim());
    const parts = parsed.pathname.split("/").filter(Boolean);
    const statusIndex = parts.findIndex((part) => part.toLowerCase() === "status");
    return statusIndex >= 0 ? parts[statusIndex + 1]?.match(/^\d+$/)?.[0] : "";
  } catch {
    return "";
  }
}

function isOfficialXgoFeed(feed) {
  return ["AI Companies", "中国AI公司"].includes(feed.groupName);
}

function officialHandle(feed) {
  const match = cleanText(feed.name).match(/@([A-Za-z0-9_]+)/);
  return match ? match[1].toLowerCase() : "";
}

function isOfficialXgoItemUrl(feed, value) {
  const handle = officialHandle(feed);
  if (!handle) return false;
  try {
    const parsed = new URL(decodeEntities(String(value)).trim());
    if (!["x.com", "twitter.com"].includes(parsed.hostname.toLowerCase())) return false;
    return parsed.pathname.split("/").filter(Boolean)[0]?.toLowerCase() === handle;
  } catch {
    return false;
  }
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      try {
        results[currentIndex] = { status: "fulfilled", value: await mapper(values[currentIndex]) };
      } catch (error) {
        results[currentIndex] = { status: "rejected", reason: error };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

function normalizeAiNewsDate(item) {
  const publishedAt = parseBeijingWallTime(item.published_at);
  const firstSeenAt = parseDate(item.first_seen_at);
  const lastSeenAt = parseDate(item.last_seen_at);

  if (publishedAt) {
    const publishedMs = dateValue(publishedAt);
    const publishedAfterRun = publishedMs > Date.now() + MAX_AI_NEWS_FUTURE_SKEW_MS;
    const publishedAfterFirstSeen = firstSeenAt && publishedMs > dateValue(firstSeenAt) + MAX_AI_NEWS_FUTURE_SKEW_MS;
    const publishedAfterLastSeen = lastSeenAt && publishedMs > dateValue(lastSeenAt) + MAX_AI_NEWS_FUTURE_SKEW_MS;
    if (!publishedAfterRun && !publishedAfterFirstSeen && !publishedAfterLastSeen) {
      return publishedAt;
    }
  }

  return firstSeenAt || lastSeenAt || publishedAt;
}

function normalizeRssDate(value) {
  const publishedAt = parseDate(value);
  if (!publishedAt) return "";
  return dateValue(publishedAt) > Date.now() + MAX_RSS_FUTURE_SKEW_MS
    ? new Date().toISOString()
    : publishedAt;
}

function normalizeItem(input) {
  const base = isLegacyTaxonomyItem(input) ? migrateLegacyItem(input) : input;
  const title = cleanText(base.title);
  const url = cleanUrl(base.url);
  if (!title || !url) return null;

  const publishedAt = parseDate(base.publishedAt) || new Date().toISOString();
  const family = normalizeFamily(base.family);
  const channel = normalizeChannel(base.channel, family, url);
  const site = channel === "x"
    ? "X/Twitter"
    : family === "curated"
      ? BESTBLOGS_SITE
      : cleanText(base.site) || cleanText(base.collection) || fallbackSite(family, channel, base.publisher);
  const publisher = cleanText(base.publisher) || fallbackPublisher(family, channel, site);
  const summary = trim(cleanText(base.summary), 360);
  const language = normalizeLanguage(base.language) || detectLanguage([title, summary]) || null;
  const score = family === "curated" ? normalizeScore(base.score) : null;

  return {
    id: String(base.id || hash(`${title}|${url}`)),
    title,
    url,
    publishedAt,
    summary,
    score,
    family,
    channel,
    site,
    publisher,
    topic: normalizeTopics(base.topic || [], { publisher, site }),
    language,
    originType: normalizeOriginType(base.originType, family, channel)
  };
}

function isLegacyTaxonomyItem(input) {
  return Boolean(input && ("sourceFamily" in input || "sourceName" in input || "siteName" in input || "tags" in input));
}

function migrateLegacyItem(input) {
  const family = normalizeFamily(input.family || input.sourceFamily);
  const channel = normalizeChannel(input.channel, family, input.url);
  const title = input.title;
  const summary = input.summary;

  if (family === "curated") {
    return {
      id: input.id,
      title,
      url: input.url,
      publishedAt: input.publishedAt,
      summary,
      score: input.score,
      family,
      channel,
      site: BESTBLOGS_SITE,
      publisher: extractBestBlogsSource(summary) || cleanText(input.sourceName) || "BestBlogs",
      topic: input.topic || input.tags || [],
      language: input.language || extractBestBlogsLanguage(summary),
      originType: input.originType || "curated-secondary"
    };
  }

  if (family === "aggregator") {
    return {
      id: input.id,
      title,
      url: input.url,
      publishedAt: input.publishedAt,
      summary,
      score: input.score,
      family,
      channel,
      site: cleanText(input.site) || cleanText(input.collection) || cleanText(input.siteName) || cleanText(input.sourceName) || AI_NEWS_SITE_FALLBACK,
      publisher: cleanText(input.publisher) || cleanText(input.sourceName) || cleanText(input.siteName) || AI_NEWS_SITE_FALLBACK,
      topic: input.topic || input.tags || [],
      language: input.language,
      originType: input.originType || "aggregated-hotlist"
    };
  }

  if (family === "official") {
    const officialPublisher = channel === "blogs"
      ? cleanText(input.publisher) || cleanText(input.siteName) || cleanText(input.sourceName)
      : cleanText(input.publisher) || cleanText(input.sourceName) || cleanText(input.siteName);
    const officialSite = channel === "blogs"
      ? cleanText(input.site) || cleanText(input.collection) || cleanText(input.sourceName) || cleanText(input.siteName)
      : "X/Twitter";
    return {
      id: input.id,
      title,
      url: input.url,
      publishedAt: input.publishedAt,
      summary,
      score: input.score,
      family,
      channel,
      publisher: officialPublisher,
      site: officialSite,
      topic: input.topic || input.tags || [],
      language: input.language,
      originType: input.originType || normalizeOriginType(null, family, channel)
    };
  }

  return {
    id: input.id,
    title,
    url: input.url,
    publishedAt: input.publishedAt,
    summary,
    score: input.score,
    family: "community",
    channel,
    site: "X/Twitter",
    publisher: cleanText(input.publisher) || cleanText(input.sourceName) || cleanText(input.siteName) || "X/Twitter",
    topic: input.topic || input.tags || [],
    language: input.language,
    originType: input.originType || "community-post"
  };
}

function normalizeFamily(value) {
  switch (String(value || "").trim()) {
    case "curated":
    case "BestBlogs":
      return "curated";
    case "aggregator":
    case "ai-news-aggregator":
      return "aggregator";
    case "official":
    case "Official":
      return "official";
    case "community":
    case "X/Twitter":
      return "community";
    default:
      return "community";
  }
}

function normalizeChannel(value, family, url) {
  const raw = String(value || "").trim();
  const canonical = ["official-x", "official-social", "community-social", "xgo", "x", "X/Twitter"].includes(raw)
    ? "x"
    : ["curated-rss", "official-rss", "blogs"].includes(raw)
      ? "blogs"
      : ["aggregator-json", "aggregator"].includes(raw)
        ? "aggregator"
        : raw;
  const channel = canonical || defaultChannelForFamily(family, url);
  if (!isValidFamilyChannel(family, channel)) {
    throw new Error(`Invalid family/channel pairing: ${family}/${channel}`);
  }
  return channel;
}

function defaultChannelForFamily(family, url) {
  if (family === "curated") return "blogs";
  if (family === "aggregator") return "aggregator";
  if (family === "official") return isXPostUrl(url) ? "x" : "blogs";
  return "x";
}

function isValidFamilyChannel(family, channel) {
  return ALLOWED_CHANNELS_BY_FAMILY.get(family)?.has(channel) ?? false;
}

function normalizeOriginType(value, family, channel) {
  const raw = cleanText(value);
  if (raw) return raw;
  if (family === "curated") return "curated-secondary";
  if (family === "aggregator") return "aggregated-hotlist";
  if (family === "official") return channel === "x" ? "official-social" : "direct-official";
  return "community-post";
}

function fallbackPublisher(family, channel, site) {
  if (family === "official" && channel === "blogs") return cleanText(site) || "Official";
  if (family === "aggregator") return cleanText(site) || AI_NEWS_SITE_FALLBACK;
  if (family === "curated") return "BestBlogs";
  if (family === "official") return "Official";
  return "X/Twitter";
}

function fallbackSite(family, channel, publisher) {
  if (family === "curated") return BESTBLOGS_SITE;
  if (family === "aggregator") return cleanText(publisher) || AI_NEWS_SITE_FALLBACK;
  if (channel === "x") return "X/Twitter";
  return cleanText(publisher) || "Official";
}

function normalizeTopics(values, { publisher, site }) {
  const blocked = new Set([
    normalizeTopicKey(publisher),
    normalizeTopicKey(site),
    normalizeTopicKey("official"),
    normalizeTopicKey("x/twitter"),
    normalizeTopicKey("rss"),
    normalizeTopicKey("opml rss")
  ].filter(Boolean));
  const topics = [];
  const seen = new Set();
  for (const rawValue of Array.isArray(values) ? values : [values]) {
    const cleaned = trim(cleanText(rawValue), 48);
    if (!cleaned) continue;
    const normalized = normalizeTopicValue(cleaned);
    const key = normalizeTopicKey(normalized);
    if (!key || blocked.has(key) || seen.has(key)) continue;
    seen.add(key);
    topics.push(normalized);
    if (topics.length >= 8) break;
  }
  return topics;
}

function normalizeTopicValue(value) {
  return hasHan(value) ? value : value.toLowerCase();
}

function normalizeTopicKey(value = "") {
  return String(value).trim().toLowerCase();
}

function normalizeLanguage(value) {
  const cleaned = cleanText(value == null ? "" : value).toLowerCase();
  if (!cleaned) return null;
  if (["zh", "zh-cn", "zh-hans", "中文", "汉语", "简体中文", "chinese"].some((token) => cleaned.includes(token))) return "zh";
  if (["en", "en-us", "en-gb", "英文", "英语", "english"].some((token) => cleaned.includes(token))) return "en";
  return cleaned || null;
}

function detectLanguage(values) {
  const text = values.filter(Boolean).map((value) => cleanText(value)).join(" ");
  if (!text) return null;
  const hanCount = (text.match(/[\p{Script=Han}]/gu) || []).length;
  const latinCount = (text.match(/[A-Za-z]/g) || []).length;
  if (hanCount >= 2 && hanCount >= latinCount / 2) return "zh";
  if (latinCount >= 6) return "en";
  return null;
}

function normalizeScore(value) {
  if (value === null || value === undefined || value === "") return null;
  const score = Number(value);
  return Number.isFinite(score) ? score : null;
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
    topic: normalizeTopics([...a.topic, ...b.topic], { publisher: newer.publisher, site: newer.site }),
    summary: newer.summary || older.summary,
    score: newer.score ?? older.score,
    language: newer.language || older.language
  };
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { "user-agent": "rose-briefing/0.1" } });
    if (!response.ok) throw new Error(`${url} returned ${response.status}`);
    let text = await response.text();
    if (!text) {
      text = await fetchTextWithHttps(url);
    }
    const byteLength = Buffer.byteLength(text, "utf8");
    if (byteLength > MAX_FETCH_BYTES) throw new Error(`${url} returned ${byteLength} bytes, above ${MAX_FETCH_BYTES}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function fetchTextWithHttps(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { "user-agent": "rose-briefing/0.1" }, timeout: 30000 }, (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`${url} returned ${response.statusCode}`));
        return;
      }
      const chunks = [];
      let byteLength = 0;
      response.on("data", (chunk) => {
        byteLength += chunk.length;
        if (byteLength > MAX_FETCH_BYTES) request.destroy(new Error(`${url} returned above ${MAX_FETCH_BYTES} bytes`));
        else chunks.push(chunk);
      });
      response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
    request.on("timeout", () => request.destroy(new Error(`${url} timed out`)));
    request.on("error", reject);
  });
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

function readXmlTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeEntities(match[1].replace(/^<!\[CDATA\[|\]\]>$/g, "")) : "";
}

function decodeEntities(value = "") {
  const text = value == null ? "" : String(value);
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function cleanText(value = "") {
  const text = value == null ? "" : value;
  return decodeEntities(text)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanUrl(value = "") {
  const raw = decodeEntities(value == null ? "" : value).trim();
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

function parseBeijingWallTime(value) {
  if (!value) return "";
  const withoutZone = String(value).trim().replace(/(?:Z|[+-]\d{2}:?\d{2})$/, "");
  const normalized = withoutZone.includes("T") ? withoutZone : withoutZone.replace(" ", "T");
  return parseDate(`${normalized}+08:00`);
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

function isXPostUrl(value) {
  try {
    const parsed = new URL(String(value));
    return ["x.com", "twitter.com"].includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function extractBestBlogsSource(value) {
  return extractLabeledMeta(value, "Source", ["Author", "Category", "Language", "Read Time", "Word Count"]);
}

function extractBestBlogsLanguage(value) {
  return normalizeLanguage(extractLabeledMeta(value, "Language", ["Read Time", "Word Count"]));
}

function extractLabeledMeta(value, label, nextLabels) {
  const text = cleanText(value);
  if (!text) return "";
  const boundary = nextLabels.join("|");
  const regex = new RegExp(`${label}\\s*[：:]\\s*(.+?)(?=\\s+(?:${boundary})\\s*[：:]|$)`, "i");
  const match = text.match(regex);
  return match ? cleanText(match[1]) : "";
}

function hasHan(value) {
  return /\p{Script=Han}/u.test(value);
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
