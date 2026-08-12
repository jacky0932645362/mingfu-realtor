export type CalendarEventIdPage = {
  items?: Array<{ id?: string | null }>;
  nextPageToken?: string | null;
};

type CalendarEventIdPageFetcher = (
  pageToken: string | undefined,
) => Promise<CalendarEventIdPage>;

/**
 * Collect every event ID in a paginated Google Calendar response.
 *
 * The caller deliberately gets an exception instead of a partial set when the
 * provider fails or repeats a token. An orphan check must treat partial data as
 * unknown, otherwise a valid event on a missing page can be cancelled.
 */
export async function collectCalendarEventIds(
  fetchPage: CalendarEventIdPageFetcher,
  maxPages = 100,
): Promise<Set<string>> {
  const ids = new Set<string>();
  const seenTokens = new Set<string>();
  let pageToken: string | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const result = await fetchPage(pageToken);
    for (const item of result.items || []) {
      const id = typeof item.id === "string" ? item.id.trim() : "";
      if (id) ids.add(id);
    }

    const nextPageToken = typeof result.nextPageToken === "string"
      ? result.nextPageToken.trim()
      : "";
    if (!nextPageToken) return ids;
    if (seenTokens.has(nextPageToken)) {
      throw new Error("google_calendar_repeated_page_token");
    }

    seenTokens.add(nextPageToken);
    pageToken = nextPageToken;
  }

  throw new Error("google_calendar_page_limit_exceeded");
}
