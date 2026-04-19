-- tcm.my.id — Initial schema
-- Phase 2A: users, auth, content (articles, categories, tags), forum, system (notifications, bookmarks, audit_logs)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- ENUMS
-- ============================================================
CREATE TYPE profession_type   AS ENUM ('general', 'practitioner', 'student');
CREATE TYPE user_role         AS ENUM ('member', 'moderator', 'admin', 'agent');
CREATE TYPE membership_tier   AS ENUM ('free', 'premium');
CREATE TYPE access_tier       AS ENUM ('free', 'premium');
CREATE TYPE article_status    AS ENUM ('draft', 'review', 'published', 'archived', 'scheduled');
CREATE TYPE author_type       AS ENUM ('user', 'agent');
CREATE TYPE notification_type AS ENUM ('article_approved', 'article_rejected', 'new_reply', 'reply_upvote', 'system');

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE users (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email            VARCHAR(255) NOT NULL UNIQUE,
  username         VARCHAR(50)  NOT NULL UNIQUE,
  display_name     VARCHAR(100) NOT NULL,
  password_hash    TEXT,
  avatar_url       TEXT,
  bio              TEXT,
  profession       profession_type DEFAULT 'general',
  role             user_role       NOT NULL DEFAULT 'member',
  membership_tier  membership_tier NOT NULL DEFAULT 'free',
  is_verified      BOOLEAN NOT NULL DEFAULT false,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  last_login_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_email    ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_role     ON users(role);
CREATE INDEX idx_users_tier     ON users(membership_tier);

-- ============================================================
-- AUTH (OAuth, email verification, password reset)
-- ============================================================
CREATE TABLE oauth_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider        VARCHAR(50) NOT NULL,
  provider_user_id VARCHAR(255) NOT NULL,
  access_token    TEXT,
  refresh_token   TEXT,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_user_id)
);

CREATE TABLE email_verifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       VARCHAR(64) NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE password_reset_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       VARCHAR(64) NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- PRACTITIONER PROFILES (verified practitioners)
-- ============================================================
CREATE TABLE practitioner_profiles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  specialties     TEXT[],
  years_experience INT,
  license_number  VARCHAR(100),
  clinic_name     VARCHAR(200),
  clinic_address  TEXT,
  is_verified     BOOLEAN NOT NULL DEFAULT false,
  verified_at     TIMESTAMPTZ,
  verification_notes TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- CONTENT: categories, tags, articles
-- ============================================================
CREATE TABLE categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL,
  slug        VARCHAR(120) NOT NULL UNIQUE,
  description TEXT,
  color_hex   VARCHAR(7),
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tags (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(60) NOT NULL UNIQUE,
  slug       VARCHAR(80) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE articles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title             VARCHAR(500) NOT NULL,
  slug              VARCHAR(600) NOT NULL UNIQUE,
  excerpt           TEXT,
  content           TEXT,
  content_en        TEXT,
  category_id       UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  author_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  author_type       author_type NOT NULL DEFAULT 'user',
  status            article_status NOT NULL DEFAULT 'draft',
  access_tier       access_tier    NOT NULL DEFAULT 'free',
  thumbnail_url     TEXT,
  read_time_minutes INT,
  has_disclaimer    BOOLEAN DEFAULT false,
  seo_title         VARCHAR(200),
  seo_description   TEXT,
  view_count        INT NOT NULL DEFAULT 0,
  like_count        INT NOT NULL DEFAULT 0,
  comment_count     INT NOT NULL DEFAULT 0,
  published_at      TIMESTAMPTZ,
  deleted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_articles_slug        ON articles(slug);
CREATE INDEX idx_articles_status      ON articles(status);
CREATE INDEX idx_articles_category    ON articles(category_id);
CREATE INDEX idx_articles_author      ON articles(author_id);
CREATE INDEX idx_articles_access_tier ON articles(access_tier);
CREATE INDEX idx_articles_published   ON articles(published_at DESC);

CREATE TABLE article_tags (
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  tag_id     UUID NOT NULL REFERENCES tags(id)     ON DELETE CASCADE,
  PRIMARY KEY (article_id, tag_id)
);

CREATE TABLE article_likes (
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (article_id, user_id)
);

CREATE TABLE article_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id  UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  author_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id   UUID REFERENCES article_comments(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  like_count  INT NOT NULL DEFAULT 0,
  is_deleted  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_article_comments_article ON article_comments(article_id);
CREATE INDEX idx_article_comments_parent  ON article_comments(parent_id);

CREATE TABLE article_comment_likes (
  comment_id UUID NOT NULL REFERENCES article_comments(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id)
);

-- ============================================================
-- FORUM: subforums, threads, replies
-- ============================================================
CREATE TABLE subforums (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             VARCHAR(100) NOT NULL,
  slug             VARCHAR(120) NOT NULL UNIQUE,
  description      TEXT,
  access_tier      access_tier NOT NULL DEFAULT 'free',
  sort_order       INT NOT NULL DEFAULT 0,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  thread_count     INT NOT NULL DEFAULT 0,
  last_activity_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE forum_threads (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subforum_id      UUID NOT NULL REFERENCES subforums(id) ON DELETE CASCADE,
  author_id        UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title            VARCHAR(200) NOT NULL,
  content          TEXT NOT NULL,
  is_pinned        BOOLEAN NOT NULL DEFAULT false,
  is_locked        BOOLEAN NOT NULL DEFAULT false,
  is_flagged       BOOLEAN NOT NULL DEFAULT false,
  is_agent_seeded  BOOLEAN NOT NULL DEFAULT false,
  is_deleted       BOOLEAN NOT NULL DEFAULT false,
  view_count       INT NOT NULL DEFAULT 0,
  reply_count      INT NOT NULL DEFAULT 0,
  last_reply_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_forum_threads_subforum  ON forum_threads(subforum_id);
CREATE INDEX idx_forum_threads_author    ON forum_threads(author_id);
CREATE INDEX idx_forum_threads_last_reply ON forum_threads(last_reply_at DESC);
CREATE INDEX idx_forum_threads_flagged   ON forum_threads(is_flagged) WHERE is_flagged = true;

CREATE TABLE forum_replies (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id        UUID NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
  author_id        UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  parent_reply_id  UUID REFERENCES forum_replies(id) ON DELETE CASCADE,
  content          TEXT NOT NULL,
  upvote_count     INT NOT NULL DEFAULT 0,
  is_agent_reply   BOOLEAN NOT NULL DEFAULT false,
  is_deleted       BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_forum_replies_thread ON forum_replies(thread_id);
CREATE INDEX idx_forum_replies_parent ON forum_replies(parent_reply_id);
CREATE INDEX idx_forum_replies_author ON forum_replies(author_id);

CREATE TABLE forum_reply_upvotes (
  reply_id   UUID NOT NULL REFERENCES forum_replies(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (reply_id, user_id)
);

-- Rate-limit tracker for user posting
CREATE TABLE posting_rate_limits (
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_type   VARCHAR(40) NOT NULL,
  count         INT NOT NULL DEFAULT 0,
  window_start  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, action_type)
);

-- ============================================================
-- SYSTEM: notifications, bookmarks, audit logs
-- ============================================================
CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        notification_type NOT NULL,
  title       VARCHAR(200) NOT NULL,
  body        TEXT,
  link        VARCHAR(500),
  is_read     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user       ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);

CREATE TABLE bookmarks (
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_id    UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  bookmarked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, article_id)
);

CREATE TABLE audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  action      VARCHAR(60) NOT NULL,
  entity_type VARCHAR(40),
  entity_id   UUID,
  ip_address  VARCHAR(45),
  user_agent  TEXT,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_logs_user    ON audit_logs(user_id, created_at DESC);
CREATE INDEX idx_audit_logs_action  ON audit_logs(action);

-- ============================================================
-- SEED DATA
-- ============================================================

-- Agent user (for Paperclip auto-publishing)
INSERT INTO users (id, email, username, display_name, role, membership_tier, is_verified, is_active, bio)
VALUES (
  gen_random_uuid(),
  'agent@tcm.my.id',
  'paperclip',
  'Paperclip Agent',
  'agent',
  'premium',
  true,
  true,
  'Agent otomatis tcm.my.id — menerbitkan konten kurasi dan terjemahan.'
);

-- Admin seed
INSERT INTO users (id, email, username, display_name, role, membership_tier, is_verified, is_active, bio, profession)
VALUES (
  gen_random_uuid(),
  'admin@tcm.my.id',
  'admin_tcm',
  'Admin TCM',
  'admin',
  'premium',
  true,
  true,
  'Administrator tcm.my.id — Platform komunitas TCM Indonesia.',
  'practitioner'
);

-- Categories (6)
INSERT INTO categories (name, slug, description, color_hex, sort_order) VALUES
  ('Edukasi TCM Dasar',         'edukasi-tcm-dasar',         'Fondasi dan filosofi TCM untuk pemula', '#1D9E75', 1),
  ('Herbal & Tanaman Obat',     'herbal-tanaman-obat',       'Khasiat, dosis, dan cara penggunaan herbal TCM', '#3B6D11', 2),
  ('Akupuntur & Meridian',      'akupuntur-meridian',        'Titik meridian, teknik akupuntur, dan manfaatnya', '#0C447C', 3),
  ('Protokol Kondisi Spesifik', 'protokol-kondisi-spesifik', 'Panduan TCM per kondisi kesehatan', '#BA7517', 4),
  ('Gaya Hidup TCM',            'gaya-hidup-tcm',            'Resep, rutinitas, Qi Gong, dan pola hidup sehat', '#534AB7', 5),
  ('Referensi Praktisi',        'referensi-praktisi',        'Studi kasus dan referensi mendalam untuk terapis', '#993C1D', 6);

-- Subforums (4: 2 free, 2 premium)
INSERT INTO subforums (name, slug, description, access_tier, sort_order) VALUES
  ('Diskusi Umum',      'diskusi-umum',      'Topik TCM umum, tanya-jawab, dan obrolan ringan.',       'free',    1),
  ('Sharing Pengalaman','sharing-pengalaman','Cerita pengalaman pribadi menggunakan terapi TCM.',      'free',    2),
  ('Tanya Praktisi',    'tanya-praktisi',    'Konsultasi langsung dengan praktisi TCM terverifikasi.', 'premium', 3),
  ('Forum Jual Beli',   'fjb',               'Jual-beli herbal, alat akupuntur, dan produk TCM.',      'premium', 4);
