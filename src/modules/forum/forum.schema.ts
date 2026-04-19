import { z } from 'zod';

export const listThreadsQuerySchema = z.object({
  sort:     z.enum(['latest_reply', 'newest', 'popular']).default('latest_reply'),
  page:     z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListThreadsQuery = z.infer<typeof listThreadsQuerySchema>;

export const createThreadSchema = z.object({
  title:   z.string().min(5).max(200),
  content: z.string().min(10),
});
export type CreateThreadInput = z.infer<typeof createThreadSchema>;

export const createReplySchema = z.object({
  content:         z.string().min(1),
  parent_reply_id: z.string().uuid().nullable().optional(),
});
export type CreateReplyInput = z.infer<typeof createReplySchema>;
