-- Refresh live/public TCM category taxonomy to match the 3-persona editorial model.
-- Safe choices:
-- - Keep `herbal-tcm` slug for the active Herbal category to avoid breaking existing category links.
-- - Rename only the zero-article duplicate categories at the slug level.

BEGIN;

UPDATE categories SET
  name = 'Filosofi TCM',
  description = 'Kerangka pikir, konsep, dan landasan TCM untuk memahami tubuh dan penyakit.',
  color_hex = '#0F766E',
  sort_order = 1,
  is_active = true
WHERE slug = 'filosofi-tcm';

UPDATE categories SET
  name = 'Edukasi TCM Dasar',
  description = 'Fondasi dan filosofi TCM untuk pemula.',
  color_hex = '#1D9E75',
  sort_order = 2,
  is_active = true
WHERE slug = 'edukasi-tcm-dasar';

UPDATE categories SET
  name = 'Praktik TCM',
  description = 'Cara berpikir dan penerapan TCM dalam penilaian serta tindakan praktik.',
  color_hex = '#2563EB',
  sort_order = 3,
  is_active = true
WHERE slug = 'praktik-tcm';

UPDATE categories SET
  name = 'Protokol Kondisi Spesifik',
  description = 'Pendekatan TCM yang aplikatif untuk kondisi kesehatan spesifik.',
  color_hex = '#BA7517',
  sort_order = 4,
  is_active = true
WHERE slug = 'protokol-kondisi-spesifik';

UPDATE categories SET
  name = 'Kondisi Kesehatan',
  description = 'Bahasan keluhan dan kondisi kesehatan dari sudut pandang TCM.',
  color_hex = '#DC2626',
  sort_order = 5,
  is_active = true
WHERE slug = 'kondisi-kesehatan';

UPDATE categories SET
  name = 'Gaya Hidup TCM',
  description = 'Rutinitas, tidur, gerak, dan pola hidup sehat menurut TCM.',
  color_hex = '#534AB7',
  sort_order = 6,
  is_active = true
WHERE slug = 'gaya-hidup-tcm';

UPDATE categories SET
  name = 'Nutrisi TCM',
  description = 'Pola makan, sifat makanan, dan strategi nutrisi menurut TCM.',
  color_hex = '#15803D',
  sort_order = 7,
  is_active = true
WHERE slug = 'nutrisi-tcm';

UPDATE categories SET
  name = 'Referensi Praktisi',
  description = 'Rujukan praktik, studi kasus, dan pembahasan untuk praktisi TCM.',
  color_hex = '#993C1D',
  sort_order = 8,
  is_active = true
WHERE slug = 'referensi-praktisi';

UPDATE categories SET
  name = 'Akupunktur',
  description = 'Terapi akupunktur, indikasi, keamanan, dan ekspektasi hasil.',
  color_hex = '#0C447C',
  sort_order = 9,
  is_active = true
WHERE slug = 'akupunktur';

UPDATE categories SET
  name = 'Herbal',
  description = 'Herbal, formula, dosis, dan pertimbangan penggunaan dalam TCM.',
  color_hex = '#3B6D11',
  sort_order = 10,
  is_active = true
WHERE slug = 'herbal-tcm';

UPDATE categories SET
  name = 'Terapi TCM Lainnya',
  slug = 'terapi-tcm-lainnya',
  description = 'Bekam, moksibusi, gua sha, tuina, dan terapi TCM selain herbal dan akupunktur.',
  color_hex = '#7C3AED',
  sort_order = 11,
  is_active = true
WHERE slug = 'herbal-tanaman-obat';

UPDATE categories SET
  name = 'Titik & Meridian TCM',
  slug = 'titik-meridian-tcm',
  description = 'Titik akupunktur, jalur meridian, dan cara memahaminya dalam praktik TCM.',
  color_hex = '#0E7490',
  sort_order = 12,
  is_active = true
WHERE slug = 'akupuntur-meridian';

COMMIT;
