import { z } from 'zod';

export const listArticlesQuerySchema = z.object({
  q:             z.string().trim().max(200).optional(),
  category_slug: z.string().trim().max(120).optional(),
  access_tier:   z.enum(['free', 'premium']).optional(),
  sort:          z.enum(['newest', 'popular', 'trending']).default('newest'),
  page:          z.coerce.number().int().min(1).default(1),
  per_page:      z.coerce.number().int().min(1).max(50).default(10),
});
export type ListArticlesQuery = z.infer<typeof listArticlesQuerySchema>;

export const createArticleSchema = z.object({
  title:           z.string().min(5).max(500),
  excerpt:         z.string().max(500).optional(),
  content:         z.string().min(20),
  category_id:     z.string().uuid(),
  access_tier:     z.enum(['free', 'premium']).default('free'),
  thumbnail_url:   z.string().url().nullable().optional(),
  has_disclaimer:  z.boolean().optional(),
  tag_names:       z.array(z.string().min(1).max(60)).max(10).optional(),
  seo_title:       z.string().max(200).optional(),
  seo_description: z.string().max(500).optional(),
  status:          z.enum(['draft', 'review', 'published']).default('draft'),
});
export type CreateArticleInput = z.infer<typeof createArticleSchema>;

export const updateArticleSchema = createArticleSchema.partial();
export type UpdateArticleInput = z.infer<typeof updateArticleSchema>;

export const createCommentSchema = z.object({
  content:   z.string().min(1).max(2000),
  parent_id: z.string().uuid().nullable().optional(),
});
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
