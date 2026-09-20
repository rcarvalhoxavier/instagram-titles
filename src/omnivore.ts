import type { Fetcher } from "./fetcher.ts";

export interface Item {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly labels: readonly string[];
}

export interface Library {
  search(query: string, limit: number): Promise<Item[]>;
  updatePage(pageId: string, title: string, byline: string): Promise<void>;
  setLabels(pageId: string, labels: readonly string[]): Promise<void>;
}

const SEARCH = `query Search($query: String!, $first: Int!) {
  search(query: $query, first: $first) {
    ... on SearchSuccess { edges { node { id title url labels { name } } } }
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
    });
    if (!response.ok) throw new Error(`Omnivore returned HTTP ${response.status}`);
    const payload = (await response.json()) as GraphQLResponse;
    if (payload.errors?.length) {
      throw new Error(
        `GraphQL error: ${payload.errors.map((e) => e.message ?? "?").join("; ")}`,
      );
    }
    return payload.data;
  }

  async search(query: string, limit: number): Promise<Item[]> {
    const data = (await this.#call(SEARCH, { query, first: limit })) as {
      search: { edges?: ReadonlyArray<{ node: SearchNode }> };
    };
    return (data.search.edges ?? []).map(({ node }) => ({
      id: node.id,
      url: node.url,
      title: node.title ?? "",
      labels: (node.labels ?? []).map((label) => label.name),
    }));
  }

  async updatePage(pageId: string, title: string, byline: string): Promise<void> {
    await this.#call(UPDATE_PAGE, { input: { pageId, title, byline } });
  }

  /**
   * Replace the item's label set with exactly `labels`.
   *
   * Verified against a live instance: this mutation REPLACES. Applying
   * ["gamma"] to an item holding ["alpha","beta"] leaves only "gamma". Callers
   * must therefore pass the full desired set, existing labels included -- see
   * writer.applyGone, and design risk #1.
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
