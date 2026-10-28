#!/usr/bin/env node
/**
 * Spelling Nest blog generator.
 *
 * Copies the static site into an output folder, then fetches published articles from
 * the HeyCatch API and writes real HTML pages for /blog/, /blog/page/N/ and /blog/<slug>/
 * using the same shell (header, footer, styles) as the rest of the site.
 *
 * Usage:   node scripts/build-blog.mjs [--src <dir>] [--out <dir>] [--cache <dir>]
 * Env:     HEYCATCH_API_KEY   publishable key (hck_lv_...). Never printed in logs.
 *          SITE_ORIGIN        production origin, default https://spellingnest.co.uk
 *          HEYCATCH_API_BASE  default https://api.heycatch.ai/v1 (override for tests)
 *
 * The script never fails the build. On any API problem it falls back to the last
 * good article data held in the cache folder, or to the empty state.
 */
import { readFile, writeFile, mkdir, cp, readdir, rm, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import sanitizeHtml from 'sanitize-html';

// ---------------------------------------------------------------- configuration

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
const SRC = path.resolve(args.src || path.join(HERE, '..'));
const OUT = path.resolve(args.out || path.join(SRC, '_site'));
const CACHE = path.resolve(args.cache || path.join(SRC, '.blog-cache'));

const API_BASE = (process.env.HEYCATCH_API_BASE || 'https://api.heycatch.ai/v1').replace(/\/+$/, '');
const API_KEY = (process.env.HEYCATCH_API_KEY || '').trim();
const ORIGIN = (process.env.SITE_ORIGIN || 'https://spellingnest.co.uk').replace(/\/+$/, '');

const SITE_NAME = 'Spelling Nest';
const SITE_LANG = 'en-GB';
const PER_PAGE = 12;
const RTL_LANGS = new Set(['ar', 'he', 'fa', 'ur']);
const DEFAULT_SOCIAL_IMAGE = `${ORIGIN}/assets/social.png`;

// Copy shown on the blog index. Edit freely.
const BLOG_TITLE = 'The Spelling Nest blog';
const BLOG_DESCRIPTION = 'Articles on helping primary school children learn their weekly spellings at home.';
const BLOG_LEAD = 'Articles on helping primary school children learn their weekly spellings at home.';
const BLOG_EMPTY = 'New articles are on their way. Please check back soon.';

// Top level folders and files that are tooling, not part of the published site.
const EXCLUDE_TOP = new Set([
  '.git', '.github', '.gitignore', 'scripts', 'node_modules', '_site', '.blog-cache',
  'package.json', 'package-lock.json',
]);

// ---------------------------------------------------------------- small helpers

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const log = (m) => console.log(`[blog] ${m}`);
const warn = (m) => console.log(`::warning::[blog] ${m}`);

function fmtDate(v) {
  const d = new Date(v);
  if (!v || Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
function isoDate(v) {
  const d = new Date(v);
  return !v || Number.isNaN(d.getTime()) ? '' : d.toISOString();
}
function dateOnly(v) {
  const i = isoDate(v);
  return i ? i.slice(0, 10) : '';
}
function readTime(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number' || /^\d+$/.test(String(v).trim())) return `${Number(v)} min read`;
  return String(v);
}
function httpsUrl(v) {
  if (typeof v !== 'string') return '';
  const t = v.trim();
  return /^https:\/\//i.test(t) ? t : '';
}
const publishedOf = (a) => a.published_at || a.published || '';
const updatedOf = (a) => a.updated_at || a.updated || publishedOf(a);
const imageOf = (a) => httpsUrl(a.featured_image) || httpsUrl(a.hero_image_url);
const validSlug = (s) => typeof s === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(s) && s !== 'page';

// ---------------------------------------------------------------- HeyCatch API

async function apiGet(route, retried = false) {
  const sep = route.includes('?') ? '&' : '?';
  const url = `${API_BASE}${route}${sep}key=${encodeURIComponent(API_KEY)}`; // key only as a query parameter, no headers
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (res.status === 429 && !retried) {
      const wait = Math.min(Math.max(Number(res.headers.get('retry-after')) || 2, 1), 30);
      log(`rate limited, waiting ${wait}s before one retry`);
      await sleep(wait * 1000);
      return apiGet(route, true);
    }
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, status: res.status, data: await res.json() };
  } catch (e) {
    return { ok: false, status: 0, error: e?.name || 'error' };
  } finally {
    clearTimeout(timer);
  }
}

/** Returns { state: 'ok' | 'forbidden' | 'failed', list: [...] } */
async function fetchList() {
  if (!API_KEY) {
    warn('HEYCATCH_API_KEY is not set. Building the blog with its empty state.');
    return { state: 'failed', list: [] };
  }
  const all = [];
  let offset = 0;
  let total = Infinity;
  for (let guard = 0; guard < 100 && offset < total; guard++) {
    const r = await apiGet(`/articles?limit=50&offset=${offset}`);
    if (!r.ok) {
      if (r.status === 403) return { state: 'forbidden', list: [] };
      if (r.status === 401) warn('HeyCatch returned 401. Check that HEYCATCH_API_KEY holds the hck_lv_ key.');
      else warn(`HeyCatch list request failed (status ${r.status || r.error}).`);
      return { state: 'failed', list: [] };
    }
    const items = Array.isArray(r.data?.articles) ? r.data.articles : [];
    total = Number.isFinite(Number(r.data?.total)) ? Number(r.data.total) : items.length;
    all.push(...items);
    if (items.length === 0) break;
    offset += 50;
  }
  return { state: 'ok', list: all };
}

async function fetchArticle(summary) {
  const r = await apiGet(`/articles/${encodeURIComponent(summary.slug)}`);
  if (r.ok && r.data?.article) return { article: r.data.article };
  return { article: null, status: r.status };
}

async function pool(items, size, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }));
  return results;
}

// ---------------------------------------------------------------- cache (last good data)

const CACHE_FILE = path.join(CACHE, 'articles.json');
const FINGERPRINT_FILE = path.join(CACHE, 'fingerprint.txt');

async function readCache() {
  try {
    const parsed = JSON.parse(await readFile(CACHE_FILE, 'utf8'));
    return Array.isArray(parsed.articles) ? parsed.articles : [];
  } catch {
    return [];
  }
}
async function writeCache(articles) {
  await mkdir(CACHE, { recursive: true });
  const slim = articles.map(({ content_markdown, ...rest }) => rest);
  await writeFile(CACHE_FILE, JSON.stringify({ savedAt: new Date().toISOString(), articles: slim }));
}

// ---------------------------------------------------------------- content processing

function sanitiseArticleHtml(html) {
  return sanitizeHtml(String(html || ''), {
    allowedTags: ['h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
      'a', 'blockquote', 'strong', 'b', 'em', 'i', 'code', 'pre', 'br', 'hr', 'sup', 'sub'],
    allowedAttributes: {
      a: ['href', 'title', 'rel'],
      h2: ['id'],
      h3: ['id'],
      th: ['colspan', 'rowspan', 'scope'],
      td: ['colspan', 'rowspan'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    transformTags: {
      a: (tagName, attribs) => {
        const href = attribs.href || '';
        const external = /^https?:\/\//i.test(href) && !href.toLowerCase().startsWith(ORIGIN.toLowerCase());
        return { tagName: 'a', attribs: external ? { ...attribs, rel: 'noopener noreferrer' } : attribs };
      },
      h2: (tagName, attribs) => ({ tagName, attribs: safeId(attribs) }),
      h3: (tagName, attribs) => ({ tagName, attribs: safeId(attribs) }),
    },
  });
}
function safeId(attribs) {
  if (attribs.id && !/^[A-Za-z][A-Za-z0-9_:.-]*$/.test(attribs.id)) {
    const { id, ...rest } = attribs;
    return rest;
  }
  return attribs;
}

/** Table of contents from the sanitised HTML. Never changes an id. Skips id="faq". */
function buildToc(cleanHtml) {
  const items = [];
  const re = /<h2\b[^>]*\sid="([^"]+)"[^>]*>([\s\S]*?)<\/h2>/gi;
  let m;
  while ((m = re.exec(cleanHtml))) {
    if (m[1] === 'faq') continue;
    const text = m[2].replace(/<[^>]*>/g, '').trim();
    if (text) items.push({ id: m[1], text });
  }
  if (items.length < 2) return '';
  const lis = items.map((i) => `<li><a href="#${esc(i.id)}">${i.text}</a></li>`).join('');
  return `<nav class="toc" aria-label="In this article"><p class="eyebrow">In this article</p><ol>${lis}</ol></nav>`;
}

/** Puts the table of contents after the Key takeaways list, or above the content if there is none. */
function withToc(cleanHtml) {
  const toc = buildToc(cleanHtml);
  if (!toc) return cleanHtml;
  const at = cleanHtml.search(/key takeaways/i);
  if (at >= 0) {
    const rest = cleanHtml.slice(at);
    const close = rest.search(/<\/(ul|ol)>/i);
    if (close >= 0) {
      const end = at + close + 5;
      return cleanHtml.slice(0, end) + toc + cleanHtml.slice(end);
    }
  }
  return toc + cleanHtml;
}

function jsonLdFor(article, canonical) {
  let ld = article.jsonLd ?? article.json_ld;
  if (!ld) return '';
  if (typeof ld === 'string') {
    try { ld = JSON.parse(ld); } catch { return ''; }
  }
  if (!ld || typeof ld !== 'object' || Object.keys(ld).length === 0) return '';
  const fill = (o) => {
    if (!o || typeof o !== 'object') return;
    if (!o.url) o.url = canonical;
    if (!o.mainEntityOfPage) o.mainEntityOfPage = canonical;
  };
  const isArticle = (o) => [].concat(o?.['@type'] || []).some((t) => /Article|BlogPosting/i.test(String(t)));
  if (Array.isArray(ld)) ld.filter(isArticle).forEach(fill);
  else if (Array.isArray(ld['@graph'])) ld['@graph'].filter(isArticle).forEach(fill);
  else fill(ld);
  return `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`;
}

// ---------------------------------------------------------------- templates

const BLOG_CSS = `
.post-wrap{max-width:760px}
.blog-grid{display:grid;gap:18px;grid-template-columns:1fr}
@media(min-width:760px){.blog-grid{grid-template-columns:repeat(2,1fr)}}
@media(min-width:1000px){.blog-grid{grid-template-columns:repeat(3,1fr)}}
a.post-card{display:flex;flex-direction:column;padding:0;overflow:hidden;text-decoration:none;color:inherit;transition:transform .12s ease}
a.post-card:hover{transform:translateY(-2px)}
a.post-card:hover h2{text-decoration:underline;text-decoration-color:var(--pink-deep);text-decoration-thickness:2px;text-underline-offset:3px}
.post-card .thumb{aspect-ratio:16/9;object-fit:cover;width:100%;background:var(--surface-2)}
.post-card .body{padding:20px 22px 22px;display:flex;flex-direction:column;gap:8px}
.post-card h2{font-size:1.2rem;letter-spacing:-.01em}
.post-meta{color:var(--ink-soft);font-size:.94rem;font-weight:600}
.blog-empty{max-width:48ch;margin:0 auto;text-align:center;color:var(--ink-soft)}
.pager{display:flex;justify-content:space-between;gap:12px;margin-top:36px}
.pager .btn.ghost{min-width:110px}
.post-hero .eyebrow a{text-decoration:none}
.post-hero h1{margin:10px 0 14px}
.post-hero-img{margin-top:26px;width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:var(--radius);box-shadow:var(--shadow)}
.post-body{padding-top:0}
.prose{font-size:1.06rem;line-height:1.7}
.prose h2{font-size:clamp(1.45rem,3.4vw,1.9rem);margin:2.2em 0 .6em;scroll-margin-top:84px}
.prose h3{font-size:1.2rem;margin:1.8em 0 .5em;scroll-margin-top:84px}
.prose h4{font-size:1.05rem;margin:1.5em 0 .4em}
.prose p,.prose ul,.prose ol,.prose table,.prose blockquote,.prose pre{margin:0 0 1.15em}
.prose ul,.prose ol{padding-left:1.3em}
.prose li{margin:.35em 0}
.prose a{color:var(--ink);text-decoration-color:var(--pink-deep);text-decoration-thickness:2px;text-underline-offset:3px}
.prose blockquote{border-left:4px solid var(--pink);padding:4px 0 4px 18px;color:var(--ink-soft)}
.prose table{display:block;width:100%;overflow-x:auto;border-collapse:collapse}
.prose th,.prose td{border:1px solid var(--line);padding:10px 12px;text-align:left;vertical-align:top}
.prose th{background:var(--surface-2)}
.prose code{background:var(--surface-2);padding:.1em .35em;border-radius:6px;font-size:.92em}
.prose pre{overflow-x:auto;background:var(--surface-2);padding:14px;border-radius:12px}
.prose pre code{background:none;padding:0}
.prose hr{border:0;border-top:1px solid var(--line);margin:2em 0}
.toc{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:20px 24px;margin:1.6em 0;box-shadow:var(--shadow)}
.toc .eyebrow{margin-bottom:8px}
.toc ol{margin:0;padding-left:1.3em}
.toc li{margin:.4em 0}
.toc a{text-decoration:none;font-weight:600}
.toc a:hover{text-decoration:underline}
`;

let SHELL = '';

function renderPage({ head, jsonld = '', main, blogLinks }) {
  return SHELL
    .replace('{{HEAD}}', () => head)
    .replace('{{BLOG_CSS}}', () => BLOG_CSS)
    .replace('{{JSONLD}}', () => jsonld)
    .replace('{{BLOG_NAV}}', () => (blogLinks ? '\n      <a href="/blog/">Blog</a>' : ''))
    .replace('{{BLOG_FOOT}}', () => (blogLinks ? '\n          <li><a href="/blog/">Blog</a></li>' : ''))
    .replace('{{MAIN}}', () => main);
}

function headTags({ title, description, canonical, ogType = 'website', image = DEFAULT_SOCIAL_IMAGE, extra = '' }) {
  const t = esc(title);
  const d = esc(description);
  return [
    `<title>${t}</title>`,
    `<meta name="description" content="${d}">`,
    `<link rel="canonical" href="${esc(canonical)}">`,
    `<meta property="og:type" content="${ogType}">`,
    `<meta property="og:site_name" content="${SITE_NAME}">`,
    `<meta property="og:title" content="${esc(title.replace(` · ${SITE_NAME}`, ''))}">`,
    `<meta property="og:description" content="${d}">`,
    `<meta property="og:url" content="${esc(canonical)}">`,
    `<meta property="og:image" content="${esc(image)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:description" content="${d}">`,
    extra,
  ].filter(Boolean).join('\n');
}

function ctaSection() {
  return `<section class="final">
  <div class="wrap">
    <h2>Practice that actually happens.</h2>
    <p class="lead">Add this week's list, hand over the tablet, and see what has stuck before the test rather than after it. Alongside writing the words out by hand, not instead of it.</p>
    <div class="cta-row"><a class="btn pink" href="/app">Open Spelling Nest</a></div>
  </div>
</section>`;
}

function cardHtml(a) {
  const img = imageOf(a);
  const meta = [fmtDate(publishedOf(a)), readTime(a.read_time)].filter(Boolean).join(' · ');
  return `<a class="card post-card" href="/blog/${encodeURIComponent(a.slug)}/">
  ${img ? `<img class="thumb" src="${esc(img)}" alt="" loading="lazy">` : ''}
  <span class="body"><h2>${esc(a.title)}</h2>${meta ? `<span class="post-meta">${esc(meta)}</span>` : ''}</span>
</a>`;
}

function pagerHtml(page, pages) {
  if (pages <= 1) return '';
  const href = (n) => (n === 1 ? '/blog/' : `/blog/page/${n}/`);
  const prev = page > 1 ? `<a class="btn ghost small" rel="prev" href="${href(page - 1)}">Newer</a>` : '<span></span>';
  const next = page < pages ? `<a class="btn ghost small" rel="next" href="${href(page + 1)}">Older</a>` : '<span></span>';
  return `<nav class="pager" aria-label="Blog pages">${prev}<span class="post-meta">Page ${page} of ${pages}</span>${next}</nav>`;
}

function indexPage(articles, page, pages) {
  const pageSlice = articles.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const canonical = page === 1 ? `${ORIGIN}/blog/` : `${ORIGIN}/blog/page/${page}/`;
  const title = `${BLOG_TITLE}${page > 1 ? `, page ${page}` : ''} · ${SITE_NAME}`;
  const empty = articles.length === 0;
  const body = empty
    ? `<p class="blog-empty">${esc(BLOG_EMPTY)}</p>`
    : `<div class="blog-grid">${pageSlice.map(cardHtml).join('\n')}</div>${pagerHtml(page, pages)}`;
  const main = `<section class="hero">
  <div class="wrap">
    <div class="head center">
      <p class="eyebrow">Blog</p>
      <h1>${esc(BLOG_TITLE)}</h1>
      <p class="lead">${esc(BLOG_LEAD)}</p>
    </div>
  </div>
</section>

<section>
  <div class="wrap">
    ${body}
  </div>
</section>`;
  return renderPage({
    head: headTags({ title, description: BLOG_DESCRIPTION, canonical, extra: empty ? '<meta name="robots" content="noindex">' : '' }),
    main,
    blogLinks: !empty,
  });
}

function postPage(a, blogLinks) {
  const canonical = `${ORIGIN}/blog/${encodeURIComponent(a.slug)}/`;
  const lang = typeof a.language === 'string' ? a.language.trim() : '';
  const base = lang.toLowerCase().split('-')[0];
  const langAttrs = lang && lang.toLowerCase() !== SITE_LANG.toLowerCase()
    ? ` lang="${esc(lang)}"${RTL_LANGS.has(base) ? ' dir="rtl"' : ''}`
    : '';
  const img = imageOf(a);
  const published = publishedOf(a);
  const meta = [fmtDate(published), readTime(a.read_time)].filter(Boolean);
  const metaHtml = meta.length
    ? `<p class="post-meta">${published && fmtDate(published) ? `<time datetime="${esc(isoDate(published))}">${esc(fmtDate(published))}</time>` : ''}${readTime(a.read_time) ? `${fmtDate(published) ? ' · ' : ''}${esc(readTime(a.read_time))}` : ''}</p>`
    : '';
  const content = withToc(sanitiseArticleHtml(a.content_html));
  const extra = [
    published ? `<meta property="article:published_time" content="${esc(isoDate(published))}">` : '',
    updatedOf(a) ? `<meta property="article:modified_time" content="${esc(isoDate(updatedOf(a)))}">` : '',
  ].filter(Boolean).join('\n');
  const main = `<article class="post"${langAttrs}>
<section class="hero post-hero">
  <div class="wrap post-wrap">
    <p class="eyebrow"><a href="/blog/">Blog</a></p>
    <h1>${esc(a.title)}</h1>
    ${metaHtml}
    ${img ? `<img class="post-hero-img" src="${esc(img)}" alt="" loading="eager">` : ''}
  </div>
</section>

<section class="post-body">
  <div class="wrap post-wrap">
    <div class="prose">
${content}
    </div>
  </div>
</section>
</article>

${ctaSection()}`;
  return renderPage({
    head: headTags({
      title: `${a.title} · ${SITE_NAME}`,
      description: a.meta_description || BLOG_DESCRIPTION,
      canonical,
      ogType: 'article',
      image: img || DEFAULT_SOCIAL_IMAGE,
      extra,
    }),
    jsonld: jsonLdFor(a, canonical),
    main,
    blogLinks,
  });
}

function notFoundPage(blogLinks) {
  const main = `<section class="hero">
  <div class="wrap">
    <div class="head center">
      <p class="eyebrow">404</p>
      <h1>That page has flown the nest</h1>
      <p class="lead">We could not find the page you were looking for.</p>
      <div class="cta-row" style="justify-content:center"><a class="btn" href="/">Back to the home page</a></div>
    </div>
  </div>
</section>`;
  return renderPage({
    head: headTags({ title: `Page not found · ${SITE_NAME}`, description: 'This page could not be found.', canonical: `${ORIGIN}/`, extra: '<meta name="robots" content="noindex">' }),
    main,
    blogLinks,
  });
}

// ---------------------------------------------------------------- site assembly

async function copySite() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  // Copy entry by entry: Node refuses to copy a folder into a subfolder of itself (OUT may sit inside SRC).
  for (const e of await readdir(SRC, { withFileTypes: true })) {
    if (EXCLUDE_TOP.has(e.name)) continue;
    await cp(path.join(SRC, e.name), path.join(OUT, e.name), { recursive: true });
  }
}

async function* htmlFiles(dir, rel = '') {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (r === 'app' || r === 'blog' || r === 'assets') continue;
      yield* htmlFiles(path.join(dir, e.name), r);
    } else if (e.name.endsWith('.html') && r !== 'admin.html' && r !== '404.html') {
      yield path.join(dir, e.name);
    }
  }
}

/** Adds a Blog link next to "Questions" in the header and footer of existing pages, when there are articles. */
async function injectBlogLinks() {
  let touched = 0;
  for await (const file of htmlFiles(OUT)) {
    let html = await readFile(file, 'utf8');
    if (html.includes('href="/blog/"')) continue;
    const next = html
      .replace('<a href="/faq/">Questions</a>\n    </nav>', '<a href="/faq/">Questions</a>\n      <a href="/blog/">Blog</a>\n    </nav>')
      .replace(/(\n\s*)<a href="\/faq\/">Questions<\/a>(\n\s*<\/nav>)/, '$1<a href="/faq/">Questions</a>$1<a href="/blog/">Blog</a>$2')
      .replace('<li><a href="/faq/">Questions</a></li>', '<li><a href="/faq/">Questions</a></li>\n          <li><a href="/blog/">Blog</a></li>');
    if (next !== html) {
      await writeFile(file, next);
      touched++;
    }
  }
  log(`Blog link added to ${touched} existing page(s)`);
}

async function updateSitemap(articles) {
  const file = path.join(OUT, 'sitemap.xml');
  let xml = existsSync(file)
    ? await readFile(file, 'utf8')
    : `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${ORIGIN}/</loc></url>\n</urlset>\n`;
  xml = xml.replace(/\s*<url><loc>[^<]*\/blog\/[^<]*<\/loc>[\s\S]*?<\/url>/g, '');
  if (articles.length) {
    const latest = articles.map((a) => dateOnly(updatedOf(a))).filter(Boolean).sort().pop();
    const rows = [
      `  <url><loc>${ORIGIN}/blog/</loc>${latest ? `<lastmod>${latest}</lastmod>` : ''}<changefreq>weekly</changefreq><priority>0.7</priority></url>`,
      ...articles.map((a) => {
        const lm = dateOnly(updatedOf(a));
        return `  <url><loc>${ORIGIN}/blog/${encodeURIComponent(a.slug)}/</loc>${lm ? `<lastmod>${lm}</lastmod>` : ''}<changefreq>monthly</changefreq><priority>0.6</priority></url>`;
      }),
    ];
    xml = xml.replace('</urlset>', `${rows.join('\n')}\n</urlset>`);
  }
  await writeFile(file, xml);
}

async function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

// ---------------------------------------------------------------- main

async function main() {
  SHELL = await readFile(path.join(HERE, 'blog-shell.html'), 'utf8');
  await copySite();

  const cached = await readCache();
  const cachedBySlug = new Map(cached.map((a) => [a.slug, a]));
  const { state, list } = await fetchList();

  let articles = [];
  let fresh = false;
  if (state === 'ok') {
    const summaries = list.filter((s) => {
      if (validSlug(s?.slug)) return true;
      warn(`Skipping an article with an unusable slug: ${JSON.stringify(s?.slug)}`);
      return false;
    });
    const results = await pool(summaries, 4, async (s) => {
      const r = await fetchArticle(s);
      if (r.article && validSlug(r.article.slug)) return { ...s, ...r.article };
      const old = cachedBySlug.get(s.slug);
      if (old) {
        warn(`Could not fetch "${s.slug}" (status ${r.status}). Using the last good copy.`);
        return old;
      }
      warn(`Could not fetch "${s.slug}" (status ${r.status}). Leaving it out of this build.`);
      return null;
    });
    articles = results.filter(Boolean);
    fresh = true;
  } else if (state === 'forbidden') {
    warn('HeyCatch returned 403. Showing the empty state. A revoked key needs a fresh prompt from HeyCatch.');
  } else if (cached.length) {
    warn(`Using ${cached.length} cached article(s) from the last good build.`);
    articles = cached;
  }

  articles = articles
    .filter((a) => a && a.title && validSlug(a.slug))
    .sort((x, y) => (new Date(publishedOf(y)).getTime() || 0) - (new Date(publishedOf(x)).getTime() || 0));

  const hasArticles = articles.length > 0;

  // Pages
  const pages = Math.max(1, Math.ceil(articles.length / PER_PAGE));
  const blogDir = path.join(OUT, 'blog');
  await mkdir(blogDir, { recursive: true });
  await writeFile(path.join(blogDir, 'index.html'), indexPage(articles, 1, pages));
  for (let p = 2; p <= pages; p++) {
    const d = path.join(blogDir, 'page', String(p));
    await mkdir(d, { recursive: true });
    await writeFile(path.join(d, 'index.html'), indexPage(articles, p, pages));
  }
  for (const a of articles) {
    const d = path.join(blogDir, a.slug);
    await mkdir(d, { recursive: true });
    await writeFile(path.join(d, 'index.html'), postPage(a, hasArticles));
  }
  if (!existsSync(path.join(OUT, '404.html'))) await writeFile(path.join(OUT, '404.html'), notFoundPage(hasArticles));

  if (hasArticles) await injectBlogLinks();
  await updateSitemap(articles);

  // Cache + change detection (used by the scheduled workflow to skip pointless deployments)
  const fingerprint = createHash('sha256').update(JSON.stringify(articles.map((a) => [a.slug, a.title, updatedOf(a), a.content_html]))).digest('hex');
  let previous = '';
  try { previous = (await readFile(FINGERPRINT_FILE, 'utf8')).trim(); } catch { /* first run */ }
  if (fresh) {
    await writeCache(articles);
    await writeFile(FINGERPRINT_FILE, fingerprint);
  }
  await setOutput('changed', fresh ? String(fingerprint !== previous) : 'false');
  await setOutput('articles', String(articles.length));
  log(`Built ${articles.length} article page(s), ${pages} index page(s) -> ${OUT}`);
}

main().catch(async (e) => {
  // Never fail the site build because of the blog.
  warn(`Blog generation hit an unexpected error: ${e?.message || e}`);
  try {
    if (!existsSync(OUT)) await copySite();
    await setOutput('changed', 'false');
  } catch { /* nothing more to do */ }
  process.exitCode = 0;
});
