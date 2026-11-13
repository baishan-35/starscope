# Starscope · GitHub 项目雷达

按分类与标签浏览 GitHub 项目的独立工具站。四种视角：累计目录、涨势目录、新星目录、标签探索。所有视角都把**已收录项目按分数从高到低完整列出**，不做「前 N 名」截断；大列表用滚动渐进加载，不完全渲染时不会阻塞页面。

> 本项目是独立第三方工具，与 GitHub, Inc. 无隶属、授权或背书关系。

## 直接使用

- `site/index.html`：可部署的独立站点（浏览器直接打开或托管到任意静态服务器）
- `github-explorer.html`：全内联单文件版，双击即可离线使用

两份产物由同一份源码构建，数据完全一致。

## 本地构建

需要 Python 3.9+ 与 `curl`（GitHub Actions 的 ubuntu-latest 已自带）。

```bash
python build_github_explorer.py            # 缓存未过期则复用
python build_github_explorer.py --force    # 全量重拉
python build_github_explorer.py --force --ci   # 严格模式：数据异常即失败
```

环境变量：

| 变量 | 说明 |
|---|---|
| `GITHUB_TOKEN` | 可选。CI 中由 secrets 注入，用于放宽 GitHub API 限流；**仅构建进程使用，绝不写入页面** |
| `WB_PROXY` | 可选代理地址，如 `http://127.0.0.1:7877`；留空或设为 `-` 表示直连（CI 默认直连） |
| `CI` | 设为任意非空值即启用严格校验（GitHub Actions 自动设置） |
| `SITE_URL` | 可选正式站点源，如 `https://example.com`（不带结尾斜杠）。设置后才生成 `canonical`、`og:url`、`sitemap.xml` 与 robots 中的 Sitemap 行；本地构建和分享链接留空，避免写出错误的规范地址。CI 中可用仓库变量 `vars.SITE_URL` |

`--ci` 模式下的**失败降级**：抓取完成后会校验各分类与窗口的数据量及字段完整性。若校验不通过且已存在线上产物，脚本会直接退出、不覆盖 `site/` 和单文件，从而保留上一版可用快照；CI 以非零退出码报警。首次构建（尚无产物）才会带警告出版本次数据。

## 定时更新

`.github/workflows/update-snapshot.yml` 每 6 小时自动重拉数据、跑静态检查，并在内容变化时提交 `site/` 与单文件。使用仓库自带的 `GITHUB_TOKEN`，无需额外配置 secret。任务失败时 GitHub 会发送通知，且线上快照保持不变。

若部署到 GitHub Pages，把 Pages 源指向仓库根目录的 `/site` 即可；也可以用任意静态托管（需自行配置压缩、缓存头与 HTTPS）。部署正式域名时记得设置 `SITE_URL`，并把它作为仓库变量 `vars.SITE_URL` 配好，这样定时刷新也会带上正确的规范地址与站点地图。

## 可索引性与 SEO

主站的项目列表由浏览器渲染，爬虫只能看到空容器。因此构建时会额外生成 `site/catalogue.html`：一个**不依赖 JavaScript 的静态目录页**，把本快照累计星标前 100 的真实项目、分类深链和数据边界直接写进 HTML，并带非隶属声明。它同时是无 JS 访客的降级入口。

`site/index.html` 带 Open Graph / Twitter 卡片与 JSON-LD `WebSite` 元数据；`canonical`、`og:url`、`site/sitemap.xml` 和 `robots.txt` 的 Sitemap 行只在配置了 `SITE_URL` 时生成。单文件离线版不带 canonical（它没有公开地址）。

## 项目结构

```
src/index.template.html   页面骨架（唯一真源）
src/tokens.css            设计令牌
src/app.css               组件样式
src/app.js                前端逻辑
src/favicon.svg           品牌标记
build_github_explorer.py  抓数据 + 校验 + 打包
site/                     可部署站点（index.html / catalogue.html /
                          assets / data / robots.txt / sitemap.xml*）
github-explorer.html      自包含单文件版
.github/workflows/        定时刷新快照的 CI
tests/                    静态、对比度、真实浏览器三套检查
```

\* `sitemap.xml` 仅在设置 `SITE_URL` 时生成。

## 数据口径与覆盖边界

- 累计与新星数据来自 GitHub Search API；每个分类 / 窗口最多收录 200 条（分两页拉取）。官方单次搜索最多返回 1000 条结果。
- 涨势数据来自 GitHub Trending 页面的日 / 周 / 月新增星标。Trending 没有官方 API，页面由 HTML 解析得到，因此属于易碎数据源；解析器失效时由数据校验拦截，不会静默发布空榜。
- 页面上的「全部」指**本快照已收录的全部项目**，并在界面上标注去重总数与每类上限；不是 GitHub 全量仓库。
- 新星目录的「日均涨星」是创建至今的平均值，不是近 30 天净增长。涨得快不等于质量好。
- 标签探索由浏览器直接向 GitHub 公开 API 发起匿名请求，站点不接收、不存储任何访问凭据。匿名 Search 端点约 10 次/分钟，认证后约 30 次/分钟；单次查询上限 1000 条结果。

## 校验

```bash
python -m py_compile build_github_explorer.py
node --check src/app.js
node tests/smoke.js          # 数据、DOM、双产物一致性
node tests/contrast.js       # 深浅主题对比度
node tests/browser-check.js  # 360/768/1280/1600 多断点真实浏览器检查
```

## 合规说明

数据使用与品牌展示参考的官方文本（核验日 2026-11-14，以官方最新公告为准）：

- [GitHub 服务条款](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service)（第 H 节 API 条款）
- [GitHub 可接受使用政策](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies)（第 6、7 节服务使用与信息使用限制）
- [GitHub Logo / 品牌使用说明](https://github.com/logos)（不得暗示背书、不得用作自有产品名或标识）
- [REST API 速率限制](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)

以上为条款索引，不构成法律意见。若计划商业化、抓取范围扩大或改用其他数据使用方式，建议先向 GitHub 书面确认适用边界。站点内的「数据来源、边界与声明」区块对外展示了同样的信息。

## 已知局限

- 纯静态站点，无后端、无账号、无历史快照数据库；数据由定时构建生成。
- 涨势榜是 Trending 头部切片，不是全站增量全量。
- 分类归属对趋势 / 新星 / 在线结果使用关键词规则推断，可能存在误判。
- 项目列表由浏览器脚本渲染，未做服务端预渲染，搜索引擎可见性有限。
