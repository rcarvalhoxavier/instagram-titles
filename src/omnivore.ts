// Its own type rather than the package's: the Omnivore client has no
// business depending on the Instagram fetcher for a function signature that
// is simply typeof fetch. Same argument as the constant just below.
export type Fetcher = typeof fetch;

// Its own constant rather than the fetcher's: the Omnivore client has no
// business depending on the Instagram fetcher for a number.
const REQUEST_TIMEOUT_MS = 30_000;

export interface Item {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly labels: readonly string[];
}

export interface SearchPage {
  readonly items: Item[];
  /** Cursor for the next page, or null when this was the last one. */
  readonly next: string | null;
}

export interface Library {
  search(query: string, limit: number, after?: string): Promise<SearchPage>;
  updatePage(pageId: string, title: string, byline: string): Promise<void>;
  setLabels(pageId: string, labels: readonly string[]): Promise<void>;
}

const SEARCH = `query Search($query: String!, $first: Int!, $after: String) {
  search(query: $query, first: $first, after: $after) {
    ... on SearchSuccess {
      pageInfo { hasNextPage endCursor }
      edges { node { id title url labels { name } } }
    }
    ... on SearchError { errorCodes }
  }
}`;

const UPDATE_PAGE = `mutation UpdatePage($input: UpdatePageInput!) {
  updatePage(input: $input) {
    ... on UpdatePageSuccess { updatedPage { id } }
    ... on UpdatePageError { errorCodes }
  }
}`;

const SET_LABELS = `mutation SetLabels($input: SetLabelsInput!) {
  setLabels(input: $input) {
    ... on SetLabelsSuccess { labels { name } }
    ... on SetLabelsError { errorCodes }
  }
}`;

interface GraphQLResponse {
  data?: unknown;
  errors?: ReadonlyArray<{ message?: string }>;
}

interface SearchNode {
  id: string;
  title: string | null;
  url: string;
  labels: ReadonlyArray<{ name: string }> | null;
}

function findErrorCodes(data: unknown): string[] | null {
  if (typeof data !== "object" || data === null) return null;
  for (const value of Object.values(data as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) continue;
    const codes = (value as { errorCodes?: unknown }).errorCodes;
    if (Array.isArray(codes) && codes.length > 0) return codes.map(String);
  }
  return null;
}

export class OmnivoreClient implements Library {
  readonly #url: string;
  readonly #key: string;
  readonly #fetch: Fetcher;

  constructor(apiUrl: string, apiKey: string, fetchImpl: Fetcher = fetch) {
    this.#url = apiUrl;
    this.#key = apiKey;
    this.#fetch = fetchImpl;
  }

  async #call(query: string, variables: Record<string, unknown>): Promise<unknown> {
    const response = await this.#fetch(this.#url, {
      method: "POST",
      headers: { Authorization: this.#key, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      // The body usually says why; discarding it leaves an unactionable log.
      const body = (await response.text().catch(() => "")).slice(0, 200);
      throw new Error(`Omnivore returned HTTP ${response.status}${body ? `: ${body}` : ""}`);
    }
    const payload = (await response.json()) as GraphQLResponse;
    if (payload.errors?.length) {
      throw new Error(
        `GraphQL error: ${payload.errors.map((e) => e.message ?? "?").join("; ")}`,
      );
    }
    // Omnivore answers a rejected mutation with HTTP 200 and an errorCodes
    // member of the result union, not with a top-level "errors" array. Without
    // this check a refused write is logged as a success and the labels or title
    // silently never change.
    const failure = findErrorCodes(payload.data);
    if (failure !== null) {
      throw new Error(`Omnivore rejected the request: ${failure.join(", ")}`);
    }
    return payload.data;
  }

  async search(query: string, limit: number, after?: string): Promise<SearchPage> {
    const data = (await this.#call(SEARCH, { query, first: limit, after: after ?? null })) as {
      search?: {
        edges?: ReadonlyArray<{ node: SearchNode }>;
        pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
      };
    };
    if (data.search === undefined || data.search === null) {
      throw new Error("Omnivore returned no search result; the query may be malformed");
    }
    const items = (data.search.edges ?? []).map(({ node }) => ({
      id: node.id,
      url: node.url,
      title: node.title ?? "",
      labels: (node.labels ?? []).map((label) => label.name),
    }));
    const page = data.search.pageInfo;
    return { items, next: page?.hasNextPage === true ? (page.endCursor ?? null) : null };
  }

  async updatePage(pageId: string, title: string, byline: string): Promise<void> {
    await this.#call(UPDATE_PAGE, { input: { pageId, title, byline } });
  }

  /**
   * Replace the item's label set with exactly `labels`.
   *
   * Verified against a live instance: this mutation REPLACES. Applying
   * ["gamma"] to an item holding ["alpha","beta"] leaves only "gamma". Callers
   * must therefore pass the full desired set, existing labels included -- see writer.applyGone.
   *
   * The wire shape is LIST<CreateLabelInput>, so each name has to be wrapped in
   * an object. Sending bare strings is accepted by TypeScript and rejected by
   * the server, which no transport-stubbing unit test can catch.
   */
  async setLabels(pageId: string, labels: readonly string[]): Promise<void> {
    await this.#call(SET_LABELS, {
      input: { pageId, labels: labels.map((name) => ({ name })) },
    });
  }
}
