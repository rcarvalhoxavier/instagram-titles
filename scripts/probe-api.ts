/**
 * Answer the two open questions in the design, against a real instance.
 *
 *   OMNIVORE_API_URL=... OMNIVORE_API_KEY=... node scripts/probe-api.ts [itemId]
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

async function call(query: string, variables: Record<string, unknown>): Promise<any> {
  const response = await fetch(url!, {
    method: "POST",
    headers: { Authorization: key!, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  return await response.json();
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
  process.exit(0);
}

async function labelsOf(id: string): Promise<string[] | null> {
  const payload = await call(SEARCH, { q: "in:all", n: 100 });
  for (const edge of payload?.data?.search?.edges ?? []) {
    if (edge.node.id === id) return (edge.node.labels ?? []).map((l: { name: string }) => l.name);
  }
  return null;
}

const before = await labelsOf(itemId);
console.log(`  labels before: ${JSON.stringify(before)}`);
if (!before?.length) {
  console.log("  pick an item that already has at least one label, or Q2 proves nothing");
  process.exit(0);
}

await call(SET_LABELS, { input: { pageId: itemId, labels: [{ name: "probe-temporary" }] } });
const after = await labelsOf(itemId);
console.log(`  labels after : ${JSON.stringify(after)}`);
const lost = before.filter((label) => !(after ?? []).includes(label));
console.log();
console.log(lost.length > 0
  ? "  VERDICT: REPLACE. Read-before-write is mandatory (design risk #1)."
  : "  VERDICT: ADD. Read-before-write is harmless, keep it anyway.");

await call(SET_LABELS, { input: { pageId: itemId, labels: before.map((name) => ({ name })) } });
console.log(`  restored to  : ${JSON.stringify(await labelsOf(itemId))}`);
