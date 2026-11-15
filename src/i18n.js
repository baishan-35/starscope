/* Starscope i18n — gettext-style scaffold (Tier D).
 *
 * Chinese is the source of truth: every UI literal stays Chinese in the code
 * and t('中文') returns its English counterpart when the language is English,
 * otherwise the source string untouched. This keeps the diff small, the zh
 * assertions in the test suite valid, and lets English coverage grow one
 * entry at a time.
 *
 * Deliberate scope: the interactive workbench (tabs, filters, results,
 * detail sheet, favourites, load-more, tag panel, statuses) AND the page
 * shell's editorial copy (hero, methodology, legal, footer) are bilingual.
 * The English legal card is explicitly a courtesy translation — for
 * compliance wording the Chinese original together with GitHub's official
 * terms govern.
 */
(function () {
  'use strict';
  var STORE_KEY = 'starscope-lang';
  var dict = {
    /* tabs / view names */
    '累计目录': 'Catalogue', '涨势目录': 'Rising', '新星目录': 'New', '标签探索': 'Tags',
    '按星标': 'by stars', '按增量': 'by gain', '按起速': 'by velocity', '找更多': 'discover',
    '目录视角': 'catalogue lens',
    /* sorts */
    '星标总数': 'Total stars', '最近更新': 'Recently updated', 'Fork 数': 'Forks',
    '创建时间': 'Created', '新增星标': 'Star gain', '涨幅': 'Gain ratio',
    '日均涨星': 'Stars per day', '默认': 'Default',
    /* subbar */
    '时间窗口': 'Window', '创建窗口': 'Created within', '标签探索': 'Tags',
    '清空标签': 'Clear tag', '清除分类': 'Clear category', '当前分类：': 'Current category: ',
    '全部项目': 'All projects',
    '在下方标签云点一个标签，或输入标签后回车': 'Pick a tag from the cloud below, or type one and press Enter',
    '分类在左侧，切换视角不会消失': 'Categories live in the left rail and persist across views',
    /* rail */
    '按分类浏览': 'Browse by category', '热门标签': 'Popular tags', '点击探索': 'click to explore',
    '没找到想要的？': 'Nothing fits?', '打开标签探索 →': 'Open tag explorer →',
    /* toolbar / fields */
    '全部语言': 'All languages', '关键词 · 按 / 聚焦': 'Keyword · press / to focus',
    '语言': 'Language', '最低星标': 'Min stars', '最近更新': 'Recently updated', '排序': 'Sort',
    '不限': 'Any', '近 1 个月': 'Past month', '近半年': 'Past 6 months', '近 1 年': 'Past year',
    '搜索项目名、简介、标签…': 'Search names, descriptions, topics…',
    '在当前标签结果中筛选名称、简介…': 'Filter names & descriptions within results…',
    /* filter bar */
    '生效筛选': 'Active filters', '清空全部': 'Clear all',
    '在线补充结果': 'Online extras', '更新时限': 'Updated within',
    /* summary / result info */
    '共 ': ' items · ', ' 个项目': ' projects',
    '已全部显示': 'all shown', '快照收录 ': 'snapshot covers ',
    '没找到？用标签探索 →': 'Nothing here? Try the tag explorer →',
    /* load more */
    '继续加载': 'Load more', '滚动到底自动继续加载': 'auto-loads on scroll',
    /* empty states */
    '没有符合条件的项目': 'No projects match the filters',
    '可以放宽筛选条件、切换目录视角，或者顺着标签去 GitHub 找更多同类项目。':
      'Loosen the filters, switch lenses, or follow tags to find more on GitHub.',
    '当前生效：': 'Active: ', '清空筛选': 'Clear filters',
    '从标签出发，找目录之外的项目': 'Start from a tag to reach beyond the snapshot',
    '查看全部标签': 'Show all tags',
    /* rows / badges / stats */
    '更新 ': 'updated ', '创建 ': 'created ', '快照': 'snapshot', '在线发现': 'online',
    '在线补充': 'online extra', '星/天': ' stars/day',
    '涨幅 ': 'gain ratio ', '收藏该项目': 'Favourite', '取消收藏': 'Unfavourite',
    '收藏 ': 'Favourite ', '取消收藏 ': 'Unfavourite ',
    /* nav / shell */
    '项目浏览': 'Browse', '数据口径': 'Methodology', '关于': 'About',
    '开始探索 ↓': 'Start exploring ↓', '打开标签探索': 'Open tag explorer',
    /* category names (payload data, stable) */
    '全部项目 · 总榜': 'All projects', 'AI 与大模型': 'AI & LLMs', 'AI Agent': 'AI Agents',
    '自部署 / 自建服务': 'Self-hosted', '开发者工具 / CLI': 'Dev tools / CLI',
    '前端与 UI': 'Frontend & UI', '数据库与存储': 'Databases & storage',
    'DevOps / 云原生': 'DevOps / cloud-native', '安全与逆向': 'Security & reversing',
    '自动化与效率': 'Automation & productivity', '游戏与多媒体': 'Games & multimedia',
    '学习资源 / Awesome': 'Learning / awesome lists',
    /* filter fragments */
    '分类：': 'Category: ', '关键词：': 'Keyword: ', '语言：': 'Language: ',
    '标签：#': 'Tag: #', ' 星': ' stars',
    '近 1 个月更新': 'Updated within a month', '近半年更新': 'Updated within 6 months',
    '近 1 年更新': 'Updated within a year',
    '快照只收录有限项目，用标签顺着找 GitHub 上更多同类项目。':
      'The snapshot is finite — follow tags to reach more of GitHub.',
    ' 项': ' items', ' 天 · 创建 ': ' days · created ', '已显示 ': 'Showing ',
    /* favourites chrome */
    '只看收藏': 'Favourites only', '复制收藏列表': 'Copy favourites', '清空收藏': 'Clear favourites',
    '点此显示全部': 'show all', '☆ 只看收藏': '☆ Favourites only',
    '收藏夹还是空的：点项目标题左侧的 ☆ 收藏它': 'No favourites yet — tap ☆ next to a project name',
    /* detail sheet */
    '项目详情': 'Project details', '星标': 'Stars', '开放 issue': 'Open issues',
    '主语言': 'Language', '许可证': 'License', '创建于': 'Created', '最近更新': 'Last updated',
    '近 30 天净增长': '30-day net growth', '在 GitHub 查看 ↗': 'View on GitHub ↗',
    '该项目没有填写简介。': 'This repository has no description.',
    '（快照差分）': ' (snapshot delta)', '关闭详情（Esc）': 'Close details (Esc)',
    /* tag panel */
    '按标签发现项目': 'Discover projects by tag',
    '输入标签，如 rss、self-hosted、cli…': 'Type a tag, e.g. rss, self-hosted, cli…',
    '按 topic 标签': 'by topic tag', '按名称/简介关键词': 'by name/description keyword',
    '按 README 全文': 'by README full text', '搜索项目': 'Search',
    '相关标签': 'Related tags', '继续从 GitHub 加载同类项目': 'Load more from GitHub',
    /* statuses */
    '在线查询失败：': 'Online query failed: ',
    '；快照内的结果仍可正常浏览。': '; snapshot results remain available.',
    /* today/this week/this month labels (from payload periods) */
    '今日': 'today', '本周': 'this week', '本月': 'this month',
    /* period / window names (payload) */
    '今日涨势': 'Daily', '本周涨势': 'Weekly', '本月涨势': 'Monthly',
    '近 90 天新建': 'Created < 90d', '近 1 年新建': 'Created < 1y',
    /* misc chrome */
    '用标签探索 →': 'Try tags →', '在线补充此分类': 'Refresh this category online',
    '查看数据来源': 'Data sources', '重新查询该标签': 'Re-query this tag',
    '移除 ': 'Remove ', '继续加载': 'Load more',
    /* editorial copy: shell, hero, method, CTA, legal, footer */
    '跳到主内容': 'Skip to main content',
    'GitHub 项目雷达': 'GitHub project radar',
    '直接看涨势目录': 'See the momentum view',
    '按分类浏览、按标签筛选，已收录项目从高到低完整列出，不做「前 N 名」截断。累计星标只记录过去，涨势目录给你现在正在发生的事。':
      'Browse by category, filter by tag — every indexed repo listed in full, no "top N" cutoffs. Total stars record the past; the momentum view shows what is happening right now.',
    'Trending 多语言聚合': '16-language Trending merge',
    '已收录项目完整列出': 'every indexed repo listed',
    '今日新增星标 · 头部 24 项': 'New stars today · top 24',
    '数据源 GitHub Trending': 'Source: GitHub Trending',
    '累计目录去重项目': 'unique repos indexed',
    '日 / 周 / 月窗口合计': 'daily / weekly / monthly',
    '可继续探索的标签': 'topics to explore',
    '贯穿所有视角的分类': 'categories across views',
    '项目浏览器': 'Project browser',
    '已收录项目按分数从高到低完整列出，筛选条件随时可见、一键可清。':
      'Every indexed repo, best-first. Filters stay visible and clear in one click.',
    '复制当前视图链接': 'Copy view link',
    '快照只收录有限项目。点项目上的 #标签、从标签云选一个，或直接输入标签，即可实时向 GitHub 查询同类项目，把目录之外的项目也找出来。':
      'The snapshot is finite. Tap a #tag on a project, pick one from the cloud, or type one — the tag explorer queries GitHub live for similar projects beyond the catalogue.',
    '在线查询由浏览器直接匿名请求 GitHub 公开 API，本站不接收、不存储任何凭据。匿名额度约 10 次/分钟，繁忙时稍后重试即可。':
      'Online queries go straight from your browser to the public GitHub API — this site receives and stores no credentials. Anonymous quota is ~10 requests/minute; retry shortly if busy.',
    '筛选标签云': 'Filter the tag cloud',
    '例如 rust': 'e.g. rust',
    '三种指标，别只看一种': 'Three metrics — do not trust just one',
    '累计目录回答「谁攒得多」，涨势目录回答「现在谁在涨」，标签探索负责快照没收录到的长尾。三者都从高到低完整列出。':
      'The catalogue answers "who has the most", momentum answers "who is rising now", and tags cover the long tail beyond the snapshot. All three list everything they hold, best-first.',
    '按分类从 GitHub Search API 取回项目，每类最多 200 条，按星标从高到低完整列出，不做榜单式截断。适合找成熟、可长期依赖的基础设施，代价是老项目有先发优势。':
      'Repos are pulled per category from the GitHub Search API (up to 200 each) and listed best-first with no leaderboard cutoffs. Great for finding mature infrastructure to depend on — the cost is the incumbents\' head start.',
    '窗口增量': 'Window gains',
    '合并 16 张 GitHub Trending 页面，保留日 / 周 / 月全部带真实增量的项目并按新增星标降序完整列出。增量数字优先取自本站快照差分（可复现），无历史时回退 Trending 页面数字；差分基准取最接近 1 / 7 / 30 天前的每日快照采样，与自然日边界可能有偏差，历史不足时取最接近的可用采样，每条数据的口径在详情面板单独标注。「涨幅 = 新增 ÷ 总量」让小基数高增长浮上来。':
      'Sixteen GitHub Trending pages merge into daily / weekly / monthly lists with real star gains, sorted by new stars. Gains prefer this site\'s snapshot deltas (reproducible) and fall back to the Trending page numbers until history exists. The delta baseline is the daily sample closest to 1 / 7 / 30 days ago, so it can differ from calendar-day boundaries; when history is thin the closest available sample is used, and each row labels its source in the detail sheet. "Ratio = gain ÷ total" surfaces fast movers on a small base.',
    '标签扩散': 'Tag diffusion',
    '从任意项目的 topic 出发，实时查询该标签下的其他仓库，再顺着「相关标签」继续挖，把快照之外的项目也纳入结果。':
      'Start from any repo\'s topics, query other repositories under that tag live, then keep digging through "related tags" to pull in projects beyond the snapshot.',
    '目录里没找到？': 'Not in the catalogue?',
    '换一条路径：从标签出发，实时拉取 GitHub 上同类但本站还没收录的项目。':
      'Take another path: start from a tag and pull similar repos live from GitHub — including ones this site has not indexed yet.',
    '回到分类浏览': 'Back to browsing',
    '数据来源、边界与声明': 'Data sources, boundaries & notices',
    '把「全部」说清楚：这里完整列出的是本站已收录的项目，不是 GitHub 全量仓库。':
      'Being clear about "everything": the full lists cover repos this site has indexed — not all of GitHub.',
    '非官方、非隶属': 'Unofficial & unaffiliated',
    '数据来源与覆盖': 'Data sources & coverage',
    '隐私与凭据': 'Privacy & credentials',
    '准确性与局限': 'Accuracy & limits',
    '本站无账号体系、无第三方统计与广告。主题、界面语言与收藏列表只保存在你的浏览器本地。页面发生脚本异常或数据分块加载失败时，会把错误类型、错误消息、页面路径、当前视角与浏览器标识上报到本站同源的 /api/errors，仅用于排查故障；不含 Cookie、访问凭据或账号信息，单文件版不启用上报。标签探索由浏览器直接向 GitHub 公开 API 发起匿名请求，不收集、不传输任何访问凭据。匿名额度约 10 次/分钟，超限稍后重试即可。':
      'No accounts, no third-party analytics or ads. Theme, interface language and favourites stay in your browser only. When a script error or a data-chunk failure occurs, the error type, message, page path, active view and browser user-agent are reported to this site\u2019s same-origin /api/errors endpoint solely for diagnosing faults; no cookies, credentials or account data are included, and the single-file build disables reporting entirely. Tag exploration calls the public GitHub API anonymously straight from the browser; no credentials are collected or transmitted. Anonymous quota is ~10 requests/minute; retry later if exceeded.',
    '涨势数据只是 Trending 的头部切片，涨得快不等于质量好；新星目录的「日均涨星」是创建至今的平均值。「近 30 天净增长」依赖本站逐日快照历史，需累积约 30 天后才会出现，此前不做估算。所有数字以 GitHub 实时页面为准，本站不对数据的完整性或时效性作保证。':
      'Momentum data is only the top slice of Trending — rising fast does not mean being good. The new-repos "stars per day" is a lifetime average. "30-day net growth" depends on this site\'s daily snapshot history and only appears once roughly 30 days have accumulated — no estimates before then. All numbers defer to the live GitHub page; completeness and timeliness are not guaranteed.',
    '浏览': 'Browse',
    '数据源': 'Data sources',
    '数据来源与声明': 'Data sources & notices',
    '指标口径与局限': 'Metrics & limits',
    '给中文开发者的 GitHub 项目发现工具。数据本地生成，页面无需登录。':
      'A GitHub project-discovery tool. The snapshot is generated by a local pipeline; the page needs no login.',
    '快照 ': 'snapshot '
  };

  var lang = 'zh';
  try { lang = localStorage.getItem(STORE_KEY) || 'zh'; } catch (e) { lang = 'zh'; }

  /* Editorial blocks that carry inner HTML (links, <em>, dynamic spans)
   * cannot go through textContent swaps. The template marks them with
   * data-i18n="<key>"; the zh original is cached from the DOM on the first
   * pass and restored when switching back. {time} resolves to the snapshot
   * generation timestamp at runtime. */
  var EN_HTML = {
    'hero.eyebrow': 'GitHub discovery · snapshot {time}',
    'hero.title': 'Don\u2019t let <em>great projects</em> sink into yesterday\u2019s rankings.',
    'method.caveat': '<strong>What \u201ceverything\u201d covers:</strong> the complete lists are the repos this site has indexed (<span id="caveatCount">\u2014</span>), not all of GitHub \u2014 official search returns at most 1000 results per query and the snapshot refreshes on a schedule. Momentum data is still only the top slice of Trending: rising fast \u2260 being good. The new-repos \u201cstars per day\u201d is a lifetime average, not last-30-day net growth.',
    'legal.notice': 'Starscope is an independent third-party tool with no affiliation with, endorsement by, or authorization from GitHub, Inc. GitHub is a trademark of GitHub, Inc.; repository names and descriptions belong to their respective owners. This site uses public data under GitHub\u2019s <a href="https://docs.github.com/en/site-policy/github-terms/github-terms-of-service" target="_blank" rel="noopener">Terms of Service</a>, <a href="https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies" target="_blank" rel="noopener">Acceptable Use Policies</a> and <a href="https://github.com/logos" target="_blank" rel="noopener">brand guidance</a>; those terms were verified on 2026-11-14 and the official texts prevail. This English page is a courtesy translation \u2014 for compliance wording, the Chinese original together with GitHub\u2019s official terms govern.',
    'footer.snapshot': 'Snapshot {time}, auto-generated',
    'footer.legal.time': 'Snapshot {time} (Beijing time) · refreshed on a schedule',
    'footer.legal.note': '<a href="#legal">Not affiliated with GitHub · privacy &amp; notices</a> · star counts defer to the live GitHub page',
    'footer.rss': '<a href="rss.xml" target="_blank" rel="noopener">RSS feed · weekly momentum digest</a>'
  };

  function fillTime(html) {
    var gen = '';
    try { gen = (window.SNAPSHOT && window.SNAPSHOT.generated) || ''; } catch (e) {}
    return html.replace(/\{time\}/g, gen);
  }

  window.STASCOPE_I18N = {
    lang: lang,
    set: function (l) {
      lang = (l === 'en') ? 'en' : 'zh';
      this.lang = lang;
      try { localStorage.setItem(STORE_KEY, lang); } catch (e) {}
    },
    /* Swap every [data-i18n] block between its cached zh original and the
     * English overlay. Call after toggling the language (and once at boot
     * when the stored language is English). */
    applyStatic: function () {
      var en = lang === 'en';
      var blocks = document.querySelectorAll('[data-i18n]');
      for (var i = 0; i < blocks.length; i++) {
        var el = blocks[i];
        if (el.__zhHtml === undefined) el.__zhHtml = el.innerHTML;
        var entry = EN_HTML[el.getAttribute('data-i18n')];
        el.innerHTML = (en && entry != null) ? fillTime(entry) : el.__zhHtml;
      }
    }
  };

  window.t = function (s) {
    if (lang !== 'en' || s == null) return s;
    return dict[s] != null ? dict[s] : s;
  };
})();
