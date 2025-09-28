declare module 'fast-fuzzy' {
  export interface MatchResult<T> {
    readonly item: T;
    readonly score: number;
  }

  export interface FullOptions<T> {
    readonly keySelector?: (item: T) => string;
    readonly ignoreCase?: boolean;
    readonly ignoreSymbols?: boolean;
    readonly normalizeWhitespace?: boolean;
    readonly threshold?: number;
    readonly returnMatchData?: boolean;
    readonly sortBy?: unknown;
  }

  export class Searcher<TItem, TOptions extends FullOptions<TItem> = FullOptions<TItem>> {
    constructor(items: readonly TItem[], options?: TOptions);
    search(query: string, options?: Partial<TOptions>): readonly MatchResult<TItem>[];
  }

  export const sortKind: {
    readonly bestMatch: 'best-match';
  };
}
