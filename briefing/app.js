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

const FAM_COLOR = {
  BestBlogs: "var(--fam-BestBlogs)",
  Official: "var(--fam-Official)",
  "X/Twitter": "var(--fam-X)",
  "ai-news-aggregator": "var(--fam-ai)",
  Unknown: "var(--fam-Unknown)"
};

const SOURCE_LABEL = {
  "ai-news-aggregator": "ai-news",
  "X/Twitter": "X/Twitter",
  Official: "官方",
  BestBlogs: "BestBlogs"
};

const elements = {
  count: document.querySelector("#item-count"),
  coverageLine: document.querySelector("#coverage-line"),
  kicker: document.querySelector("#kicker"),
  generatedAt: document.querySelector("#generated-at"),
  search: document.querySelector("#search"),
  sourceFilter: document.querySelector("#source-filter"),
  platformFilter: document.querySelector("#platform-filter"),
  sortOrder: document.querySelector("#sort-order"),
  status: document.querySelector("#status"),
  list: document.querySelector("#cards")
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
  const platformCount = new Set(state.items.map((item) => item.siteName).filter(Boolean)).size;
  const sourceCount = new Set(state.items.map((item) => item.sourceName).filter(Boolean)).size;
  elements.coverageLine.innerHTML = `覆盖 <b>${platformCount}</b> 个平台、<b>${sourceCount}</b> 个来源`;
  elements.kicker.textContent = state.payload.generatedAt
    ? `Daily Brief · ${formatIssueDate(state.payload.generatedAt)}`
    : "Daily Brief";
  elements.generatedAt.innerHTML = state.payload.generatedAt
    ? `北京时间 <b>${formatDateTime(state.payload.generatedAt)}</b> 更新`
    : "未知更新时间";

  fillSourceChips(state.items);
  fillPlatformOptions(state.items);
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
    elements.sourceFilter.querySelectorAll(".chip").forEach((node) => node.classList.toggle("on", node === chip));
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
  document.querySelector("#nav-latest")?.addEventListener("click", (event) => {
    event.preventDefault();
    selectSource("all");
  });
  document.querySelector("#nav-official")?.addEventListener("click", (event) => {
    event.preventDefault();
    selectSource("Official");
  });
}

function selectSource(value) {
  state.source = value;
  elements.sourceFilter.querySelectorAll(".chip").forEach((node) => node.classList.toggle("on", node.dataset.src === value));
  render();
}

function fillSourceChips(items) {
  const families = [...new Set(items.map((item) => item.sourceFamily).filter(Boolean))].sort();
  const order = ["BestBlogs", "Official", "X/Twitter", "ai-news-aggregator"].filter((f) => families.includes(f));
  const chips = [{ src: "all", label: "全部" }, ...order.map((src) => ({ src, label: SOURCE_LABEL[src] || src }))];
  elements.sourceFilter.replaceChildren(...chips.map((c) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip" + (c.src === "all" ? " on" : "");
    button.dataset.src = c.src;
    button.textContent = c.label;
    return button;
  }));
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

function renderItem(item) {
  const article = document.createElement("article");
  article.className = "item";

  const gd = document.createElement("span");
  gd.className = "gd";

  const body = document.createElement("div");
  body.className = "body";

  const meta = document.createElement("div");
  meta.className = "meta";

  const heading = document.createElement("h2");
  const titleLink = document.createElement("a");
  titleLink.className = "title-link";
  titleLink.target = "_blank";
  titleLink.rel = "noopener noreferrer";
  heading.append(titleLink);

  const summary = document.createElement("p");
  summary.className = "summary";

  const tags = document.createElement("div");
  tags.className = "tags";

  const side = document.createElement("div");
  side.className = "side";

  const color = FAM_COLOR[item.sourceFamily] || FAM_COLOR.Unknown;
  gd.style.background = color;

  const fam = document.createElement("span");
  fam.className = "fam";
  fam.style.color = color;
  fam.textContent = SOURCE_LABEL[item.sourceFamily] || item.sourceFamily;
  meta.append(fam, textNode([item.siteName, item.sourceName].filter(Boolean).join(" · ") || "未知来源"));

  titleLink.textContent = item.title;
  titleLink.href = item.url;
  summary.textContent = item.summary || "暂无摘要，打开原文查看。";
  for (const tag of item.tags || []) {
    const span = document.createElement("span");
    span.className = "tag";
    span.textContent = tag;
    tags.append(span);
  }

  const time = document.createElement("span");
  time.textContent = formatDate(item.publishedAt);
  side.append(time);
  if (Number.isFinite(item.score)) {
    const score = document.createElement("span");
    score.className = "score";
    score.textContent = `${item.score}`;
    side.append(document.createElement("br"), score);
  }

  article.dataset.source = item.sourceFamily;
  body.append(meta, heading, summary, tags);
  article.append(gd, body, side);
  return article;
}

function textNode(text) {
  return document.createTextNode(text);
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
