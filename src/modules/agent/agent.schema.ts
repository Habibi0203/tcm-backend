import { z } from 'zod';

export const agentCreateArticleSchema = z.object({
  title:           z.string().min(5).max(500),
  excerpt:         z.string().max(500).optional(),
  content:         z.string().min(20),
  category_slug:   z.string().min(1),
  access_tier:     z.enum(['free', 'premium']).default('free'),
  thumbnail_url:   z.string().url().nullable().optional(),
  has_disclaimer:  z.boolean().optional(),
  tag_names:       z.array(z.string()).max(10).optional(),
  seo_title:       z.string().max(200).optional(),
  seo_description: z.string().max(500).optional(),
  status:          z.enum(['draft', 'review', 'published']).default('review'),
});
export type AgentCreateArticleInput = z.infer<typeof agentCreateArticleSchema>;

export const agentPatchArticleSchema = agentCreateArticleSchema.partial();

export const agentCreateThreadSchema = z.object({
  subforum_slug: z.string().min(1),
  title:         z.string().min(5).max(200),
  content:       z.string().min(10),
});

export const agentCreateReplySchema = z.object({
  thread_id:       z.string().uuid(),
  content:         z.string().min(1),
  parent_reply_id: z.string().uuid().nullable().optional(),
});

export const agentModerateSchema = z.object({
  entity_type: z.enum(['article', 'thread', 'reply']),
  entity_id:   z.string().uuid(),
  action:      z.enum(['approve', 'reject']),
  reason:      z.string().max(500).optional(),
});
