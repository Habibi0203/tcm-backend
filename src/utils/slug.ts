import slugify from 'slugify';
import { nanoid } from 'nanoid';

export function toSlug(input: string): string {
  return slugify(input, { lower: true, strict: true, trim: true }).slice(0, 500);
}

export async function uniqueSlug(
  base: string,
  exists: (slug: string) => Promise<boolean>,
): Promise<string> {
  const root = toSlug(base) || 'artikel';
  if (!(await exists(root))) return root;
  // Ada collision — tambahkan suffix nanoid pendek.
  for (let i = 0; i < 5; i++) {
    const candidate = `${root}-${nanoid(6).toLowerCase()}`;
    if (!(await exists(candidate))) return candidate;
  }
  return `${root}-${nanoid(10).toLowerCase()}`;
}

export function wordCount(text: string): number {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function estimateReadMinutes(text: string): number {
  return Math.max(1, Math.ceil(wordCount(text) / 200));
}

export function firstNWords(text: string, n: number): string {
  if (!text) return '';
  const parts = text.trim().split(/\s+/);
  return parts.slice(0, n).join(' ');
}
