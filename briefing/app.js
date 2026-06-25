const state = {
  payload: null,
  items: [],
  query: "",
  source: "all",
  sort: "newest"
};

const elements = {
  count: document.querySelector("#item-count"),
  generatedAt: document.querySelector("#generated-at"),
  search: document.querySelector("#search"),
  sourceFilter: document.querySelector("#source-filter"),
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

function render() {
  const filtered = state.items
    .filter(matchesSource)
    .filter(matchesQuery)
    .sort(compareItems);

  elements.cards.replaceChildren(...filtered.map(renderCard));
  const warningText = state.payload?.warnings?.length ? `；提示：${state.payload.warnings.join("；")}` : "";
  elements.status.textContent = filtered.length === 0
    ? `没有匹配结果${warningText}`
    : `显示 ${filtered.length} / ${state.items.length} 条${warningText}`;
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
    document.createTextNode(item.sourceName || item.siteName || "未知来源"),
    document.createTextNode(formatDate(item.publishedAt))
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

function matchesSource(item) {
  return state.source === "all" || item.sourceFamily === state.source;
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
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
