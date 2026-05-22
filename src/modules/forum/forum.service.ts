import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { subforums, forumThreads, forumReplies, forumReplyUpvotes, postingRateLimits, contentReports } from '../../db/schema/forum';
import { notifications } from '../../db/schema/system';
import { practitionerProfiles, users } from '../../db/schema/users';
import type { CreateThreadInput, ListThreadsQuery, CreateReportInput } from './forum.schema';


type ForumModerationStatus = 'published' | 'pending' | 'hidden' | 'deleted';

function forumModerationStatus(item: { is_deleted?: boolean | null; deleted_at?: Date | null; is_flagged?: boolean | null }): ForumModerationStatus {
  if (item.is_deleted) return item.deleted_at ? 'hidden' : 'deleted';
  if (item.is_flagged) return 'pending';
  return 'published';
}

const DANGEROUS_MEDICAL_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'klaim pasti sembuh', pattern: /\b(pasti|dijamin|100\s*%)\s+(sembuh|menyembuhkan|ampuh)\b/i },
  { label: 'stop terapi dokter', pattern: /\b(stop|hentikan|berhenti)\s+(obat|terapi|pengobatan|kemoterapi|insulin|antibiotik)\b/i },
  { label: 'klaim kanker berat', pattern: /\b(sembuh|menyembuhkan|obat)\s+(kanker|tumor|stroke|diabetes|gagal ginjal)\b/i },
  { label: 'tanpa efek samping absolut', pattern: /\b(tanpa efek samping|aman 100\s*%|pasti aman)\b/i },
  { label: 'anti dokter', pattern: /\b(tidak perlu|tak perlu)\s+(dokter|rumah sakit|medis)\b/i },
];

export function detectDangerousMedicalClaims(text: string) {
  const normalized = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return DANGEROUS_MEDICAL_PATTERNS
    .filter((item) => item.pattern.test(normalized))
    .map((item) => item.label);
}


export async function listSubforums() {
  const rows = await db
    .select()
    .from(subforums)
    .where(eq(subforums.is_active, true))
    .orderBy(subforums.sort_order);
  return rows.map(r => ({
    id:               r.id,
    name:             r.name,
    slug:             r.slug,
    description:      r.description,
    access_tier:      r.access_tier,
    thread_count:     r.thread_count,
    last_activity_at: r.last_activity_at ? r.last_activity_at.toISOString() : null,
  }));
}

export async function getSubforumBySlug(slug: string) {
  const rows = await db
    .select()
    .from(subforums)
    .where(and(eq(subforums.slug, slug), eq(subforums.is_active, true)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listThreads(subforumId: string, q: ListThreadsQuery) {
  const orderBy =
    q.sort === 'popular' ? desc(forumThreads.reply_count) :
    q.sort === 'newest'  ? desc(forumThreads.created_at) :
                           desc(forumThreads.last_reply_at);

  const offset = (q.page - 1) * q.per_page;

  const rows = await db
    .select({
      id:              forumThreads.id,
      subforum_id:     forumThreads.subforum_id,
      title:           forumThreads.title,
      content:         forumThreads.content,
      is_pinned:       forumThreads.is_pinned,
      is_locked:       forumThreads.is_locked,
      is_flagged:      forumThreads.is_flagged,
      is_agent_seeded: forumThreads.is_agent_seeded,
      is_deleted:      forumThreads.is_deleted,
      deleted_at:      forumThreads.deleted_at,
      view_count:      forumThreads.view_count,
      reply_count:     forumThreads.reply_count,
      last_reply_at:   forumThreads.last_reply_at,
      created_at:      forumThreads.created_at,
      subforum_name:   subforums.name,
      subforum_slug:   subforums.slug,
      author_id:       users.id,
      author_username: users.username,
      author_display:  users.display_name,
      author_avatar:   users.avatar_url,
      author_role:     users.role,
      author_tier:     users.membership_tier,
      author_verified: users.is_verified,
      practitioner_verified: practitionerProfiles.is_verified,
    })
    .from(forumThreads)
    .innerJoin(subforums, eq(forumThreads.subforum_id, subforums.id))
    .leftJoin(users, eq(forumThreads.author_id, users.id))
    .leftJoin(practitionerProfiles, eq(practitionerProfiles.user_id, users.id))
    .where(and(eq(forumThreads.subforum_id, subforumId), eq(forumThreads.is_deleted, false)))
    .orderBy(desc(forumThreads.is_pinned), orderBy)
    .limit(q.per_page)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(forumThreads)
    .where(and(eq(forumThreads.subforum_id, subforumId), eq(forumThreads.is_deleted, false)));

  return {
    rows: rows.map(r => ({
      id:              r.id,
      subforum_id:     r.subforum_id,
      title:           r.title,
      excerpt:         (r.content ?? '').slice(0, 200),
      subforum: {
        id:   r.subforum_id,
        name: r.subforum_name,
        slug: r.subforum_slug,
      },
      is_pinned:       r.is_pinned,
      is_locked:       r.is_locked,
      is_flagged:      r.is_flagged,
      is_agent_seeded: r.is_agent_seeded,
      moderation_status: forumModerationStatus(r),
      status:          forumModerationStatus(r),
      deleted_at:      r.deleted_at ? r.deleted_at.toISOString() : null,
      view_count:      r.view_count,
      reply_count:     r.reply_count,
      last_reply_at:   r.last_reply_at ? r.last_reply_at.toISOString() : null,
      created_at:      r.created_at.toISOString(),
      author: {
        id:           r.author_id!,
        username:     r.author_username!,
        display_name: r.author_display!,
        avatar_url:   r.author_avatar,
        role:         r.author_role!,
        membership_tier: r.author_tier!,
        is_verified:  r.author_verified,
        practitioner_verified: Boolean(r.practitioner_verified),
      },
    })),
    total: count,
  };
}


export async function listLatestThreads(limit = 5) {
  const safeLimit = Math.min(Math.max(limit, 1), 20);
  const rows = await db
    .select({
      id:              forumThreads.id,
      subforum_id:     forumThreads.subforum_id,
      title:           forumThreads.title,
      is_pinned:       forumThreads.is_pinned,
      is_locked:       forumThreads.is_locked,
      is_flagged:      forumThreads.is_flagged,
      is_deleted:      forumThreads.is_deleted,
      deleted_at:      forumThreads.deleted_at,
      view_count:      forumThreads.view_count,
      reply_count:     forumThreads.reply_count,
      last_reply_at:   forumThreads.last_reply_at,
      created_at:      forumThreads.created_at,
      subforum_name:   subforums.name,
      subforum_slug:   subforums.slug,
      author_id:       users.id,
      author_username: users.username,
      author_display:  users.display_name,
      author_avatar:   users.avatar_url,
      author_role:     users.role,
      author_tier:     users.membership_tier,
      author_verified: users.is_verified,
      practitioner_verified: practitionerProfiles.is_verified,
    })
    .from(forumThreads)
    .innerJoin(subforums, eq(forumThreads.subforum_id, subforums.id))
    .leftJoin(users, eq(forumThreads.author_id, users.id))
    .leftJoin(practitionerProfiles, eq(practitionerProfiles.user_id, users.id))
    .where(and(
      eq(forumThreads.is_deleted, false),
      eq(subforums.is_active, true),
      eq(subforums.access_tier, 'free'),
    ))
    .orderBy(desc(forumThreads.last_reply_at), desc(forumThreads.created_at))
    .limit(safeLimit);

  return rows.map(r => ({
    id:              r.id,
    subforum_id:     r.subforum_id,
    title:           r.title,
    subforum: {
      id:   r.subforum_id,
      name: r.subforum_name,
      slug: r.subforum_slug,
    },
    is_pinned:       r.is_pinned,
    is_locked:       r.is_locked,
    is_flagged:      r.is_flagged,
    moderation_status: forumModerationStatus(r),
    status:          forumModerationStatus(r),
    deleted_at:      r.deleted_at ? r.deleted_at.toISOString() : null,
    view_count:      r.view_count,
    reply_count:     r.reply_count,
    last_reply_at:   r.last_reply_at ? r.last_reply_at.toISOString() : null,
    created_at:      r.created_at.toISOString(),
    author: r.author_id ? {
      id:           r.author_id,
      username:     r.author_username!,
      display_name: r.author_display!,
      avatar_url:   r.author_avatar,
      role:         r.author_role!,
      membership_tier: r.author_tier!,
      is_verified:  r.author_verified,
      practitioner_verified: Boolean(r.practitioner_verified),
    } : null,
  }));
}

export async function getThreadById(id: string) {
  const rows = await db
    .select({
      t: forumThreads,
      subforum: {
        id:   subforums.id,
        name: subforums.name,
        slug: subforums.slug,
      },
      author: {
        id:           users.id,
        username:     users.username,
        display_name: users.display_name,
        avatar_url:   users.avatar_url,
        role:         users.role,
        membership_tier: users.membership_tier,
        is_verified:  users.is_verified,
        profession:   users.profession,
        practitioner_verified: practitionerProfiles.is_verified,
      },
    })
    .from(forumThreads)
    .innerJoin(subforums, eq(forumThreads.subforum_id, subforums.id))
    .leftJoin(users, eq(forumThreads.author_id, users.id))
    .leftJoin(practitionerProfiles, eq(practitionerProfiles.user_id, users.id))
    .where(and(eq(forumThreads.id, id), eq(forumThreads.is_deleted, false)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id:              row.t.id,
    subforum_id:     row.t.subforum_id,
    title:           row.t.title,
    content:         row.t.content,
    is_pinned:       row.t.is_pinned,
    is_locked:       row.t.is_locked,
    is_flagged:      row.t.is_flagged,
    is_agent_seeded: row.t.is_agent_seeded,
    moderation_status: forumModerationStatus(row.t),
    status:          forumModerationStatus(row.t),
    deleted_at:      row.t.deleted_at ? row.t.deleted_at.toISOString() : null,
    view_count:      row.t.view_count,
    reply_count:     row.t.reply_count,
    last_reply_at:   row.t.last_reply_at ? row.t.last_reply_at.toISOString() : null,
    created_at:      row.t.created_at.toISOString(),
    updated_at:      row.t.updated_at.toISOString(),
    subforum:        row.subforum,
    author:          row.author,
    author_id:       row.t.author_id,
  };
}

export async function incrementThreadView(id: string) {
  await db.update(forumThreads).set({ view_count: sql`${forumThreads.view_count} + 1` }).where(eq(forumThreads.id, id));
}

export async function listReplies(threadId: string) {
  const rows = await db
    .select({
      id:              forumReplies.id,
      thread_id:       forumReplies.thread_id,
      parent_reply_id: forumReplies.parent_reply_id,
      content:         forumReplies.content,
      upvote_count:    forumReplies.upvote_count,
      is_agent_reply:  forumReplies.is_agent_reply,
      is_deleted:      forumReplies.is_deleted,
      created_at:      forumReplies.created_at,
      author_id:       users.id,
      author_username: users.username,
      author_display:  users.display_name,
      author_avatar:   users.avatar_url,
      author_role:     users.role,
      author_tier:     users.membership_tier,
      author_verified: users.is_verified,
      author_prof:     users.profession,
      practitioner_verified: practitionerProfiles.is_verified,
      deleted_at:      forumReplies.deleted_at,
    })
    .from(forumReplies)
    .leftJoin(users, eq(forumReplies.author_id, users.id))
    .leftJoin(practitionerProfiles, eq(practitionerProfiles.user_id, users.id))
    .where(and(eq(forumReplies.thread_id, threadId), eq(forumReplies.is_deleted, false)))
    .orderBy(forumReplies.created_at);

  return rows.map(r => ({
    id:              r.id,
    thread_id:       r.thread_id,
    parent_reply_id: r.parent_reply_id,
    content:         r.content,
    upvote_count:    r.upvote_count,
    is_agent_reply:  r.is_agent_reply,
    moderation_status: forumModerationStatus(r),
    status:          forumModerationStatus(r),
    deleted_at:      r.deleted_at ? r.deleted_at.toISOString() : null,
    created_at:      r.created_at.toISOString(),
    author: {
      id:           r.author_id!,
      username:     r.author_username!,
      display_name: r.author_display!,
      avatar_url:   r.author_avatar,
      role:         r.author_role!,
      membership_tier: r.author_tier!,
      is_verified:  r.author_verified,
      profession:   r.author_prof,
      practitioner_verified: Boolean(r.practitioner_verified),
    },
  }));
}

// --- Rate-limit (hour-window via postingRateLimits) ---
export async function checkAndTickRateLimit(userId: string, actionType: 'thread' | 'reply' | 'report', maxPerHour: number) {
  const now = new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const rows = await db
    .select()
    .from(postingRateLimits)
    .where(and(eq(postingRateLimits.user_id, userId), eq(postingRateLimits.action_type, actionType)))
    .limit(1);
  const existing = rows[0];

  if (!existing || existing.window_start < hourAgo) {
    await db
      .insert(postingRateLimits)
      .values({ user_id: userId, action_type: actionType, count: 1, window_start: now })
      .onConflictDoUpdate({
        target: [postingRateLimits.user_id, postingRateLimits.action_type],
        set: { count: 1, window_start: now },
      });
    return { allowed: true, remaining: maxPerHour - 1 };
  }

  if (existing.count >= maxPerHour) {
    return { allowed: false, remaining: 0 };
  }

  await db
    .update(postingRateLimits)
    .set({ count: existing.count + 1 })
    .where(and(eq(postingRateLimits.user_id, userId), eq(postingRateLimits.action_type, actionType)));
  return { allowed: true, remaining: maxPerHour - existing.count - 1 };
}

export async function createThread(opts: { subforum_id: string; author_id: string; input: CreateThreadInput; is_agent_seeded?: boolean }) {
  const safetyMatches = detectDangerousMedicalClaims(`${opts.input.title} ${opts.input.content}`);

  const [row] = await db.insert(forumThreads).values({
    subforum_id:     opts.subforum_id,
    author_id:       opts.author_id,
    title:           opts.input.title,
    content:         opts.input.content,
    is_flagged:      safetyMatches.length > 0,
    is_agent_seeded: opts.is_agent_seeded ?? false,
    last_reply_at:   new Date(),
  }).returning();

  await db.update(subforums).set({
    thread_count:     sql`${subforums.thread_count} + 1`,
    last_activity_at: new Date(),
  }).where(eq(subforums.id, opts.subforum_id));

  if (safetyMatches.length > 0) {
    await createAutoContentReport({
      target_type: 'thread',
      target_id: row.id,
      reason: 'medical_claim',
      details: `Deteksi otomatis: ${safetyMatches.join(', ')}`,
      safety_matches: safetyMatches,
    });
  }

  return row;
}

export async function createReply(opts: { thread_id: string; author_id: string; input: { content: string; parent_reply_id?: string | null }; is_agent_reply?: boolean }) {
  const safetyMatches = detectDangerousMedicalClaims(opts.input.content);

  // Enforce 1-level nesting: parent_reply_id must itself be top-level (parent null)
  if (opts.input.parent_reply_id) {
    const parent = await db
      .select({ parent_reply_id: forumReplies.parent_reply_id, thread_id: forumReplies.thread_id })
      .from(forumReplies)
      .where(eq(forumReplies.id, opts.input.parent_reply_id))
      .limit(1);
    if (!parent[0]) return { ok: false as const, code: 'PARENT_NOT_FOUND' as const };
    if (parent[0].parent_reply_id !== null) return { ok: false as const, code: 'NESTING_EXCEEDED' as const };
    if (parent[0].thread_id !== opts.thread_id) return { ok: false as const, code: 'PARENT_NOT_FOUND' as const };
  }

  const [row] = await db.insert(forumReplies).values({
    thread_id:       opts.thread_id,
    author_id:       opts.author_id,
    parent_reply_id: opts.input.parent_reply_id ?? null,
    content:         opts.input.content,
    is_agent_reply:  opts.is_agent_reply ?? false,
  }).returning();

  const now = new Date();
  await db.update(forumThreads).set({
    reply_count:   sql`${forumThreads.reply_count} + 1`,
    last_reply_at: now,
  }).where(eq(forumThreads.id, opts.thread_id));

  // Bump subforum activity
  const [t] = await db.select({ subforum_id: forumThreads.subforum_id }).from(forumThreads).where(eq(forumThreads.id, opts.thread_id)).limit(1);
  if (t) {
    await db.update(subforums).set({ last_activity_at: now }).where(eq(subforums.id, t.subforum_id));
  }

  if (safetyMatches.length > 0) {
    await createAutoContentReport({
      target_type: 'reply',
      target_id: row.id,
      reason: 'medical_claim',
      details: `Deteksi otomatis: ${safetyMatches.join(', ')}`,
      safety_matches: safetyMatches,
    });
  }

  return { ok: true as const, row };
}


export async function upvoteReply(replyId: string, userId: string) {
  const inserted = await db
    .insert(forumReplyUpvotes)
    .values({ reply_id: replyId, user_id: userId })
    .onConflictDoNothing()
    .returning();
  if (inserted.length) {
    await db.update(forumReplies).set({ upvote_count: sql`${forumReplies.upvote_count} + 1` }).where(eq(forumReplies.id, replyId));
  }
}

export async function removeUpvote(replyId: string, userId: string) {
  const deleted = await db
    .delete(forumReplyUpvotes)
    .where(and(eq(forumReplyUpvotes.reply_id, replyId), eq(forumReplyUpvotes.user_id, userId)))
    .returning();
  if (deleted.length) {
    await db.update(forumReplies).set({ upvote_count: sql`GREATEST(${forumReplies.upvote_count} - 1, 0)` }).where(eq(forumReplies.id, replyId));
  }
}

export async function getThreadAuthor(threadId: string) {
  const rows = await db.select({ author_id: forumThreads.author_id }).from(forumThreads).where(eq(forumThreads.id, threadId)).limit(1);
  return rows[0]?.author_id ?? null;
}

// Used for agent "active members last 24h" stats
export async function activeMembersSince(hours: number) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const [{ count }] = await db
    .select({ count: sql<number>`count(distinct ${users.id})::int` })
    .from(users)
    .where(gte(users.last_login_at, since));
  return count;
}


export async function getReplyById(id: string) {
  const rows = await db
    .select({ id: forumReplies.id, thread_id: forumReplies.thread_id, is_deleted: forumReplies.is_deleted })
    .from(forumReplies)
    .where(and(eq(forumReplies.id, id), eq(forumReplies.is_deleted, false)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createContentReport(opts: {
  reporter_id: string;
  target_type: 'thread' | 'reply';
  target_id: string;
  input: CreateReportInput;
}) {
  const [row] = await db
    .insert(contentReports)
    .values({
      reporter_id: opts.reporter_id,
      target_type: opts.target_type,
      target_id:   opts.target_id,
      reason:      opts.input.reason,
      details:     opts.input.details?.trim() || null,
      auto_detected: false,
      safety_matches: null,
    })
    .onConflictDoNothing()
    .returning();

  if (!row) return { ok: false as const, code: 'DUPLICATE_REPORT' as const };

  if (opts.target_type === 'thread') {
    await db.update(forumThreads).set({ is_flagged: true, updated_at: new Date() }).where(eq(forumThreads.id, opts.target_id));
  } else {
    const reply = await getReplyById(opts.target_id);
    if (reply) {
      await db.update(forumThreads).set({ is_flagged: true, updated_at: new Date() }).where(eq(forumThreads.id, reply.thread_id));
    }
  }

  await notifyModeratorsOfReport(row.id, opts.target_type, opts.target_id, opts.input.reason, false).catch(() => undefined);

  return { ok: true as const, row };
}

async function createAutoContentReport(opts: {
  target_type: 'thread' | 'reply';
  target_id: string;
  reason: 'medical_claim';
  details: string;
  safety_matches: string[];
}) {
  const [existing] = await db
    .select({ id: contentReports.id })
    .from(contentReports)
    .where(and(
      eq(contentReports.target_type, opts.target_type),
      eq(contentReports.target_id, opts.target_id),
      eq(contentReports.auto_detected, true),
    ))
    .limit(1);

  if (existing) return null;

  const [row] = await db.insert(contentReports).values({
    reporter_id: null,
    target_type: opts.target_type,
    target_id: opts.target_id,
    reason: opts.reason,
    details: opts.details,
    auto_detected: true,
    safety_matches: opts.safety_matches,
  }).returning();

  if (opts.target_type === 'thread') {
    await db.update(forumThreads).set({ is_flagged: true, updated_at: new Date() }).where(eq(forumThreads.id, opts.target_id));
  } else {
    const reply = await getReplyById(opts.target_id);
    if (reply) {
      await db.update(forumThreads).set({ is_flagged: true, updated_at: new Date() }).where(eq(forumThreads.id, reply.thread_id));
    }
  }

  await notifyModeratorsOfReport(row.id, opts.target_type, opts.target_id, opts.reason, true).catch(() => undefined);
  return row;
}

async function notifyModeratorsOfReport(reportId: string, targetType: 'thread' | 'reply', targetId: string, reason: string, autoDetected: boolean) {
  const moderators = await db
    .select({ id: users.id })
    .from(users)
    .where(and(sql`${users.role} IN ('admin', 'moderator')`, eq(users.is_active, true)));

  if (!moderators.length) return;

  await db.insert(notifications).values(moderators.map((u) => ({
    user_id: u.id,
    type: 'system' as const,
    title: autoDetected ? 'Konten otomatis ditandai' : 'Laporan moderasi baru',
    body: `${autoDetected ? 'Deteksi otomatis' : 'Laporan user'}: ${reason} pada ${targetType}.`,
    link: `/dashboard?tab=moderasi&report=${reportId}&target=${targetType}:${targetId}`,
  })));
}
