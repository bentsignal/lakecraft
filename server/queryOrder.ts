type IndexRange = {
  eq(field: string, value: unknown): IndexRange;
  gt(field: string, value: unknown): IndexRange;
  gte(field: string, value: unknown): IndexRange;
  lt(field: string, value: unknown): IndexRange;
  lte(field: string, value: unknown): IndexRange;
};

export type OrderedIndexQuery<Row> = {
  order(direction: "asc" | "desc"): OrderedIndexQuery<Row>;
  collect(): Promise<Row[]>;
  first(): Promise<Row | null>;
  take(count: number): Promise<Row[]>;
};

export type IndexedTable<Row> = {
  withIndex(index: string, range?: (query: IndexRange) => IndexRange): OrderedIndexQuery<Row>;
};

/** Preserve the index and range at each call site; share only descending order. */
export function newestByIndex<Row>(
  table: IndexedTable<Row>,
  index: string,
  range?: (query: IndexRange) => IndexRange,
): OrderedIndexQuery<Row> {
  return table.withIndex(index, range).order("desc");
}

/** Preserve the index and range at each call site; share only ascending order. */
export function oldestByIndex<Row>(table: IndexedTable<Row>, index: string, range?: (query: IndexRange) => IndexRange): OrderedIndexQuery<Row> {
  return table.withIndex(index, range).order("asc");
}
