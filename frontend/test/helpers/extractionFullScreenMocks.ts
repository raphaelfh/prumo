/**
 * Shared mock BODIES for the ExtractionFullScreen suites.
 *
 * `vi.mock` is hoisted PER MODULE, so each suite declares its own `vi.mock`
 * calls and takes only the factory bodies from here, pulled in with
 * `await import` — the one form that is safe against that hoisting.
 * Deliberately imports NO component (see qaFullScreenMocks.tsx).
 */

/**
 * The `supabase` client stub. The page's bootstrap reads its article worklist
 * through `fetchProjectArticles` (a baselined PostgREST read, see
 * scripts/fitness/check_frontend_data_path.baseline), and the reader's DOI
 * link reads one article by id; everything else on the screen goes through
 * `apiClient`. `articles` is the worklist, in the order the service returns it
 * (created_at desc).
 */
export function makeSupabaseClientMock(articles: Array<{ id: string; title: string | null }>) {
  function makeQuery(table: string) {
    const rows = table === "articles" ? articles : [];
    let idFilter: string | undefined;
    const list = { data: rows, error: null };
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        if (column === "id") idFilter = String(value);
        return builder;
      },
      in: () => builder,
      order: () => builder,
      // Paged reads (fetchProjectArticles) ask for a range; the stub answers
      // the whole fixture, which is short enough to be the last page.
      range: () => builder,
      single: () => {
        const row = rows.find((r) => r.id === idFilter) ?? null;
        return Promise.resolve(
          row
            ? { data: row, error: null }
            : { data: null, error: { code: "PGRST116", message: "0 rows" } },
        );
      },
      maybeSingle: () =>
        Promise.resolve({ data: rows.find((r) => r.id === idFilter) ?? null, error: null }),
      then: (cb: (r: typeof list) => unknown) => Promise.resolve(cb(list)),
    };
    return builder;
  }

  return {
    // AISuggestionService.loadSuggestions resolves the current reviewer via
    // supabase.auth.getUser().
    auth: {
      getUser: async () => ({ data: { user: { id: "reviewer-1" } }, error: null }),
    },
    from: makeQuery,
  };
}
