# rose-briefing

GitHub Pages 静态 AI 资讯搜索站。初版目标是把公开资讯源聚合成一个可搜索、可筛选、可静态部署的页面；不做主动推送，不做 LLM 打分。

## 内容位置

站点与采集脚本都放在 `briefing/` 目录中：

- `briefing/index.html`：静态页面
- `briefing/app.js`：本地搜索与筛选
- `briefing/styles.css`：样式
- `briefing/scripts/update-data.mjs`：抓取并归一化数据
- `briefing/scripts/build.mjs`：生成 GitHub Pages 部署目录
- `briefing/data/items.json`：最新聚合数据

根目录只保留仓库说明、忽略规则和 GitHub Actions 配置。

## 数据源

初版接入：

1. BestBlogs RSS：`https://www.bestblogs.dev/zh/feeds/rss?category=ai&minScore=80`
2. SuYxh/ai-news-aggregator JSON：`https://raw.githubusercontent.com/SuYxh/ai-news-aggregator/main/data/latest-7d.json`
3. 官方消息源：OpenAI、Google AI、Mistral、Microsoft AI、Qwen、Hugging Face Blog 等官方 RSS，以及 SuYxh OPML 中 AI 公司官方 X 账号
4. SuYxh OPML 里的 X/Twitter RSS：`https://raw.githubusercontent.com/SuYxh/ai-news-aggregator/main/data/opml-feeds.json` 中的 `api.xgo.ing` 源

采集脚本会按 URL/标题去重，按时间倒序保留最多 7000 条。页面默认只渲染匹配结果的前 800 条，避免一次性渲染过多卡片导致浏览器变慢；搜索和筛选仍会作用于全部数据。

当前发布的 `items.json` item 采用统一 canonical taxonomy 字段：

- `id,title,url,publishedAt,summary,score`
- `family`：`curated | official | community | aggregator`
- `channel`：当前使用 `curated-rss | official-rss | official-social | community-social | aggregator-json`
- `publisher`：实际组织 / 账号 / 出版物
- `collection`：抓取到的 feed / bundle / container
- `topic`：归一化后的多值主题标签数组
- `language`：字符串或 `null`
- `originType`：例如 `curated-secondary | direct-official | official-social | aggregated-hotlist | community-post`

## 本地运行

```bash
cd briefing
npm run update
npm run build
npm run check
python3 -m http.server 4173 -d dist
```

然后打开：`http://localhost:4173`

## GitHub Pages

`.github/workflows/pages.yml` 会在以下场景更新数据并部署：

- push 到 `main`
- 手动运行 workflow
- 每 80 分钟定时运行

仓库 Settings → Pages 的 Source 需要选择 **GitHub Actions**。

## 技术文档

- `docs/system-architecture-and-update-flow.md`
  - 系统架构图版（模块图 + 数据流图）
  - 从一次更新开始到上线结束的时序版

## 后续可选增强

- 增加更多官方博客/RSS 一手源
- 增加 GitHub Trending/Hacker News 静态源
- 增加本地收藏/已读状态
- 第二阶段再考虑 LLM 摘要或主题标签
