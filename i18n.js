// i18n.js
// Global translation system. Loaded as a regular (non-module) script BEFORE
// script.js so that window.t and window.setLang are available everywhere.
//
// Translation lookup order: currentLang → English fallback → return the raw key.
// Interpolation: t('foo.bar', { name: 'Alice' }) substitutes {name} in the value.
//
// Static text uses data-i18n="key" (textContent) or data-i18n-html="key" (innerHTML).
// Attribute translation uses data-i18n-attr="title:key,placeholder:key2".
// Dynamic text (set from JS) calls window.t(key) at the point it's written
// and listens for the 'i18n:change' event to re-render.

(function () {

  const ABOUT_BODY_EN = `
    <h2 data-i18n="about.title">About</h2>

    <h3 data-i18n="about.question.heading">The question</h3>
    <p data-i18n-html="about.question.body"></p>

    <h3 data-i18n="about.rationale.heading">Design rationale</h3>
    <div data-i18n-html="about.rationale.body"></div>

    <h3 data-i18n="about.data.heading">Data and sources</h3>
    <div data-i18n-html="about.data.body"></div>

    <h3 data-i18n="about.development.heading">Development process</h3>
    <div data-i18n-html="about.development.body"></div>

    <h3 data-i18n="about.methodology.heading">Methodology and limitations</h3>
    <div data-i18n-html="about.methodology.body"></div>
  `;

  const I18N = {

    en: {

      /* Loader and top bar */
      'loader': 'Loading sentiment flows',
      'window.aggregated': '{n} days aggregated',
      'mode.geo.indicator': 'Mode I · Geographic',
      'mode.reorganized.indicator': 'Mode II · Reorganized by Affinity',
      'mode.updown.indicator': 'Mode III · UP/DOWN: {a} vs {b}',

      /* Toggles */
      'domain.politics': 'Politics',
      'domain.science': 'Science',
      'domain.sports': 'Sports',
      'mode.geo': 'Geographic',
      'mode.reorganized': 'Reorganized',
      'mode.updown': 'UP/DOWN',
      'mode.updown.title': 'Select exactly 2 countries (in Reporters, By Country) to enable',
      'elevation.label': 'Elevation',
      'compare.label': 'Compare',
      'common.on': 'On',
      'common.off': 'Off',

      /* About */
      'about.link': 'About',
      'about.title': 'About this project',
      'common.close': 'Close',

      /* Stats / legend / tooltip */
      'stats.activeDomain': 'Active Domain',
      'stats.reporters': 'Reporters',
      'stats.mentioned': 'Mentioned',
      'stats.articles': 'Articles',
      'stats.pairs': 'Pairs',
      'stats.meanTone': 'Mean Tone',
      'legend.meanTone': 'Mean Tone (avg_tone)',
      'tooltip.articlesPublished': 'Articles published',
      'tooltip.meanToneOut': 'Mean tone (out)',
      'tooltip.topTargets': 'Top targets',
      'tooltip.bloc': 'Bloc',
      'tooltip.vs': 'vs.',
      'tooltip.affinity': 'Affinity',
      'tooltip.tier': 'Tier',
      'tooltip.articles': 'Articles',
      'tooltip.directed': '(directed)',
      'tooltip.mutual': '(mutual)',

      /* Country modal */
      'cm.articles': 'Articles',
      'cm.meanTone': 'Mean Tone',
      'cm.targets': 'Targets',
      'cm.activeDays': 'Active Days',
      'cm.showingAll': 'Showing all data',
      'cm.noArticles': 'No high-tone articles in current filter window for this country.',
      'cm.toneDist': 'Tone distribution',
      'cm.dailyVolume': 'Daily article volume',
      'cm.topTargets': 'Top mentioned countries',
      'cm.topArticles': 'Most extreme-tone articles',

      /* Filter bar */
      'filter.filters': 'Filters',
      'filter.timeWindow': 'Time Window',
      'filter.minArticles': 'Min Articles',
      'filter.minArticlesHint': 'Hides reporters below this volume',
      'filter.reporters': 'Reporters',
      'filter.tone': 'Tone',
      'filter.byRegion': 'By Region',
      'filter.byCountry': 'By Country',
      'common.all': 'All',
      'common.none': 'None',
      'common.clear': 'Clear',
      'filter.searchPlaceholder': 'Type to search countries\u2026',
      'filter.preset.all21': 'All 21 days',
      'filter.preset.last7': 'Last 7',
      'filter.preset.weekA': 'Election wk',
      'filter.preset.weekB': 'Olympics wk',
      'filter.preset.weekC': 'Science wk',
      'tone.negative': 'Negative',
      'tone.neutral': 'Neutral',
      'tone.positive': 'Positive',

      /* Dynamic readouts */
      'readout.allDays': 'All days',
      'readout.daysShort': '{n}d',
      'readout.allRegions': 'all regions',
      'readout.regionsCount': '{n}/{total} regions',
      'readout.countryCount': '{n} countries',
      'readout.countryCountOne': '1 country',
      'readout.allTones': 'all tones',
      'readout.tonesCount': '{n}/3 tones',
      'readout.toneAll': 'all',
      'readout.toneCount': '{n}/3',
      'readout.minPrefix': 'min {n}',
      'readout.minCountSuffix': '+',
      'readout.timeWindow': '{days} days, {start} to {end}',
      'readout.timeWindowSingular': '1 day, {start}',
      'readout.timePresetAll': '21 days',

      /* Tier labels (Compare mode) */
      'tier.extremePositive': 'extreme positive',
      'tier.close': 'close',
      'tier.baseline': 'baseline',
      'tier.far': 'far',
      'tier.veryFar': 'very far',

      /* Region / bloc names */
      'bloc.africa': 'Africa',
      'bloc.anglosphere': 'Anglosphere',
      'bloc.asia_pacific': 'Asia Pacific',
      'bloc.central_asia': 'Central Asia',
      'bloc.europe_other': 'Other Europe',
      'bloc.european_union': 'European Union',
      'bloc.latin_america': 'Latin America',
      'bloc.middle_east': 'Middle East',
      'bloc.north_america': 'North America',
      'bloc.russia_sphere': 'Russia Sphere',
      'bloc.south_asia': 'South Asia',

      /* About modal body: assembled into ABOUT_BODY_EN above */
      'about.body': ABOUT_BODY_EN,

      'about.question.heading': 'The question',
      'about.question.body': `
        This visualization investigates how the world's news media talks about itself: which countries cover which others, how warmly or coldly, and how those patterns vary across thematic domains and over time. Rather than answering one fixed question, the same dataset is exposed through three coordinated views so that different sub-questions surface naturally.
        <ul>
          <li><strong>Where is the news coming from?</strong> The Geographic view renders reporting volume as a 3D landscape, so dense reporting regions become mountain ranges and quiet regions become low plains.</li>
          <li><strong>Who are the natural allies and rivals in media discourse?</strong> The Reorganized view dissolves geography and re-lays countries by mutual tonal affinity, exposing diplomatic and editorial neighborhoods.</li>
          <li><strong>How does the world see country X, and how is that different from country Y?</strong> The UP/DOWN view stacks two focal countries and arranges all other countries radially by directed sentiment toward each focal.</li>
        </ul>
        The 21-day data window spans three news cycles chosen for thematic contrast: late October 2025 (US election cycle), late February 2026 (Milano-Cortina Winter Olympics), and mid-April 2026 (a science and technology cycle).
      `,

      'about.rationale.heading': 'Design rationale',
      'about.rationale.body': `
        <h4>Encoding</h4>
        <p>The base encoding is a continuous 3D heightfield rather than a per-country choropleth or 3D extrusion. A heightfield was chosen because reporting volume from multiple countries naturally combines into regional intensities (Western Europe forms a ridge, the Persian Gulf forms a small plateau) rather than discrete blocks. Vertex color and small-scale displacement noise redundantly encode tone: negative regions read as rough silhouettes even at low camera tilt and for viewers with color-vision deficiencies.</p>
        <p>Alternatives considered and rejected:</p>
        <ul>
          <li><em>Flat 2D choropleth.</em> Simpler to implement, but carries one fewer dimension of information; volume would have to live in a second view.</li>
          <li><em>Per-country 3D extrusions (bars on a map).</em> Quantitatively cleaner per country but presents as competing blocks rather than a continuous landscape, losing the regional-ridge effect.</li>
          <li><em>Streamgraph or stacked bars over time.</em> Useful for trend reading but cannot show geographic structure.</li>
          <li><em>Globe projection (sphere).</em> Pretty but breaks the force-directed Mode II layout and the radial Mode III layout, both of which assume a planar surface.</li>
        </ul>

        <h4>Interaction</h4>
        <p>The course brief cites NameVoyager as a model: one focused interaction reveals all the structure of a dataset. Here the equivalent primitive is mode switching across three coordinated views of the same data. Each view answers a different question, and switching gives a kinesthetic sense of how the data rearranges itself under each question. Compare mode adds an overlay of fan lines from a reference country, with line brightness modulated by both affinity strength and article volume so that high-confidence relationships stand out from baseline noise.</p>
        <p>Five filter axes (domain, time window, reporters by region or by country, tone, and minimum articles) can be combined freely; the heightfield tweens between filter states over about 340 milliseconds. Hover reveals on-demand tooltips, click opens a per-country detail modal with four KPIs and three SVG charts.</p>

        <h4>What was cut</h4>
        <p>We considered side-by-side small multiples (one chart per domain), a brushable time-range mini-map, and animated playback through time. All were dropped because they would have diluted the single core interaction (mode switching) that the assignment brief explicitly rewards over sprawling dashboards.</p>

        <h4>Decision criterion</h4>
        <p>For every choice the test was: does this encoding or interaction help the reader build accurate intuition about cross-country media sentiment, or does it merely look impressive? Choices that scored only on aesthetics (richer textures, more saturated colors, particle effects) were rejected even when straightforward to implement.</p>
      `,

      'about.data.heading': 'Data and sources',
      'about.data.body': `
        <p><strong>Source.</strong> GDELT 2.0 Global Knowledge Graph, sampled every 4 hours (6 files per day) across three weeks chosen for thematic contrast: late October 2025 (US election cycle), late February 2026 (Milano-Cortina Winter Olympics), and mid-April 2026 (recent science and technology cycle). Data released under the GDELT Project's open terms.</p>

        <p><strong>Retained dataset.</strong> After country attribution and theme filtering: 28,607 flow rows across 202 country-attributable reporters, split as 19,024 politics, 9,432 science, 151 sports.</p>

        <p><strong>Schema.</strong> Each flow row has the form <code>(date, reporter, mentioned, domain, count, avg_tone, delta_tone)</code>. The <code>delta_tone</code> field is the analytical workhorse: it is the bucket's mean tone minus the global mean tone toward the same mentioned country on the same date in the same domain, which isolates reporter-specific bias from the inherent valence of the underlying events. Modes II and III, and the Compare overlay, all read off <code>delta_tone</code>, not raw tone.</p>

        <p><strong>Article-level rows</strong> for the top 100 most extreme-tone articles per reporter are kept separately and surfaced in the country detail modal, with live URLs back to the source publication.</p>

        <p><strong>External libraries.</strong> <a href="https://threejs.org/" target="_blank" rel="noopener">Three.js</a> for WebGL rendering and orbit controls. No framework, no transpiler, no bundler. Plain JSON for data. SVG for the in-modal charts. Fraunces and JetBrains Mono from Google Fonts.</p>
      `,

      'about.development.heading': 'Development process',
      'about.development.body': `
        <p><strong>What took the most time.</strong> In rough order:</p>
        <ul>
          <li><strong>Heightfield mesh construction.</strong> Choosing the right per-country falloff function, simplifying country boundary polygons to ~80 vertices each, and tuning the influence radius so that small countries do not vanish and large countries do not dominate took the longest single block of work.</li>
          <li><strong>UP/DOWN polygon repair pass.</strong> Naive radial placement produced country shapes that overlapped each other and spilled across the pane divider. The 80-pass repair loop with hand-tuned constants (<code>BASELINE = 70</code>, <code>STEPS = 350</code>) was iterative and slow to debug.</li>
          <li><strong>Compare-overlay line scoring.</strong> The brightness formula (<code>max(|sym|/1.5, log(count+1)/4 * 0.6) * 0.75 + 0.25</code>) went through several drafts before low-confidence baseline pairs were dim enough that the eye reliably picked out strong signals first.</li>
          <li><strong>The <code>delta_tone</code> correction pipeline.</strong> Writing the aggregation script that computes per-bucket global means and joins them back to the per-reporter rows took longer than expected, mostly because GDELT's raw schema needed several normalization passes.</li>
        </ul>

        <p><strong>What was hardest.</strong> Holding the project to a tightly-scoped feature set. Many promising additions (a year-range brush, brushable small multiples, animated time playback, audio cues) were prototyped and then deliberately cut, because each diluted the core mode-switching interaction the rubric explicitly rewards.</p>
      `,

      'about.methodology.heading': 'Methodology and limitations',
      'about.methodology.body': `
        <p>The project documents its limitations openly. The most important ones:</p>

        <h4>Tone is noisy</h4>
        <p>GDELT's tone signal blends linguistic sentiment, topic valence, and editorial bias. The <code>delta_tone</code> correction removes the topic-level baseline but does not remove linguistic-style differences across languages and outlets. Colors should be read as directional indicators, not precise measurements.</p>

        <h4>Reporter attribution is biased</h4>
        <p>Roughly 13 percent of GDELT records survive the country attribution step (URL TLD plus a curated lookup for generic <code>.com</code> and <code>.org</code> domains). The kept set skews toward English-language Western media. Russian, Chinese, Arabic, and many regional outlets are systematically underrepresented. Conclusions drawn here are conclusions about the visible-to-Western-Internet news ecosystem, not about global media.</p>

        <h4>Sports coverage is thin</h4>
        <p>GDELT's theme taxonomy does not strongly tag sports content. Even during Olympics week, the retained sports count is low (151 rows total versus 19,024 politics and 9,432 science). Use sports as a trend indicator, not a comprehensive picture.</p>

        <h4>The data window is short</h4>
        <p>Only 21 days are loaded, chosen for thematic contrast rather than continuous coverage. Time-series claims should be modest.</p>

        <h4>Cross-border elevation spill (Mode I only)</h4>
        <p>The heightfield is continuous, so a country's signal influences vertices slightly beyond its actual territory. This is a small geographic lie traded for a readable landscape. If strict per-country boundaries are needed, switch to the basemap-only view (Elevation toggle off).</p>

        <h4>Per-vertex math (Mode I)</h4>
        <p>For each country C and each vertex V within range, the contribution is <code>log(C.count + 1) &times; SCALE &times; falloff(distance(V, C), C.radius)</code>, where <code>falloff</code> is a smooth cosine bump that peaks at the country's centroid and drops to zero at its radius. Contributions are summed with a hard cap to prevent runaway peaks where many active countries overlap.</p>

        <h4>Symmetric affinity (Mode II)</h4>
        <p>For each unordered pair of countries {A, B}, the symmetric affinity is the article-count-weighted average of the two directional <code>delta_tone</code> values. Pairs without bidirectional coverage are dropped, so peripheral countries can float without strong attachment.</p>
      `,
    },

    zh: {

      'loader': '正在加载情感数据流',
      'window.aggregated': '聚合 {n} 天',
      'mode.geo.indicator': '模式 I · 地理地形',
      'mode.reorganized.indicator': '模式 II · 按情感亲和度重组',
      'mode.updown.indicator': '模式 III · UP/DOWN：{a} 与 {b}',

      'domain.politics': '政治',
      'domain.science': '科技',
      'domain.sports': '体育',
      'mode.geo': '地理',
      'mode.reorganized': '重组',
      'mode.updown': 'UP/DOWN',
      'mode.updown.title': '需先在「报道国 → 按国家」中选中恰好两个国家',
      'elevation.label': '地形',
      'compare.label': '对比',
      'common.on': '开',
      'common.off': '关',

      'about.link': '关于',
      'about.title': '关于本项目',
      'common.close': '关闭',

      'stats.activeDomain': '当前主题',
      'stats.reporters': '报道国数',
      'stats.mentioned': '被提及国',
      'stats.articles': '文章数',
      'stats.pairs': '关系对',
      'stats.meanTone': '平均情感',
      'legend.meanTone': '平均情感 (avg_tone)',
      'tooltip.articlesPublished': '发文数',
      'tooltip.meanToneOut': '对外平均情感',
      'tooltip.topTargets': '主要对象',
      'tooltip.bloc': '所属区域',
      'tooltip.vs': '相对于',
      'tooltip.affinity': '亲和度',
      'tooltip.tier': '层级',
      'tooltip.articles': '文章数',
      'tooltip.directed': '（有向）',
      'tooltip.mutual': '（双向）',

      'cm.articles': '文章数',
      'cm.meanTone': '平均情感',
      'cm.targets': '被提国数',
      'cm.activeDays': '活跃天数',
      'cm.showingAll': '显示全部数据',
      'cm.noArticles': '当前筛选条件下该国没有高情感文章。',
      'cm.toneDist': '情感分布',
      'cm.dailyVolume': '每日文章数',
      'cm.topTargets': '主要提及的国家',
      'cm.topArticles': '情感最极端的文章',

      'filter.filters': '筛选',
      'filter.timeWindow': '时间窗口',
      'filter.minArticles': '最低文章数',
      'filter.minArticlesHint': '过滤掉低于此数量的报道国',
      'filter.reporters': '报道国',
      'filter.tone': '情感倾向',
      'filter.byRegion': '按区域',
      'filter.byCountry': '按国家',
      'common.all': '全选',
      'common.none': '清空',
      'common.clear': '清空',
      'filter.searchPlaceholder': '输入国家名搜索\u2026',
      'filter.preset.all21': '全部 21 天',
      'filter.preset.last7': '最近 7 天',
      'filter.preset.weekA': '大选周',
      'filter.preset.weekB': '冬奥周',
      'filter.preset.weekC': '科技周',
      'tone.negative': '负面',
      'tone.neutral': '中性',
      'tone.positive': '正面',

      'readout.allDays': '全部时段',
      'readout.daysShort': '{n} 天',
      'readout.allRegions': '全部区域',
      'readout.regionsCount': '{n}/{total} 区域',
      'readout.countryCount': '{n} 个国家',
      'readout.countryCountOne': '1 个国家',
      'readout.allTones': '全部情感',
      'readout.tonesCount': '{n}/3 种',
      'readout.toneAll': '全部',
      'readout.toneCount': '{n}/3',
      'readout.minPrefix': '≥ {n}',
      'readout.minCountSuffix': '+',
      'readout.timeWindow': '{days} 天，{start} 至 {end}',
      'readout.timeWindowSingular': '1 天，{start}',
      'readout.timePresetAll': '21 天',

      'tier.extremePositive': '极度正面',
      'tier.close': '亲近',
      'tier.baseline': '基线',
      'tier.far': '疏远',
      'tier.veryFar': '极度疏远',

      'bloc.africa': '非洲',
      'bloc.anglosphere': '英语圈',
      'bloc.asia_pacific': '亚太',
      'bloc.central_asia': '中亚',
      'bloc.europe_other': '其他欧洲',
      'bloc.european_union': '欧盟',
      'bloc.latin_america': '拉美',
      'bloc.middle_east': '中东',
      'bloc.north_america': '北美',
      'bloc.russia_sphere': '俄罗斯影响圈',
      'bloc.south_asia': '南亚',

      'about.body': ABOUT_BODY_EN,

      'about.question.heading': '研究问题',
      'about.question.body': `
        本可视化研究的是：世界各国新闻媒体如何谈论彼此，即哪些国家报道哪些国家、报道的情感倾向是冷是暖，以及这些模式在不同主题与时间窗口下如何变化。我们没有把全部数据压缩进单一问题，而是把同一份数据集通过三种相互协同的视图呈现，让不同的子问题自然浮现：
        <ul>
          <li><strong>新闻从哪里来？</strong>地理视图把各国的报道量映射成三维地形，报道密集的区域形成山脉，新闻沉寂的区域则呈现为低平的平原。</li>
          <li><strong>媒体话语中谁是天然盟友，谁是对手？</strong>重组视图剥离地理位置，按相互的情感亲和度重新摆放各国，从而显现出外交与编辑层面的"邻里圈"。</li>
          <li><strong>世界如何看待 X 国，又与如何看待 Y 国有何不同？</strong>UP/DOWN 视图把两个焦点国上下分置，其他各国按对焦点的有向情感呈放射状排列。</li>
        </ul>
        21 天的数据窗口跨越三段精心挑选、主题各异的新闻周期：2025 年 10 月底（美国大选周期）、2026 年 2 月底（米兰-科尔蒂纳冬季奥运会）以及 2026 年 4 月中（一段科技新闻周期）。
      `,

      'about.rationale.heading': '设计依据',
      'about.rationale.body': `
        <h4>编码</h4>
        <p>底层编码采用的是连续的 3D 高程场，而不是按国家分块的等值图或柱状挤出。选择高程场，是因为多个国家的报道量在区域内会自然叠加形成连续的强度变化（西欧形成山脊，海湾地区形成小型高原），而非互相割裂的方块。顶点颜色和小尺度位移噪声共同冗余编码了情感倾向：即使在低视角下，或对于色觉受限的读者，负面区域也会以"粗糙的轮廓线"呈现。</p>
        <p>曾考虑但被放弃的方案：</p>
        <ul>
          <li><em>平面 2D 等值图。</em>实现更简单，但少了一个信息维度；报道量只能放在另一张图里展现。</li>
          <li><em>按国家挤出的 3D 柱体（地图上的柱状图）。</em>单国读数更清晰，但呈现为互相竞争的方块，丧失了区域山脊的整体感。</li>
          <li><em>河流图或时序堆叠柱状图。</em>适合读趋势，但无法显示地理结构。</li>
          <li><em>地球投影（球面）。</em>美观，但会破坏模式 II 的力导向布局与模式 III 的放射状布局，这两者都依赖平面坐标。</li>
        </ul>

        <h4>交互</h4>
        <p>课程要求把 NameVoyager 列为典范：用一个聚焦的交互揭示数据集的全部结构。在本项目里，对应的核心交互是在同一份数据的三种协同视图之间切换。每种视图回答一个不同的问题，切换本身则给读者一种"动觉"，亲眼看见数据在不同问题下如何重新组织。对比模式则在此基础上叠加一束从参考国发出的扇形线，线条亮度结合了亲和度的强弱与文章量的多寡，以便高置信度的关系从基线噪声中凸显。</p>
        <p>五条筛选轴（主题、时间窗口、按区域或按国家筛选报道国、情感倾向、最低文章数）可以自由组合；筛选条件变化时，高程场会在约 340 毫秒内平滑过渡。鼠标悬停按需显示工具提示，点击则打开按国家的详情模态框，其中包含 4 个 KPI 与 3 张 SVG 图表。</p>

        <h4>砍掉的功能</h4>
        <p>我们曾考虑加入并排小图（每个主题一张图）、可刷选的时间区间小图，以及随时间播放的动画。这些功能最终全部被砍掉，原因是它们会稀释"模式切换"这一核心交互，而后者正是作业要求明确鼓励的、相较于功能繁杂的仪表盘更值得做好的方向。</p>

        <h4>决策准则</h4>
        <p>每一处选择的判定准则只有一条：这个编码或交互到底是在帮助读者建立对跨国媒体情感的准确直觉，还是只是看起来炫酷？只在视觉上得分（更花哨的纹理、更高饱和度的配色、粒子动效）的方案，即便实现起来很容易，也一律放弃。</p>
      `,

      'about.data.heading': '数据与来源',
      'about.data.body': `
        <p><strong>来源。</strong>GDELT 2.0 全球知识图谱，每 4 小时采样一次（每天 6 份文件），覆盖三段主题各异的周期：2025 年 10 月底（美国大选周期）、2026 年 2 月底（米兰-科尔蒂纳冬季奥运会）以及 2026 年 4 月中（近期科技周期）。数据按 GDELT 项目的公开条款发布。</p>

        <p><strong>保留下来的数据集。</strong>经过国家归属与主题筛选后，最终保留 28,607 条流向记录，分布在 202 个可归属国家的报道方上：政治 19,024 条、科技 9,432 条、体育 151 条。</p>

        <p><strong>数据结构。</strong>每条流向记录形如 <code>(date, reporter, mentioned, domain, count, avg_tone, delta_tone)</code>。其中 <code>delta_tone</code> 是分析上的关键字段：它等于"该桶（同一 reporter, mentioned, domain, date 组合）下的平均情感值，减去同日、同主题下全球对同一被提及国的平均情感"，目的是把报道方自身的偏向，从底层事件本身的情感色彩里剥离出来。模式 II、模式 III 以及对比模式的叠加层，全部基于 <code>delta_tone</code>，而非原始 <code>avg_tone</code>。</p>

        <p><strong>文章级数据。</strong>每个报道方下情感最极端的前 100 篇文章另外保留，在国家详情模态框中展示，附带回源出版物的可点击链接。</p>

        <p><strong>外部依赖。</strong>WebGL 渲染与轨道控制器使用 <a href="https://threejs.org/" target="_blank" rel="noopener">Three.js</a>。没有框架，没有编译器，没有打包器。数据用纯 JSON。模态框里的图表用 SVG。字体使用 Google Fonts 的 Fraunces 与 JetBrains Mono。</p>
      `,

      'about.development.heading': '开发流程',
      'about.development.body': `
        <p><strong>最耗时的环节。</strong>大致按耗时长短排列：</p>
        <ul>
          <li><strong>高程场网格的构建。</strong>选定合适的按国家衰减函数、把各国边界多边形简化到约 80 个顶点、并调好影响半径以避免小国消失、大国独霸，构成本项目里最大的一块工作量。</li>
          <li><strong>UP/DOWN 多边形修复迭代。</strong>朴素的放射状放置会导致国家形状互相重叠、跨过窗格分隔线。最终采用 80 轮修复循环，配合手工调参（<code>BASELINE = 70</code>、<code>STEPS = 350</code>），调试过程缓慢且反复。</li>
          <li><strong>对比叠加层的亮度公式。</strong>当前公式 <code>max(|sym|/1.5, log(count+1)/4 * 0.6) * 0.75 + 0.25</code> 经过数稿迭代，直到低置信度的基线关系足够黯淡、视线能稳定先落在强信号上为止。</li>
          <li><strong>delta_tone 校正流水线。</strong>编写按桶汇总全球均值、再回填到各报道方记录的脚本，比预想耗时，主要因为 GDELT 原始 schema 需要数轮归一化处理。</li>
        </ul>

        <p><strong>最难的部分。</strong>把项目控制在一个收窄的功能集合里。许多看起来有前景的扩展（年份区间刷选、可刷的小图阵列、时间动画播放、音频提示）都先做了原型，再被刻意砍掉，因为每一个都会稀释作业要求明确鼓励的那个核心交互，模式切换。</p>
      `,

      'about.methodology.heading': '方法与局限',
      'about.methodology.body': `
        <p>本项目公开记录其局限。最重要的几条：</p>

        <h4>情感信号是有噪声的</h4>
        <p>GDELT 的情感信号混杂了语言层面的情感、话题本身的情感色彩，以及报道方的编辑立场。<code>delta_tone</code> 校正剥离了话题层面的基线，但无法剥离跨语言、跨媒体的行文风格差异。颜色应当被读作方向性的指示，而非精确的测量值。</p>

        <h4>报道方归属本身就有偏差</h4>
        <p>GDELT 记录里只有约 13% 通过了国家归属步骤（基于 URL 顶级域名，加上对 <code>.com</code>/<code>.org</code> 等通用域名的人工整理表）。保留下来的样本明显偏向英语圈、西方媒体。俄语、中文、阿拉伯语以及大量地区性媒体被系统性低估。本项目给出的结论，是关于"西方互联网视角下可见的新闻生态"的结论，而非关于全球媒体生态的结论。</p>

        <h4>体育覆盖偏薄</h4>
        <p>GDELT 的主题分类并未对体育内容做强标记。即使在冬奥周内，留下的体育条目也很有限（151 条，对比政治 19,024 条、科技 9,432 条）。请把体育视图作为趋势提示，而非完整画面。</p>

        <h4>数据窗口很短</h4>
        <p>仅加载 21 天，且选择标准是主题对比而非连续覆盖。任何时序趋势上的结论都应当保守。</p>

        <h4>地形跨境溢出（仅模式 I）</h4>
        <p>高程场是连续的，因此某一国的信号会轻微外溢到其实际领土之外的顶点。这是为换取可读地形而做的一处轻微地理失真。如果需要严格按国界呈现，可以关闭"地形"开关，只看底图。</p>

        <h4>每个顶点的数学（模式 I）</h4>
        <p>对于每个国家 C 和处于其影响范围内的每个顶点 V，贡献量为 <code>log(C.count + 1) &times; SCALE &times; falloff(distance(V, C), C.radius)</code>，其中 <code>falloff</code> 是一段平滑的余弦凸起，在国家质心处取最大、到达半径处衰减为零。所有贡献相加并设有上限，避免多国重叠区域出现失控的尖峰。</p>

        <h4>对称亲和度（模式 II）</h4>
        <p>对每对无序国家 {A, B}，对称亲和度为两方向 <code>delta_tone</code> 的按文章量加权平均。不存在双向报道的国家对会被丢弃，因此外围国家可能不带强连接地"漂浮"在布局边缘。</p>
      `,
    }
  };

  window.I18N = I18N;
  window.currentLang = 'en';

  window.t = function (key, vars) {
    let s = (I18N[window.currentLang] && I18N[window.currentLang][key]);
    if (s === undefined) s = I18N.en[key];
    if (s === undefined) return key;
    if (vars) {
      for (const k of Object.keys(vars)) {
        s = s.split('{' + k + '}').join(vars[k]);
      }
    }
    return s;
  };

  window.setLang = function (lang) {
    if (!I18N[lang]) return;
    window.currentLang = lang;
    document.documentElement.lang = lang;

    // HTML-injecting nodes can introduce nested data-i18n-html nodes
    // (e.g. about.body contains <p data-i18n-html="about.question.body">).
    // Loop until a pass injects no new content, up to a small cap.
    for (let pass = 0; pass < 4; pass++) {
      const htmlNodes = document.querySelectorAll('[data-i18n-html]');
      if (htmlNodes.length === 0) break;
      let changedAny = false;
      htmlNodes.forEach(el => {
        const key = el.getAttribute('data-i18n-html');
        const val = window.t(key);
        if (el.innerHTML !== val) {
          el.innerHTML = val;
          changedAny = true;
        }
      });
      if (!changedAny) break;
    }
    document.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = window.t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-attr]').forEach(el => {
      const pairs = el.getAttribute('data-i18n-attr').split(',');
      for (const pair of pairs) {
        const [attr, key] = pair.split(':').map(s => s.trim());
        if (attr && key) el.setAttribute(attr, window.t(key));
      }
    });

    document.querySelectorAll('.lang-switch button').forEach(b => {
      b.classList.toggle('active', b.dataset.lang === lang);
    });

    window.dispatchEvent(new CustomEvent('i18n:change', { detail: { lang } }));
  };

  window.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.lang-switch button').forEach(btn => {
      btn.addEventListener('click', () => window.setLang(btn.dataset.lang));
    });
    window.setLang(window.currentLang);
  });

})();
