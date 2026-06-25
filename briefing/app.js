const state = {
  payload: null,
  items: [],
  query: "",
  source: "all",
  platform: "all",
  sort: "newest",
  range: "24h"
};

const DISPLAY_LIMIT = 800;
const BEIJING_TIME_ZONE = "Asia/Shanghai";

const FAM_COLOR = {
  BestBlogs: "var(--fam-BestBlogs)",
  Official: "var(--fam-Official)",
  "X/Twitter": "var(--fam-X)",
  "ai-news-aggregator": "var(--fam-ai)",
  Unknown: "var(--fam-Unknown)"
};

const SOURCE_LABEL = {
  BestBlogs: "BestBlogs",
  Official: "官方",
  "X/Twitter": "社区/X",
  "ai-news-aggregator": "全网聚合"
};

const SOURCE_ORDER = ["BestBlogs", "Official", "X/Twitter", "ai-news-aggregator"];

const elements = {
  count: document.querySelector("#item-count"),
  coverageLine: document.querySelector("#coverage-line"),
  kicker: document.querySelector("#kicker"),
  generatedAt: document.querySelector("#generated-at"),
  search: document.querySelector("#search"),
  sourceFilter: document.querySelector("#source-filter"),
  platformFilter: document.querySelector("#platform-filter"),
  sortOrder: document.querySelector("#sort-order"),
  rangeFilter: document.querySelector("#range-filter"),
  status: document.querySelector("#status"),
  list: document.querySelector("#cards"),
  detailToggle: document.querySelector("#coverage-detail-toggle"),
  detailClose: document.querySelector("#coverage-detail-close"),
  detailPanel: document.querySelector("#coverage-detail"),
  detailTitle: document.querySelector("#coverage-detail-title"),
  detailList: document.querySelector("#coverage-detail-list")
};

init().catch((error) => {
  elements.status.textContent = `加载失败：${error.message}`;
});

async function init() {
  const response = await fetch("data/items.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`data/items.json ${response.status}`);
  state.payload = await response.json();
  state.items = Array.isArray(state.payload.items) ? state.payload.items : [];

  elements.kicker.textContent = state.payload.generatedAt
    ? `Daily Brief · ${formatIssueDate(state.payload.generatedAt)}`
    : "Daily Brief";
  elements.generatedAt.innerHTML = state.payload.generatedAt
    ? `北京时间 <b>${formatDateTime(state.payload.generatedAt)}</b> 更新`
    : "未知更新时间";

  fillSourceChips(state.items);
  bindControls();
  render();
}

function bindControls() {
  elements.search.addEventListener("input", () => {
    state.query = elements.search.value.trim().toLowerCase();
    render();
  });

  elements.sourceFilter.addEventListener("click", (event) => {
    const chip = event.target.closest(".chip");
    if (!chip) return;
    state.source = chip.dataset.src;
    syncSourceChips();
    render();
  });

  elements.platformFilter.addEventListener("change", () => {
    state.platform = elements.platformFilter.value;
    render();
  });

  elements.sortOrder.addEventListener("change", () => {
    state.sort = elements.sortOrder.value;
    render();
  });

  elements.rangeFilter?.addEventListener("click", (event) => {
    const button = event.target.closest(".range-btn");
    if (!button) return;
    state.range = button.dataset.range;
    syncRangeButtons();
    render();
  });

  elements.detailToggle?.addEventListener("click", () => {
    const hidden = elements.detailPanel.hasAttribute("hidden");
    if (hidden) elements.detailPanel.removeAttribute("hidden");
    else elements.detailPanel.setAttribute("hidden", "");
  });

  elements.detailClose?.addEventListener("click", () => {
    elements.detailPanel.setAttribute("hidden", "");
  });

  document.querySelector("#nav-latest")?.addEventListener("click", (event) => {
    event.preventDefault();
    state.source = "all";
    syncSourceChips();
    render();
  });

  document.querySelector("#nav-official")?.addEventListener("click", (event) => {
    event.preventDefault();
    state.source = "Official";
    syncSourceChips();
    render();
  });
}

function fillSourceChips(items) {
  const families = [...new Set(items.map((item) => item.sourceFamily).filter(Boolean))];
  const chips = [{ src: "all", label: "全部" }, ...SOURCE_ORDER.filter((src) => families.includes(src)).map((src) => ({ src, label: SOURCE_LABEL[src] || src }))];
  elements.sourceFilter.replaceChildren(...chips.map((c) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip";
    button.dataset.src = c.src;
    button.textContent = c.label;
    return button;
  }));
  syncSourceChips();
}

function syncSourceChips() {
  elements.sourceFilter.querySelectorAll(".chip").forEach((node) => {
    node.classList.toggle("on", node.dataset.src === state.source);
  });
}

function syncRangeButtons() {
  elements.rangeFilter?.querySelectorAll(".range-btn").forEach((node) => {
    node.classList.toggle("on", node.dataset.range === state.range);
  });
}

function render() {
  const base = getRangeItems();
  syncPlatformOptions(base);
  updateHeader(base);
  updateCoverageDetail(base);

  const filtered = base
    .filter(matchesSource)
    .filter(matchesPlatform)
    .filter(matchesQuery)
    .sort(compareItems);

  const visible = filtered.slice(0, DISPLAY_LIMIT);
  if (visible.length === 0) {
    elements.list.replaceChildren();
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "没有匹配结果";
    elements.list.append(empty);
  } else {
    elements.list.replaceChildren(...visible.map(renderItem));
  }

  const warningText = state.payload?.warnings?.length ? `；提示：${state.payload.warnings.join("；")}` : "";
  elements.status.textContent = filtered.length === 0
    ? `没有匹配结果${warningText}`
    : statusText(filtered.length, visible.length, base.length, warningText);
}

function getRangeItems() {
  const generatedAt = getGeneratedAtMs();
  const maxAgeHours = state.range === "24h" ? 24 : 168;
  return state.items.filter((item) => {
    const publishedAt = new Date(item.publishedAt).getTime();
    if (Number.isNaN(publishedAt)) return false;
    return generatedAt - publishedAt <= maxAgeHours * 60 * 60 * 1000;
  });
}

function getGeneratedAtMs() {
  const generated = new Date(state.payload?.generatedAt || Date.now()).getTime();
  return Number.isNaN(generated) ? Date.now() : generated;
}

function syncPlatformOptions(baseItems) {
  const previous = state.platform;
  const options = [...new Set(baseItems.map((item) => item.siteName || item.sourceName).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
  const valid = previous === "all" || options.includes(previous);
  if (!valid) state.platform = "all";

  elements.platformFilter.replaceChildren();
  const all = document.createElement("option");
  all.value = "all";
  all.textContent = "全部平台";
  elements.platformFilter.append(all);
  for (const value of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    elements.platformFilter.append(option);
  }
  elements.platformFilter.value = state.platform;
}

function updateHeader(baseItems) {
  const platformCount = new Set(baseItems.map((item) => item.siteName).filter(Boolean)).size;
  const sourceCount = new Set(baseItems.map((item) => item.sourceName).filter(Boolean)).size;
  elements.count.textContent = String(baseItems.length);
  elements.coverageLine.innerHTML = `覆盖 <b>${platformCount}</b> 个平台、<b>${sourceCount}</b> 个来源`;
}

function updateCoverageDetail(baseItems) {
  const rows = [...groupCoverage(baseItems).entries()].sort((a, b) => b[1].itemCount - a[1].itemCount || a[0].localeCompare(b[0], "zh-CN"));
  elements.detailTitle.textContent = `${state.range} 来源详情`;
  elements.detailList.replaceChildren(...rows.map(([site, info]) => {
    const item = document.createElement("div");
    item.className = "coverage-detail-item";
    const strong = document.createElement("strong");
    strong.textContent = site;
    const meta = document.createElement("span");
    meta.textContent = `${info.itemCount} 条资讯 · ${info.sourceCount} 个来源`;
    item.append(strong, meta);
    return item;
  }));
}

function groupCoverage(items) {
  const map = new Map();
  for (const item of items) {
    const key = item.siteName || item.sourceName || "未知平台";
    const current = map.get(key) || { itemCount: 0, sources: new Set() };
    current.itemCount += 1;
    if (item.sourceName) current.sources.add(item.sourceName);
    map.set(key, current);
  }
  for (const value of map.values()) {
    value.sourceCount = value.sources.size;
    delete value.sources;
  }
  return map;
}

function statusText(filteredCount, visibleCount, baseCount, warningText) {
  const platformCount = new Set(getRangeItems().map((item) => item.siteName).filter(Boolean)).size;
  const sourceCount = new Set(getRangeItems().map((item) => item.sourceName).filter(Boolean)).size;
  const prefix = visibleCount < filteredCount
    ? `显示前 ${visibleCount} 条，匹配 ${filteredCount} / ${baseCount} 条`
    : `显示 ${filteredCount} / ${baseCount} 条`;
  return `${prefix}；覆盖 ${platformCount} 个平台、${sourceCount} 个来源${warningText}`;
}

function renderItem(item) {
  const article = document.createElement("article");
  article.className = "item";

  const body = document.createElement("div");
  body.className = "body";

  const meta = document.createElement("div");
  meta.className = "meta";
  const famTag = document.createElement("span");
  famTag.className = "fam-tag";
  famTag.style.background = FAM_COLOR[item.sourceFamily] || FAM_COLOR.Unknown;
  famTag.textContent = SOURCE_LABEL[item.sourceFamily] || item.sourceFamily;
  meta.append(famTag, document.createTextNode([item.siteName, item.sourceName].filter(Boolean).join(" · ") || "未知来源"));

  const heading = document.createElement("h2");
  const titleLink = document.createElement("a");
  titleLink.target = "_blank";
  titleLink.rel = "noopener noreferrer";
  titleLink.href = item.url;
  titleLink.textContent = item.title;
  heading.append(titleLink);

  const summary = document.createElement("p");
  summary.textContent = item.summary || "暂无摘要，打开原文查看。";

  const tags = document.createElement("div");
  tags.className = "tags";
  for (const tag of item.tags || []) {
    const span = document.createElement("span");
    span.className = "tag";
    span.textContent = tag;
    tags.append(span);
  }

  const side = document.createElement("div");
  side.className = "side";
  const time = document.createElement("span");
  time.textContent = formatCompactDate(item.publishedAt);
  side.append(time);
  if (Number.isFinite(item.score)) {
    const score = document.createElement("span");
    score.className = "score";
    score.textContent = String(item.score);
    side.append(document.createElement("br"), score);
  }

  body.append(meta, heading, summary, tags);
  article.append(body, side);
  return article;
}

function matchesSource(item) {
  return state.source === "all" || item.sourceFamily === state.source;
}

function matchesPlatform(item) {
  return state.platform === "all" || item.siteName === state.platform || item.sourceName === state.platform;
}

function matchesQuery(item) {
  if (!state.query) return true;
  const haystack = [
    item.title,
    item.summary,
    item.sourceFamily,
    item.sourceName,
    item.siteName,
    ...(item.tags || [])
  ].join(" ").toLowerCase();
  return haystack.includes(state.query);
}

function compareItems(a, b) {
  if (state.sort === "score") return (b.score ?? -1) - (a.score ?? -1) || newest(a, b);
  if (state.sort === "source") return `${labelFamily(a.sourceFamily)}${a.sourceName}`.localeCompare(`${labelFamily(b.sourceFamily)}${b.sourceName}`, "zh-CN") || newest(a, b);
  return newest(a, b);
}

function newest(a, b) {
  return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
}

function labelFamily(family) {
  return SOURCE_LABEL[family] || family;
}

function formatCompactDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: BEIJING_TIME_ZONE,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: BEIJING_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function formatIssueDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: BEIJING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const map = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${map.year}.${map.month}.${map.day}`;
}
