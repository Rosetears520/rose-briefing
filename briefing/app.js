const state = {
  payload: null,
  items: [],
  query: "",
  source: "all",
  platform: "all",
  sort: "newest"
};

const DISPLAY_LIMIT = 800;
const BEIJING_TIME_ZONE = "Asia/Shanghai";

const elements = {
  count: document.querySelector("#item-count"),
  generatedAt: document.querySelector("#generated-at"),
  search: document.querySelector("#search"),
  sourceFilter: document.querySelector("#source-filter"),
  platformFilter: document.querySelector("#platform-filter"),
  sortOrder: document.querySelector("#sort-order"),
  status: document.querySelector("#status"),
  cards: document.querySelector("#cards"),
  template: document.querySelector("#card-template")
};

init().catch((error) => {
  elements.status.textContent = `加载失败：${error.message}`;
});

async function init() {
  const response = await fetch("data/items.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`data/items.json ${response.status}`);
  state.payload = await response.json();
  state.items = Array.isArray(state.payload.items) ? state.payload.items : [];

  elements.count.textContent = String(state.items.length);
  elements.generatedAt.textContent = state.payload.generatedAt ? `更新于 ${formatDateTime(state.payload.generatedAt)}` : "未知更新时间";

  fillSourceOptions(state.items);
  fillPlatformOptions(state.items);
  bindControls();
  render();
}

function bindControls() {
  elements.search.addEventListener("input", () => {
    state.query = elements.search.value.trim().toLowerCase();
    render();
  });
  elements.sourceFilter.addEventListener("change", () => {
    state.source = elements.sourceFilter.value;
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
}

function fillSourceOptions(items) {
  const sources = [...new Set(items.map((item) => item.sourceFamily).filter(Boolean))].sort();
  for (const source of sources) {
    const option = document.createElement("option");
    option.value = source;
    option.textContent = source;
    elements.sourceFilter.append(option);
  }
}

function fillPlatformOptions(items) {
  const platforms = [...new Set(items.map((item) => item.siteName || item.sourceName).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
  for (const platform of platforms) {
    const option = document.createElement("option");
    option.value = platform;
    option.textContent = platform;
    elements.platformFilter.append(option);
  }
}

function render() {
  const filtered = state.items
    .filter(matchesSource)
    .filter(matchesPlatform)
    .filter(matchesQuery)
    .sort(compareItems);

  const visible = filtered.slice(0, DISPLAY_LIMIT);
  elements.cards.replaceChildren(...visible.map(renderCard));
  const warningText = state.payload?.warnings?.length ? `；提示：${state.payload.warnings.join("；")}` : "";
  elements.status.textContent = filtered.length === 0
    ? `没有匹配结果${warningText}`
    : statusText(filtered.length, visible.length, warningText);
}

function statusText(filteredCount, visibleCount, warningText) {
  const sourceCount = new Set(state.items.map((item) => item.sourceName).filter(Boolean)).size;
  const platformCount = new Set(state.items.map((item) => item.siteName).filter(Boolean)).size;
  const prefix = visibleCount < filteredCount
    ? `显示前 ${visibleCount} 条，匹配 ${filteredCount} / ${state.items.length} 条`
    : `显示 ${filteredCount} / ${state.items.length} 条`;
  return `${prefix}；覆盖 ${platformCount} 个平台、${sourceCount} 个来源${warningText}`;
}

function renderCard(item) {
  const fragment = elements.template.content.cloneNode(true);
  const article = fragment.querySelector(".card");
  const meta = fragment.querySelector(".card-meta");
  const title = fragment.querySelector("h2");
  const summary = fragment.querySelector(".summary");
  const tags = fragment.querySelector(".tags");
  const link = fragment.querySelector(".read-link");

  meta.append(
    pill(item.sourceFamily),
    textMeta([item.siteName, item.sourceName].filter(Boolean).join(" · ") || "未知来源"),
    textMeta(formatDate(item.publishedAt))
  );
  if (Number.isFinite(item.score)) meta.append(pill(`分数 ${item.score}`));

  title.textContent = item.title;
  summary.textContent = item.summary || "暂无摘要，打开原文查看。";
  for (const tag of item.tags || []) tags.append(pill(tag, "tag"));
  link.href = item.url;
  article.dataset.source = item.sourceFamily;
  return fragment;
}

function pill(text, className = "pill") {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  return span;
}

function textMeta(text) {
  const span = document.createElement("span");
  span.textContent = text;
  return span;
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
  if (state.sort === "source") return `${a.sourceFamily}${a.sourceName}`.localeCompare(`${b.sourceFamily}${b.sourceName}`, "zh-CN") || newest(a, b);
  return newest(a, b);
}

function newest(a, b) {
  return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  return `北京时间 ${new Intl.DateTimeFormat("zh-CN", {
    timeZone: BEIJING_TIME_ZONE,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date)}`;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知";
  return `北京时间 ${new Intl.DateTimeFormat("zh-CN", {
    timeZone: BEIJING_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date)}`;
}
