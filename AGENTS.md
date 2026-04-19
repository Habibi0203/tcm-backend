# tcm.my.id Backend

REST API untuk platform komunitas TCM Indonesia.
Stack: Node.js 20, Fastify v4, PostgreSQL 16, Redis 7, Drizzle ORM.
Migration database: raw SQL di src/db/migrations/0001_initial.sql
Auth: JWT (access 15 menit + refresh 7 hari di httpOnly cookie)
Standard response: { success, data, meta } atau { success, error }
Agent API: header X-Agent-Key (bukan JWT)

Phase 2A scope: Auth + Users + Articles + Forum + Agent endpoints
Phase 2B (later): Payment, Translate, Search, Upload

Aturan auth/akses:
- 401 = tidak ada token atau token invalid
- 403 = token valid tapi tidak punya akses (role/tier tidak cukup)
- Subforum premium + user belum login → 401 (bukan 403)
- Subforum premium + user login tapi free → 403 PREMIUM_REQUIRED

Konten artikel:
- Field `content` adalah TEXT panjang (Markdown) — disimpan langsung di DB
- Field `content_en` adalah TEXT atau NULL — terjemahan, diisi agent
- Tidak ada CMS eksternal di Phase 2A

Refresh token:
- Setiap POST /auth/refresh → generate refresh token BARU, simpan di cookie
- Token lama langsung di-blacklist di Redis

Active member (untuk agent/stats):
- User yang melakukan SALAH SATU dari ini dalam 24 jam terakhir:
  last_login_at >= NOW() - INTERVAL '24 hours'
  ATAU created_at thread/reply dalam 24 jam
