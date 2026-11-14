/* Starscope i18n — gettext-style scaffold (Tier D).
 *
 * Chinese is the source of truth: every UI literal stays Chinese in the code
 * and t('中文') returns its English counterpart when the language is English,
 * otherwise the source string untouched. This keeps the diff small, the zh
 * assertions in the test suite valid, and lets English coverage grow one
 * entry at a time.
 *
 * Deliberate scope: the interactive workbench (tabs, filters, results,
 * detail sheet, favourites, load-more, tag panel, statuses) is bilingual.
 * The page shell's editorial copy (hero, methodology, legal, footer) stays
 * Chinese in this iteration — compliance wording in particular is reviewed
 * against the official GitHub terms in Chinese only.
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
    '移除 ': 'Remove ', '继续加载': 'Load more'
  };

  var lang = 'zh';
  try { lang = localStorage.getItem(STORE_KEY) || 'zh'; } catch (e) { lang = 'zh'; }

  window.STASCOPE_I18N = {
    lang: lang,
    set: function (l) {
      lang = (l === 'en') ? 'en' : 'zh';
      this.lang = lang;
      try { localStorage.setItem(STORE_KEY, lang); } catch (e) {}
    }
  };

  window.t = function (s) {
    if (lang !== 'en' || s == null) return s;
    return dict[s] != null ? dict[s] : s;
  };
})();
