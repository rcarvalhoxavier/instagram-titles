/**
 * Answer the two open questions in the design, against a real instance.
 *
 *   OMNIVORE_API_URL=... OMNIVORE_API_KEY=... node scripts/probe-api.ts [itemId]
 *
 * Q1 and Q3 are read-only. Q2 writes labels to the item you name and restores
 * them; Q3 writes a title to a throwaway item it creates and then removes.
 *
 * Read-only, except for the label round-trip, which runs only when you pass an
 * item id and which restores the original labels afterwards.
 */
const url = process.env["OMNIVORE_API_URL"];
const key = process.env["OMNIVORE_API_KEY"];
if (!url || !key) {
  console.error("set OMNIVORE_API_URL and OMNIVORE_API_KEY");
  process.exit(2);
}

async function call(query: string, variables: Record<string, unknown>): Promise<Record<string, any>> {
  const response = await fetch(url!, {
    method: "POST",
    headers: { Authorization: key!, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  return (await response.json()) as Record<string, any>;
}

const SEARCH = `query S($q:String!,$n:Int!){search(query:$q,first:$n){
  ... on SearchSuccess{edges{node{id title url labels{name}}}}
  ... on SearchError{errorCodes}}}`;

const SET_LABELS = `mutation M($input:SetLabelsInput!){setLabels(input:$input){
  ... on SetLabelsSuccess{labels{name}}
  ... on SetLabelsError{errorCodes}}}`;

console.log("=== Q1: does search support filtering by host? ===");
for (const candidate of ["in:all instagram.com", "in:all site:instagram.com", "instagram.com"]) {
  const payload = await call(SEARCH, { q: candidate, n: 5 });
  const edges = payload?.data?.search?.edges;
  if (!Array.isArray(edges)) {
    console.log(`  ${JSON.stringify(candidate).padEnd(34)} -> ERROR`, JSON.stringify(payload?.data?.search));
    continue;
  }
  console.log(`  ${JSON.stringify(candidate).padEnd(34)} -> ${edges.length} hits`);
  for (const edge of edges.slice(0, 3)) {
    console.log(`      ${String(edge.node.title).slice(0, 40)}  ${String(edge.node.url).slice(0, 60)}`);
  }
}

console.log("\n=== Q2: does setLabels REPLACE or ADD? ===");
const itemId = process.argv[2];
if (!itemId) {
  console.log("  skipped: pass the id of an item that already has >=1 label as argv[2]");
}

async function labelsOf(id: string): Promise<string[] | null> {
  const payload = await call(SEARCH, { q: "in:all", n: 100 });
  for (const edge of payload?.data?.search?.edges ?? []) {
    if (edge.node.id === id) return (edge.node.labels ?? []).map((l: { name: string }) => l.name);
  }
  return null;
}

const before = itemId ? await labelsOf(itemId) : null;
if (itemId) {
  console.log(`  labels before: ${JSON.stringify(before)}`);
  if (!before?.length) {
    console.log("  pick an item that already has at least one label, or Q2 proves nothing");
  }
}
if (itemId && before?.length) {

// try/finally so the original labels come back even if the comparison throws:
// this script writes to a real library, and the README promises it restores.
let after: string[] | null = null;
try {
  await call(SET_LABELS, { input: { pageId: itemId, labels: [{ name: "probe-temporary" }] } });
  after = await labelsOf(itemId);
} finally {
  await call(SET_LABELS, { input: { pageId: itemId, labels: before.map((name) => ({ name })) } });
}
console.log(`  labels after : ${JSON.stringify(after)}`);
const lost = before.filter((label) => !(after ?? []).includes(label));
console.log();
console.log(lost.length > 0
  ? "  VERDICT: REPLACE. Read-before-write is mandatory."
  : "  VERDICT: ADD. Read-before-write is harmless, keep it anyway.");

  console.log(`  restored to  : ${JSON.stringify(await labelsOf(itemId))}`);
}

console.log("\n=== Q3: does updatePage preserve fields it was not sent? ===");

// The same question setLabels turned out to answer surprisingly. updatePage
// sends three fields and is the mutation behind most of this tool's writes,
// so "does it blank description, savedAt and the rest" has to be measured
// rather than assumed. Uses a throwaway item; never touches a real one.
const DETAIL = `query S($q:String!,$n:Int!){search(query:$q,first:$n){
  ... on SearchSuccess{edges{node{id url title description savedAt siteName}}}}}`;

async function itemByUrl(target: string): Promise<Record<string, any> | undefined> {
  const payload = await call(DETAIL, { q: "in:all", n: 80 });
  return (payload?.data?.search?.edges ?? [])
    .map((edge: { node: Record<string, any> }) => edge.node)
    .find((node: Record<string, any>) => node.url === target);
}

const throwaway = `https://example.com/updatepage-probe-${Date.now()}`;
await call(
  `mutation S($i:SaveUrlInput!){saveUrl(input:$i){... on SaveSuccess{url} ... on SaveError{errorCodes}}}`,
  { i: { url: throwaway, source: "api", clientRequestId: crypto.randomUUID() } },
);

let probe: Record<string, any> | undefined;
for (let attempt = 0; attempt < 14 && probe === undefined; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  probe = await itemByUrl(throwaway);
}

if (probe === undefined) {
  console.log("  the throwaway item never appeared in search; skipping Q3");
} else {
  const before = { ...probe };
  try {
    await call(
      `mutation U($i:UpdatePageInput!){updatePage(input:$i){
        ... on UpdatePageSuccess{updatedPage{id}} ... on UpdatePageError{errorCodes}}}`,
      { i: { pageId: probe["id"], title: "probe title", byline: "probe-author" } },
    );
    const after = await itemByUrl(throwaway);
    const blanked = ["description", "savedAt", "siteName"].filter(
      (field) => before[field] !== null && (after?.[field] ?? null) === null,
    );
    console.log(`  title after : ${JSON.stringify(after?.["title"])}`);
    console.log(
      blanked.length === 0
        ? "  VERDICT: PRESERVES. Sending three fields does not blank the others."
        : `  VERDICT: BLANKS ${blanked.join(", ")}. Read before writing.`,
    );
  } finally {
    await call(
      `mutation D($id:ID!){setBookmarkArticle(input:{articleID:$id,bookmark:false}){
        ... on SetBookmarkArticleSuccess{bookmarkedArticle{id}} ... on SetBookmarkArticleError{errorCodes}}}`,
      { id: probe["id"] },
    );
    console.log("  throwaway item removed");
  }
}
