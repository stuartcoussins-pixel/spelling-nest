/**
 * Loads blog posts that live in the repository itself (content/blog/<slug>.json),
 * so approved posts can be published without going through HeyCatch.
 *
 * Each file holds one post:
 *   slug, title, meta_description, published_at (ISO), updated_at (ISO), read_time (minutes),
 *   language, keywords[], content_html, jsonLd (optional), status ("published" by default)
 *
 * A post dated in the future is skipped until its time arrives (the scheduled build picks it up).
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export async function loadNativePosts(srcDir, warn = () => {}) {
  const dir = path.join(srcDir, 'content', 'blog');
  let names = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const n of names.filter((f) => f.endsWith('.json')).sort()) {
    try {
      const a = JSON.parse(await readFile(path.join(dir, n), 'utf8'));
      if (!a || typeof a !== 'object') continue;
      if (a.status && a.status !== 'published') continue;
      if (!SLUG.test(String(a.slug || '')) || !a.title || !a.content_html) {
        warn(`Skipping content/blog/${n}: needs slug, title and content_html`);
        continue;
      }
      const when = new Date(a.published_at || a.published || 0).getTime();
      if (when && when > Date.now()) continue;
      out.push({ ...a, _native: true });
    } catch (e) {
      warn(`Skipping content/blog/${n}: ${e.message}`);
    }
  }
  return out;
}
