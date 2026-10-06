# SEO and GEO plugin research

Verified external requirements for search discovery, Markdown alternatives, sitemaps, and structured data, checked on **2026-10-05**.

SEO and GEO tooling exposes published content and descriptive metadata to crawlers and agents. The sources below establish technical eligibility and interoperability; they do not establish guaranteed ranking, indexing, or AI citations. This is an external requirements reference, not a description of an implemented Instatic plugin.

---

## TL;DR

- Google AI Overviews and AI Mode use ordinary Search eligibility: indexed pages eligible for snippets. No special AI schema or machine-readable file is required. [Google AI features](https://developers.google.com/search/docs/appearance/ai-features)
- Google explicitly ignores `llms.txt` for visibility and rankings. Markdown alternatives can serve agents and export workflows, but are not a Google ranking feature. [Google AI optimization guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)
- Sitemaps list absolute canonical URLs and use accurate significant-change dates. Google ignores `priority` and `changefreq`. [Google sitemap guide](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- JSON-LD describes the visible page truthfully. Schema.org validity and eligibility for a particular engine's rich results are different checks. [Google structured data policies](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)
- `FAQPage` remains a Schema.org type, but Google stopped displaying FAQ rich results on **May 7, 2026**. [Schema.org FAQPage](https://schema.org/FAQPage), [Google documentation updates](https://developers.google.com/search/updates)
- OpenAI search access and training access have independent crawler controls. [Official OpenAI crawler documentation](https://developers.openai.com/api/docs/bots)
- IndexNow notifies participating engines about changes; successful submission is not guaranteed crawling or indexing. [IndexNow protocol](https://www.indexnow.org/documentation), [Bing setup and limitations](https://www2.bing.com/indexnow/getstarted)

## Supported discovery practices

Google requires crawlable, indexable content with snippet eligibility for supporting links in its AI features. Important content in text, useful internal links, page experience, and metadata consistent with visible content remain relevant. Robots and infrastructure access affect discovery; Google does not guarantee crawling, indexing, or serving eligible pages. [Google AI features](https://developers.google.com/search/docs/appearance/ai-features)

Google's AI optimization guidance emphasizes original, useful, expert-led content. It rejects a requirement for special Markdown, AI files, special schema, fixed content lengths, or artificial content chunking. `llms.txt` neither helps nor harms Google visibility because Google Search ignores it. [Google AI optimization guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)

**Implementation inference:** use technical readiness and export completeness as plugin acceptance criteria. Evaluate visibility from real search and citation measurements rather than inventing an engine-wide “GEO ranking score.” Technical tooling cannot supply the originality, expertise, or factual quality of the underlying content.

## Sitemap and canonical requirements

Publish UTF-8 XML with escaped values and fully qualified canonical URLs, preferably at the site root. Split beyond 50,000 URLs or 50 MB uncompressed and expose a sitemap index. `lastmod` reflects a significant change to content, structured data, or links; regenerating files or changing a copyright date does not justify resetting it. Omit `priority` and `changefreq` for Google because Google ignores them. [Google sitemap guide](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)

Canonical annotations are signals, not commands. Redirects and `rel="canonical"` are stronger signals than sitemap inclusion. Avoid contradictory canonical destinations across annotations, sitemaps, and internal links. Google supports an HTTP `Link` header for canonicalizing non-HTML documents. [Google canonicalization guide](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)

**Implementation inference:** derive sitemap entries from the actual public route inventory, including concrete collection-detail URLs. Exclude unpublished, private, redirected, removed, and intentionally non-indexable pages from the discovery sitemap. Treat each Markdown representation as an alternative of its HTML page and use an HTTP canonical header pointing to that HTML URL; do not add redundant Markdown alternatives to the normal sitemap.

## Structured data requirements

Google recommends JSON-LD. Markup belongs on the page it describes, represents the main visible content, uses the most specific applicable type, and supplies the required properties of the chosen search feature. Misleading or invisible content can prevent rich-result eligibility. Valid markup does not guarantee a rich result. Link related entities with stable `@id` values where useful. [Google structured data policies](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)

| Content | Vocabulary and engine guidance | Practical constraint |
| --- | --- | --- |
| Articles | [`Article`](https://schema.org/Article), `BlogPosting`, `NewsArticle`; [Google Article guide](https://developers.google.com/search/docs/appearance/structured-data/article) | Use article types for actual articles. Google recommends applicable headline, author identity/URL, representative crawlable images, and truthful publication/modification dates; its guide lists no required Article properties. |
| Breadcrumbs | [`BreadcrumbList`](https://schema.org/BreadcrumbList); [Google breadcrumb guide](https://developers.google.com/search/docs/appearance/structured-data/breadcrumb) | Google's eligible list has at least two `ListItem` entries, ordered positions, names, and item URLs except the final item may omit its URL. Reflect the typical user navigation path rather than mechanically splitting a URL. Google currently displays this feature on desktop. |
| FAQs | [`FAQPage`](https://schema.org/FAQPage), [`Question`](https://schema.org/Question), [`Answer`](https://schema.org/Answer) | Describe genuine published questions and answers. Schema.org still defines these types. Google discontinued the FAQ rich result on May 7, 2026 and removed its guide in June; do not promise an FAQ search enhancement. [Google updates](https://developers.google.com/search/updates) |
| Site, page, publisher | [`WebSite`](https://schema.org/WebSite), [`WebPage`](https://schema.org/WebPage), [`Organization`](https://schema.org/Organization) | These vocabulary types describe corresponding entities. Their existence does not imply that every property produces a search feature. |

**Implementation inference:** content models and explicit field mappings select schema types. Never infer factual authors, dates, FAQs, business details, prices, or reviews from guesses. Add specialized business/product/video types only when the content actually supplies their facts and the relevant engine's feature guidance is checked.

## Search crawler controls

| Agent | Official purpose | Consequence for a plugin |
| --- | --- | --- |
| Googlebot | Crawls for Search, including AI search features. `noindex` and snippet controls affect inclusion and presentation. [Google AI features](https://developers.google.com/search/docs/appearance/ai-features) | Check access and preview directives on HTML and alternatives. |
| OAI-SearchBot | OpenAI's automatic search crawler. OpenAI recommends allowing it and published IP ranges for ChatGPT search; opting out prevents search-answer inclusion while navigational links may remain. [OpenAI crawler docs](https://developers.openai.com/api/docs/bots) | Offer an explicit search-access policy and explain infrastructure/WAF access requirements. |
| GPTBot | Crawls content that may be used to train OpenAI foundation models; its setting is independent of OAI-SearchBot. [OpenAI crawler docs](https://developers.openai.com/api/docs/bots) | Keep training preference separate from search preference. |
| ChatGPT-User | Performs certain user-requested visits, not automatic search crawling; robots rules may not apply. It does not determine Search inclusion. [OpenAI crawler docs](https://developers.openai.com/api/docs/bots) | Do not present its robots setting as a search eligibility control. |

**Implementation inference:** crawler policy is engine-specific. A single “allow AI” switch obscures different search and training purposes. Publishing a Markdown mirror does not override the original page's confidentiality or exclusion policy.

## Markdown and llms.txt status

The author-owned [`llms.txt` proposal](https://llmstxt.org/) remains a proposal. Its current v2 page, modified August 10, 2026, describes a concise Markdown index linking to detailed Markdown pages, optionally scoped to a subpath. It proposes page Markdown alternatives and discovery through `rel="alternate" type="text/markdown"` and `rel="describedby"` links, in HTML or HTTP headers. This source establishes the proposed format, not universal adoption by search engines.

**Implementation inference:** Markdown and `llms.txt` are useful interoperability features with optional enablement. Preserve headings, links, lists, tables, code, image descriptions, and source URLs from published content. Keep HTML as the complete search-facing representation. Do not advertise Markdown or `llms.txt` as a requirement for Google AI visibility. [Google AI optimization guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)

## IndexNow and measurement

IndexNow submits added, changed, and deleted URLs to participating engines, verifies host ownership through a hosted key file, and accepts up to 10,000 URLs per POST. A `200` confirms receipt only. [IndexNow documentation](https://www.indexnow.org/documentation)

Bing recommends notifying changes as they happen. IndexNow does not guarantee crawling or indexing, and Bing's setup guidance says not to submit historic changes made before adoption. [Bing IndexNow guide](https://www2.bing.com/indexnow/getstarted)

Bing's AI Performance public preview reports citations, cited pages, sampled grounding queries, and trends across supported surfaces; it explicitly distinguishes these from ranking, authority, or placement. Its guidance supports clear headings, tables, FAQs, evidence, accurate updates, and consistent entity information. [Bing AI Performance announcement](https://blogs.bing.com/webmaster/2026/2/Introducing-AI-Performance-in-Bing-Webmaster-Tools-Public-Preview/)

**Implementation inference:** use post-publish URL changes for optional, permission-controlled IndexNow notifications. Report submission success separately from indexing and citation outcomes. Validate JSON-LD with Schema.org's validator and Google's Rich Results Test, then inspect the live indexed HTML and sitemap in engine webmaster tools.

## Forbidden claims and patterns

- Guaranteed rankings, guaranteed AI citations, or compatibility guarantees for every AI search engine.
- Describing `llms.txt` as a Google ranking signal or an accepted universal crawler standard.
- Describing FAQ markup as eligible for a current Google FAQ rich result.
- Fabricating structured data facts or generating FAQ markup for answers absent from the public page.
- Resetting every page's `lastmod` on each publish, or using a successful IndexNow response as proof of indexing.
- Publishing draft/private content through Markdown, exports, or discovery files.

## Related

- [`../features/plugin-system.md`](../features/plugin-system.md) — existing Instatic plugin lifecycle, ZIP packaging, and granted permissions.
- [`../features/publisher.md`](../features/publisher.md) — published routing and static/dynamic rendering.
- [`../CONVENTIONS.md`](../CONVENTIONS.md) — documentation format.
- External source-of-truth documents are linked beside their claims; this reference defines no Instatic API or new architecture gate.
