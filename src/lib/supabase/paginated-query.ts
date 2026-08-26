type QueryError = {
  message: string;
} | null;

type PageResult<T> = {
  data: T[] | null;
  error: QueryError;
};

export async function readAllPages<T>(
  loadPage: (
    range: { from: number; to: number },
  ) => PromiseLike<PageResult<T>> | PageResult<T>,
  options?: {
    pageSize?: number;
    label?: string;
  },
) {
  const pageSize = Math.min(Math.max(options?.pageSize ?? 500, 1), 500);
  const items: T[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await loadPage({
      from,
      to: from + pageSize - 1,
    });

    if (error) {
      throw new Error(`${options?.label ?? "数据"}读取失败：${error.message}`);
    }

    const page = data ?? [];
    items.push(...page);
    if (page.length < pageSize) {
      return items;
    }

    from += pageSize;
  }
}
