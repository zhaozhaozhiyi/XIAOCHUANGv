export function buildPageHref(
  page: number,
  params: Record<string, string | undefined>,
) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (!value) return;
    query.set(key, value);
  });

  query.set("page", String(page));
  return `?${query.toString()}`;
}
