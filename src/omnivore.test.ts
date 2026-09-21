import { test } from "node:test";
import assert from "node:assert/strict";
import { OmnivoreClient } from "./omnivore.ts";

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

test("search maps edges to items", async () => {
  const client = new OmnivoreClient("https://k.example/api/graphql", "secret", async () =>
    json({ data: { search: { edges: [{ node: {
      id: "1", title: "Instagram", url: "https://www.instagram.com/p/AAA/",
      labels: [{ name: "keep" }],
    } }] } } }));
  const page = await client.search("q", 10);
  assert.deepEqual(page.items, [{
    id: "1", url: "https://www.instagram.com/p/AAA/", title: "Instagram", labels: ["keep"],
  }]);
  assert.equal(page.next, null, "no pageInfo means no next page");
});

test("search tolerates null labels and null title", async () => {
  const client = new OmnivoreClient("https://k.example/api/graphql", "secret", async () =>
    json({ data: { search: { edges: [{ node: {
      id: "1", title: null, url: "https://www.instagram.com/p/AAA/", labels: null,
    } }] } } }));
  const [item] = (await client.search("q", 10)).items;
  assert.deepEqual(item?.labels, []);
  assert.equal(item?.title, "");
});

test("the api key is sent as the Authorization header", async () => {
  let seen: string | null = null;
  const client = new OmnivoreClient("https://k.example/api/graphql", "secret", async (_u, init) => {
    seen = new Headers(init?.headers).get("Authorization");
    return json({ data: { search: { edges: [] } } });
  });
  await client.search("q", 1);
  assert.equal(seen, "secret");
});

test("graphql errors throw", async () => {
  const client = new OmnivoreClient("https://k.example/api/graphql", "secret", async () =>
    json({ errors: [{ message: "nope" }] }));
  await assert.rejects(() => client.search("q", 1), /nope/);
});

test("updatePage sends title and byline", async () => {
  let body: unknown = null;
  const client = new OmnivoreClient("https://k.example/api/graphql", "secret", async (_u, init) => {
    body = JSON.parse(String(init?.body));
    return json({ data: { updatePage: { updatedPage: { id: "1" } } } });
  });
  await client.updatePage("1", "A caption", "nasa");
  assert.deepEqual((body as { variables: { input: unknown } }).variables.input,
    { pageId: "1", title: "A caption", byline: "nasa" });
});

test("setLabels wraps each name as CreateLabelInput, not a bare string", () => {
  // The schema field is LIST<CreateLabelInput>. Bare strings type-check here
  // and are rejected by the server, so only a test on the wire shape catches
  // it -- stubbing the transport hides the mismatch entirely.
  let body: unknown = null;
  const client = new OmnivoreClient("https://k.example/api/graphql", "secret", async (_u, init) => {
    body = JSON.parse(String(init?.body));
    return json({ data: { setLabels: { labels: [{ name: "keep" }] } } });
  });
  return client.setLabels("1", ["keep", "instagram-unavailable"]).then(() => {
    assert.deepEqual((body as { variables: { input: unknown } }).variables.input, {
      pageId: "1",
      labels: [{ name: "keep" }, { name: "instagram-unavailable" }],
    });
  });
});

test("search reports a cursor only when there is another page", async () => {
  const withPage = (hasNextPage: boolean, endCursor: string | null) =>
    new OmnivoreClient("https://k.example/api/graphql", "secret", async () =>
      json({ data: { search: { pageInfo: { hasNextPage, endCursor }, edges: [] } } }));
  assert.equal((await withPage(true, "cursor-2").search("q", 10)).next, "cursor-2");
  assert.equal((await withPage(false, "cursor-2").search("q", 10)).next, null);
});

test("a rejected mutation inside a 200 throws instead of looking successful", () => {
  // Omnivore answers a refused write with HTTP 200 and errorCodes inside the
  // result union, not with a top-level "errors" array. Without this the writer
  // logs "retitled <id>" for a write that never happened.
  const client = new OmnivoreClient("https://k.example/api/graphql", "secret", async () =>
    json({ data: { updatePage: { errorCodes: ["UNAUTHORIZED"] } } }));
  return assert.rejects(() => client.updatePage("1", "t", "b"), /UNAUTHORIZED/);
});

test("a successful mutation is not mistaken for a rejection", () => {
  const client = new OmnivoreClient("https://k.example/api/graphql", "secret", async () =>
    json({ data: { updatePage: { updatedPage: { id: "1" } } } }));
  return client.updatePage("1", "t", "b");
});

test("a non-2xx response reports the status and the body", () => {
  const client = new OmnivoreClient("https://k.example/api/graphql", "secret", async () =>
    new Response("upstream exploded", { status: 502 }));
  return assert.rejects(() => client.search("q", 1), /502.*upstream exploded/s);
});

test("a search result that is absent reports the API, not a TypeError", () => {
  const client = new OmnivoreClient("https://k.example/api/graphql", "secret", async () =>
    json({ data: { search: null } }));
  return assert.rejects(() => client.search("q", 1), /Omnivore returned no search result/);
});
