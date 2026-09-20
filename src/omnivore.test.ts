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
  assert.deepEqual(await client.search("q", 10), [{
    id: "1", url: "https://www.instagram.com/p/AAA/", title: "Instagram", labels: ["keep"],
  }]);
});

test("search tolerates null labels and null title", async () => {
  const client = new OmnivoreClient("https://k.example/api/graphql", "secret", async () =>
    json({ data: { search: { edges: [{ node: {
      id: "1", title: null, url: "https://www.instagram.com/p/AAA/", labels: null,
    } }] } } }));
  const [item] = await client.search("q", 10);
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
