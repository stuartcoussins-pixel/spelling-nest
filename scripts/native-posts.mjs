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
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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

/**
 * Self hosts each post's hero image. A post may carry "hero_image_source" (an https URL where the
 * generated picture can be fetched once). The first build downloads it, shrinks it to a 1280 pixel
 * wide webp, and saves it as assets/blog/<slug>.webp in the repository (the workflow commits it), so
 * the page never depends on, or calls, a third party host. Posts then use /assets/blog/<slug>.webp.
 */
export async function prepareHeroImages(posts, srcDir, outDir, warn = () => {}) {
  const rel = (slug) => `assets/blog/${slug}.webp`;
  for (const a of posts) {
    if (!a._native) continue;
    const srcFile = path.join(srcDir, rel(a.slug));
    const outFile = path.join(outDir, rel(a.slug));
    try {
      if (!existsSync(srcFile)) {
        const url = String(a.hero_image_source || '');
        if (!/^(https:\/\/|http:\/\/127\.0\.0\.1[:/])/i.test(url)) continue; // plain http only for local tests
        const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const input = Buffer.from(await res.arrayBuffer());
        const { default: sharp } = await import('sharp');
        const webp = await sharp(input).resize({ width: 1280, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
        await mkdir(path.dirname(srcFile), { recursive: true });
        await writeFile(srcFile, webp);
        await mkdir(path.dirname(outFile), { recursive: true });
        await writeFile(outFile, webp);
      }
      a.hero_image_url = '/' + rel(a.slug);
    } catch (e) {
      warn(`Hero image for "${a.slug}" not prepared (${e.message}). Publishing without it.`);
    }
  }
}
