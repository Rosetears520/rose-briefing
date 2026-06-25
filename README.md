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
2. SuYxh/ai-news-aggregator JSON：`https://raw.githubusercontent.com/SuYxh/ai-news-aggregator/main/data/latest-24h.json`

采集脚本会按 URL/标题去重，按时间倒序保留最多 700 条。

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
- 每 3 小时定时运行

仓库 Settings → Pages 的 Source 需要选择 **GitHub Actions**。

## 后续可选增强

- 增加更多官方博客/RSS 一手源
- 增加 GitHub Trending/Hacker News 静态源
- 增加本地收藏/已读状态
- 第二阶段再考虑 LLM 摘要或主题标签
