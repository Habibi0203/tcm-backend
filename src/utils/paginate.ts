export type PaginateOptions = {
  page?: number | string;
  per_page?: number | string;
  max_per_page?: number;
};

export type PaginateMeta = {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
};

export function getPaginationParams(opts: PaginateOptions) {
  const page = Math.max(1, Number(opts.page) || 1);
  const per_page = Math.min(
    opts.max_per_page ?? 50,
    Math.max(1, Number(opts.per_page) || 10),
  );
  const offset = (page - 1) * per_page;
  return { page, per_page, offset, limit: per_page };
}

export function buildMeta(total: number, page: number, per_page: number): PaginateMeta {
  return {
    page,
    per_page,
    total,
    total_pages: Math.max(1, Math.ceil(total / per_page)),
  };
}
