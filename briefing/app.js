const state = {
  payload: null,
  items: [],
  query: "",
  family: "all",
  channel: "all",
  publisher: "all",
  topic: "all",
  sort: "newest",
  range: "24h"
};

const DISPLAY_LIMIT = 800;
const BEIJING_TIME_ZONE = "Asia/Shanghai";

const FAM_COLOR = {
  curated: "var(--fam-curated)",
  official: "var(--fam-official)",
  community: "var(--fam-community)",
  aggregator: "var(--fam-aggregator)",
  unknown: "var(--fam-unknown)"
};

const FAMILY_LABEL = {
  curated: "精选",
  official: "官方",
  community: "社区",
  aggregator: "聚合"
};

const FAMILY_ORDER = ["curated", "official", "community", "aggregator"];

const CHANNEL_LABEL = {
  "curated-rss": "精选 RSS",
  "official-rss": "官方 RSS",
  "official-social": "官方社媒",
  "community-social": "社区社媒",
  "aggregator-json": "聚合 JSON"
};

const elements = {
  count: document.querySelector("#item-count"),
  coverageLine: document.querySelector("#coverage-line"),
  kicker: document.querySelector("#kicker"),
  generatedAt: document.querySelector("#generated-at"),
  search: document.querySelector("#search"),
  familyFilter: document.querySelector("#family-filter"),
  channelFilter: document.querySelector("#channel-filter"),
  publisherFilter: document.querySelector("#publisher-filter"),
  topicFilter: document.querySelector("#topic-filter"),
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
  state.items = Array.isArray(state.payload.items) ? state.payload.items.map(normalizeItem) : [];

  elements.kicker.textContent = state.payload.generatedAt
    ? `Daily Brief · ${formatIssueDate(state.payload.generatedAt)}`
    : "Daily Brief";
  elements.generatedAt.innerHTML = state.payload.generatedAt
    ? `北京时间 <b>${formatDateTime(state.payload.generatedAt)}</b> 更新`
    : "未知更新时间";

  fillFamilyChips(state.items);
  bindControls();
  render();
}

function bindControls() {
  elements.search.addEventListener("input", () => {
    state.query = elements.search.value.trim().toLowerCase();
    render();
  });

  elements.familyFilter.addEventListener("click", (event) => {
    const chip = event.target.closest(".chip");
    if (!chip) return;
    state.family = chip.dataset.family;
    syncFamilyChips();
    render();
  });

  elements.channelFilter.addEventListener("change", () => {
    state.channel = elements.channelFilter.value;
    render();
  });

  elements.publisherFilter.addEventListener("change", () => {
    state.publisher = elements.publisherFilter.value;
    render();
  });

  elements.topicFilter.addEventListener("change", () => {
    state.topic = elements.topicFilter.value;
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
    resetTaxonomyFilters();
    syncFamilyChips();
    render();
  });

  document.querySelector("#nav-official")?.addEventListener("click", (event) => {
    event.preventDefault();
    resetTaxonomyFilters();
    state.family = "official";
    syncFamilyChips();
    render();
  });
}

function fillFamilyChips(items) {
  const families = [...new Set(items.map((item) => item.family).filter(Boolean))];
  if (state.family !== "all" && !families.includes(state.family)) state.family = "all";
  const chips = [{ family: "all", label: "全部" }, ...FAMILY_ORDER.filter((family) => families.includes(family)).map((family) => ({ family, label: FAMILY_LABEL[family] || family }))];
  elements.familyFilter.replaceChildren(...chips.map((chip) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip";
    button.dataset.family = chip.family;
    button.textContent = chip.label;
    return button;
  }));
  syncFamilyChips();
}

function syncFamilyChips() {
  elements.familyFilter.querySelectorAll(".chip").forEach((node) => {
    node.classList.toggle("on", node.dataset.family === state.family);
  });
}

function syncRangeButtons() {
  elements.rangeFilter?.querySelectorAll(".range-btn").forEach((node) => {
    node.classList.toggle("on", node.dataset.range === state.range);
  });
}

function render() {
  const base = getRangeItems();
  fillFamilyChips(base);

  const familyItems = base.filter(matchesFamily);
  syncChannelOptions(familyItems);

  const familyChannelItems = familyItems.filter(matchesChannel);
  syncPublisherOptions(familyChannelItems);

  const taxonomyItems = familyChannelItems.filter(matchesPublisher);
  syncTopicOptions(taxonomyItems);

  updateHeader(base);
  updateCoverageDetail(base);

  const filtered = taxonomyItems
    .filter(matchesTopic)
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

function syncChannelOptions(baseItems) {
  const counts = countBy(baseItems, (item) => item.channel);
  const options = [...counts.entries()].sort((a, b) => labelChannel(a[0]).localeCompare(labelChannel(b[0]), "zh-CN"));
  syncSelectOptions(elements.channelFilter, "all", "全部渠道", options, state.channel, (value) => `${labelChannel(value)} (${counts.get(value)})`, (value) => {
    state.channel = value;
  });
}

function syncPublisherOptions(baseItems) {
  const counts = countBy(baseItems, (item) => item.publisher);
  const options = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"));
  syncSelectOptions(elements.publisherFilter, "all", "全部发布方", options, state.publisher, (value) => `${value} (${counts.get(value)})`, (value) => {
    state.publisher = value;
  });
}

function syncTopicOptions(baseItems) {
  const counts = new Map();
  for (const item of baseItems) {
    for (const topic of item.topic) {
      counts.set(topic, (counts.get(topic) || 0) + 1);
    }
  }
  const options = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"));
  syncSelectOptions(elements.topicFilter, "all", "全部话题", options, state.topic, (value) => `${value} (${counts.get(value)})`, (value) => {
    state.topic = value;
  });
}

function syncSelectOptions(element, allValue, allLabel, entries, currentValue, optionLabel, setValue) {
  const values = entries.map(([value]) => value);
  if (currentValue !== allValue && !values.includes(currentValue)) setValue(allValue);

  element.replaceChildren();
  const all = document.createElement("option");
  all.value = allValue;
  all.textContent = allLabel;
  element.append(all);

  for (const [value] of entries) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = optionLabel(value);
    element.append(option);
  }

  element.value = currentValue === allValue || values.includes(currentValue) ? currentValue : allValue;
}

function updateHeader(baseItems) {
  const publisherCount = uniqueCount(baseItems.map((item) => item.publisher));
  const collectionCount = uniqueCount(baseItems.map((item) => item.collection));
  const channelCount = uniqueCount(baseItems.map((item) => item.channel));
  elements.count.textContent = String(baseItems.length);
  elements.coverageLine.innerHTML = `覆盖 <b>${publisherCount}</b> 个发布方、<b>${collectionCount}</b> 个集合、<b>${channelCount}</b> 个渠道`;
}

function updateCoverageDetail(baseItems) {
  const rows = [...groupCoverage(baseItems).entries()].sort((a, b) => b[1].itemCount - a[1].itemCount || a[0].localeCompare(b[0], "zh-CN"));
  elements.detailTitle.textContent = `${state.range} 覆盖详情`;
  elements.detailList.replaceChildren(...rows.map(([publisher, info]) => {
    const item = document.createElement("div");
    item.className = "coverage-detail-item";
    const strong = document.createElement("strong");
    strong.textContent = publisher;
    const meta = document.createElement("span");
    meta.textContent = `${info.itemCount} 条资讯 · ${info.collectionCount} 个集合 · ${info.channelCount} 个渠道`;
    const detail = document.createElement("small");
    detail.textContent = [
      info.familyLabels.join(" / "),
      info.channelLabels.join(" / "),
      info.collectionPreview
    ].filter(Boolean).join(" · ");
    item.append(strong, meta);
    if (detail.textContent) item.append(detail);
    return item;
  }));
}

function groupCoverage(items) {
  const map = new Map();
  for (const item of items) {
    const key = item.publisher || "未知发布方";
    const current = map.get(key) || { itemCount: 0, families: new Set(), channels: new Set(), collections: new Set() };
    current.itemCount += 1;
    if (item.family) current.families.add(item.family);
    if (item.channel) current.channels.add(item.channel);
    if (item.collection) current.collections.add(item.collection);
    map.set(key, current);
  }
  for (const value of map.values()) {
    value.collectionCount = value.collections.size;
    value.channelCount = value.channels.size;
    value.familyLabels = [...value.families].sort(compareTaxonomyValues(labelFamily));
    value.channelLabels = [...value.channels].sort(compareTaxonomyValues(labelChannel));
    value.collectionPreview = [...value.collections].sort((a, b) => a.localeCompare(b, "zh-CN")).slice(0, 3).join(" · ");
  }
  return map;
}

function statusText(filteredCount, visibleCount, baseCount, warningText) {
  const rangeItems = getRangeItems();
  const publisherCount = uniqueCount(rangeItems.map((item) => item.publisher));
  const collectionCount = uniqueCount(rangeItems.map((item) => item.collection));
  const prefix = visibleCount < filteredCount
    ? `显示前 ${visibleCount} 条，匹配 ${filteredCount} / ${baseCount} 条`
    : `显示 ${filteredCount} / ${baseCount} 条`;
  return `${prefix}；覆盖 ${publisherCount} 个发布方、${collectionCount} 个集合${warningText}`;
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
  famTag.style.background = FAM_COLOR[item.family] || FAM_COLOR.unknown;
  famTag.textContent = labelFamily(item.family);
  meta.append(famTag);

  if (item.channel) {
    const channelTag = document.createElement("span");
    channelTag.className = "meta-tag";
    channelTag.textContent = labelChannel(item.channel);
    meta.append(channelTag);
  }

  if (item.originType) {
    const originTag = document.createElement("span");
    originTag.className = "meta-tag";
    originTag.textContent = item.originType;
    meta.append(originTag);
  }

  const sourceText = document.createElement("span");
  sourceText.className = "meta-text";
  sourceText.textContent = [item.publisher, item.collection].filter(Boolean).join(" · ") || "未知发布方";
  meta.append(sourceText);

  if (item.language) {
    const language = document.createElement("span");
    language.className = "meta-note";
    language.textContent = item.language;
    meta.append(language);
  }

  const heading = document.createElement("h2");
  const titleLink = document.createElement("a");
  titleLink.target = "_blank";
  titleLink.rel = "noopener noreferrer";
  titleLink.href = item.url;
  titleLink.textContent = item.title;
  heading.append(titleLink);

  const summary = document.createElement("p");
  summary.className = "summary";
  summary.textContent = item.summary || "暂无摘要，打开原文查看。";

  const tags = document.createElement("div");
  tags.className = "tags";
  for (const tag of item.topic || []) {
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

  body.append(meta, heading, summary);
  if (tags.childElementCount) body.append(tags);
  article.append(body, side);
  return article;
}

function matchesFamily(item) {
  return state.family === "all" || item.family === state.family;
}

function matchesChannel(item) {
  return state.channel === "all" || item.channel === state.channel;
}

function matchesPublisher(item) {
  return state.publisher === "all" || item.publisher === state.publisher;
}

function matchesTopic(item) {
  return state.topic === "all" || item.topic.includes(state.topic);
}

function matchesQuery(item) {
  if (!state.query) return true;
  const haystack = [
    item.title,
    item.summary,
    item.family,
    item.channel,
    item.publisher,
    item.collection,
    item.originType,
    item.language,
    ...(item.topic || [])
  ].join(" ").toLowerCase();
  return haystack.includes(state.query);
}

function compareItems(a, b) {
  if (state.sort === "score") return (b.score ?? -1) - (a.score ?? -1) || newest(a, b);
  if (state.sort === "publisher") return `${labelFamily(a.family)}${a.publisher}${labelChannel(a.channel)}`.localeCompare(`${labelFamily(b.family)}${b.publisher}${labelChannel(b.channel)}`, "zh-CN") || newest(a, b);
  return newest(a, b);
}

function newest(a, b) {
  return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
}

function labelFamily(family) {
  return FAMILY_LABEL[family] || family || "未知";
}

function labelChannel(channel) {
  return CHANNEL_LABEL[channel] || channel || "未知渠道";
}

function normalizeItem(input) {
  return {
    id: cleanText(input.id) || crypto.randomUUID(),
    title: cleanText(input.title) || "未命名资讯",
    url: cleanText(input.url) || "#",
    publishedAt: cleanText(input.publishedAt),
    summary: cleanText(input.summary),
    score: Number.isFinite(input.score) ? input.score : null,
    family: cleanText(input.family) || "unknown",
    channel: cleanText(input.channel) || "unknown",
    publisher: cleanText(input.publisher) || "未知发布方",
    collection: cleanText(input.collection),
    topic: uniqueTexts(input.topic),
    language: typeof input.language === "string" && input.language.trim() ? input.language.trim() : null,
    originType: cleanText(input.originType)
  };
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueTexts(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(cleanText).filter(Boolean))];
}

function countBy(items, getKey) {
  const counts = new Map();
  for (const item of items) {
    const key = getKey(item);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function uniqueCount(values) {
  return new Set(values.filter(Boolean)).size;
}

function compareTaxonomyValues(label) {
  return (a, b) => label(a).localeCompare(label(b), "zh-CN");
}

function resetTaxonomyFilters() {
  state.family = "all";
  state.channel = "all";
  state.publisher = "all";
  state.topic = "all";
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
