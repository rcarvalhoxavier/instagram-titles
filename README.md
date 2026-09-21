# instagram-titles

*[Leia em português](README.pt-BR.md)*

If you self-host Omnivore, you have probably noticed that every Instagram link you save shows
up in your library titled, unhelpfully, `Instagram`. That happens because an anonymous request
to an Instagram page returns no `og:title` and no `og:description` for Omnivore to read - only
`og:site_name`, which is always just "Instagram". This tool finds those items, fetches the
author and caption from Instagram's public embed endpoint, and rewrites the title and byline so
the item actually tells you what it is.

## What it does not do

It does not download media, does not archive content, and does not use any Instagram
credentials - it only reads the same public embed HTML your browser would get for an
unauthenticated view of a post. Because of that, it can never resolve private accounts or
age-restricted posts. If a post you saved is private, expect its title to stay `Instagram`; that
is intentional, not a bug. Which of the three states below such a post actually falls into has
not been tested against a real private account, so this README does not claim one.

## Getting an API key

Everything below needs one. In Omnivore, go to **Settings - API Keys** and create a key. Give it
a name you will recognise, such as `instagram-titles`, so that you can revoke this one later
without disturbing anything else.

The key can read and write your entire library. Keep it out of shell history and out of any file
you commit: put it in the `.env` your stack already uses, or in a file with `chmod 600`, and
reference it rather than pasting it into commands.

## Running it once, from your own machine

This is the quickest way to see what the tool would do to your library, without installing
anything into your Omnivore stack. Start with `DRY_RUN=true`, which reads and logs but never
writes:

```bash
docker run --rm \
  -e OMNIVORE_API_URL=https://your-omnivore.example/api/graphql \
  -e OMNIVORE_API_KEY="$(cat ~/.config/instagram-titles.key)" \
  -e DRY_RUN=true \
  ghcr.io/rcarvalhoxavier/instagram-titles:latest
```

You get one line per item it would change, showing the title and byline it resolved:

```
cycle start: 5 candidate(s)
[dry-run] would retitle 1f26dba1-... to "3kg de molho de tomate por R$10!! ..." (byline ruimorschel)
cycle done: 5 found, 0 gone, 0 unknown
```

Read those lines. When you are happy with them, drop `DRY_RUN` and run it again to let it write.
It keeps running on a timer, so stop it with `Ctrl-C` once the first cycle finishes - or add
`-e MAX_PER_CYCLE=3` to touch only a few items the first time and check the result by hand.

If you would rather not use Docker, and you have Node.js 24 or later, the tool has no runtime
dependencies at all:

```bash
git clone https://github.com/rcarvalhoxavier/instagram-titles
cd instagram-titles
OMNIVORE_API_URL=https://your-omnivore.example/api/graphql \
OMNIVORE_API_KEY="$(cat ~/.config/instagram-titles.key)" \
DRY_RUN=true npm start
```

## Installing it into your Omnivore stack

This is the intended way to run it: alongside Omnivore, on a timer, quietly fixing new saves as
they arrive. Add the service below to the `docker-compose.yml` that already runs your stack, and
put `OMNIVORE_API_KEY=...` in the same `.env` that stack already reads. The full block is in
[`compose.example.yaml`](compose.example.yaml):

```yaml
services:
  instagram-titles:
    image: ghcr.io/rcarvalhoxavier/instagram-titles:latest
    container_name: instagram-titles
    environment:
      OMNIVORE_API_URL: http://api:8080/api/graphql
      OMNIVORE_API_KEY: ${OMNIVORE_API_KEY:?set this in your .env}
      DRY_RUN: "true"
    init: true
    restart: unless-stopped
```

Two details there are worth explaining.

`OMNIVORE_API_URL` points at `http://api:8080/api/graphql`, not at your public hostname. Inside
the compose network the tool reaches the `api` service directly, so the traffic never leaves the
host and does not depend on your reverse proxy or tunnel being up.

`init: true` matters more than it looks. Without it the process runs as PID 1, where default
signal handling means it ignores `SIGTERM` - so every `docker compose stop` waits out the full
timeout and then kills it.

Bring it up, watch one cycle, and only then let it write:

```bash
docker compose up -d instagram-titles
docker compose logs -f instagram-titles
```

When the dry-run output looks right, remove the `DRY_RUN` line (or set it to `"false"`) and run
`docker compose up -d instagram-titles` again.

## Developing

No build step, no bundler, no test framework. Node 24 runs the TypeScript directly by stripping
types, and the tests use the runner built into Node.

```bash
git clone https://github.com/rcarvalhoxavier/instagram-titles
cd instagram-titles
npm ci             # installs typescript and @types/node, nothing else
npm test           # node --test src/*.test.ts
npm run typecheck  # tsc --noEmit
```

The test suite never touches the network. `fixtures/` holds real embed pages captured from
Instagram - one for each response shape the resolver has to handle - plus one hand-written file
standing in for a blocked response. That one is labelled synthetic in its own comment, because no
real block has ever been observed to capture.

Two rules CI enforces, worth knowing before you send a patch:

- **`src/` and `scripts/` are pure ASCII.** Write non-ASCII characters as escapes (`"…"`,
  `"\u{1F680}"`), including inside comments. This is not fussiness: an invisible U+00A0 in a
  source file was once silently turned into a plain space when copied, breaking an exported
  function's contract while every test stayed green.
- **Only erasable TypeScript syntax.** No `enum`, no `namespace`, no parameter properties
  (`constructor(private x)`). Node's type stripping rejects them, and `tsc` is configured to
  refuse them before they reach anyone.

`scripts/probe-api.ts` is a diagnostic rather than part of the tool. It answers two questions
about a live Omnivore instance - how its search behaves, and whether `setLabels` replaces or adds
- and restores anything it changes:

```bash
OMNIVORE_API_URL=... OMNIVORE_API_KEY=... node scripts/probe-api.ts
```

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `OMNIVORE_API_URL` | *(required)* | GraphQL endpoint of your Omnivore instance. |
| `OMNIVORE_API_KEY` | *(required)* | API key used to authenticate to that endpoint. |
| `SCAN_INTERVAL` | `15m` | How long to wait between cycles. Accepts forms like `90s`, `15m`, `2h`; must be between 60s and 24h. |
| `MAX_PER_CYCLE` | `20` | Maximum number of items resolved per cycle. |
| `FETCH_RETRIES` | `3` | Retries per item against the embed endpoint before giving up. |
| `TITLE_MAX_CHARS` | `120` | Length at which a generated title is truncated at a word boundary. |
| `GENERIC_TITLE_PATTERN` | `^Instagram$` | Regular expression used to recognise an unfixed title. See the warning below the table before changing this. |
| `GIVE_UP_LABEL` | `instagram-unavailable` | Label applied when Instagram confirms a post is gone. |
| `UNKNOWN_RATIO_LIMIT` | `0.5` | Share of `unknown` results in a cycle above which the circuit breaker trips. |
| `MIN_SAMPLE_FOR_BREAKER` | `5` | Minimum number of items in a cycle before the breaker can trip. |
| `RETRY_LABELED` | `false` | When `true`, items already labelled `GIVE_UP_LABEL` are reconsidered. |
| `DRY_RUN` | `false` | When `true`, logs what would be written but writes nothing. |

Every value is checked at startup. A typo fails immediately with a message naming the variable,
rather than becoming a `NaN` that quietly makes the tool do nothing at all.

### One setting to be careful with

`GENERIC_TITLE_PATTERN` is the sole gate deciding which items get rewritten. The default is
anchored at both ends, so it matches the exact string `Instagram` and nothing else - not
`Instagram post`, not `instagram`, and not a title of your own that merely mentions Instagram.
Loosen it and the tool will overwrite titles you wrote yourself; it cannot tell yours apart from
one it placed. If you have spent time renaming Instagram saves by hand, that work is protected by
this pattern and by nothing else.

## How it decides

For every candidate item, the embed endpoint's response is classified into exactly one of three
states:

| State | Meaning | Effect |
| --- | --- | --- |
| `found` | An author marker was present; a caption may or may not be. | Title and byline are rewritten. |
| `gone` | Instagram's own "broken media" marker was present - it positively said the post is unavailable. | The item is labelled `GIVE_UP_LABEL` so it is not retried every cycle. |
| `unknown` | Neither marker was present, the response could not be parsed, or the request failed outright. | **Nothing is written.** |

`unknown` never writes, on purpose. It is the state where a temporary block, an Instagram HTML
format change, or a bug in this tool would land, and none of those should ever be mistaken for
"Instagram confirmed this post is gone." An item that comes back `unknown` simply keeps its
current title and is reconsidered on a later cycle.

Beyond that, a circuit breaker looks at the whole cycle, not just one item: once at least
`MIN_SAMPLE_FOR_BREAKER` items have been classified, if more than `UNKNOWN_RATIO_LIMIT` of them
came back `unknown`, the breaker trips and the entire cycle's decisions - including the ones that
came back `found` or `gone` - are discarded, with nothing written to your library. The idea is
that a sudden spike of `unknown` results is itself evidence something is wrong (a block, a
format change), and the correct response to "I can't tell what's happening" is to write nothing
until the next cycle, not to guess. This is the property that lets you trust this tool with a
library you did not otherwise want touched: it either gets a clear answer, or it stays quiet.

## Notes

Two design questions were resolved against a live Omnivore instance rather than guessed at
(`scripts/probe-api.ts` runs this check yourself):

- Omnivore's `search` query (`in:all instagram.com`) is a text match against saved pages, not a
  strict host filter - it narrows the candidates well enough to be useful, but it can still
  return non-Instagram items. That is why the tool re-filters every result client-side
  (`selector.ts`'s `needsFix`) before treating anything as a candidate.
- `setLabels` **replaces** an item's full label set rather than adding to it. This is why the
  tool always reads an item's existing labels before writing new ones: writing labels naively
  would silently erase any labels you had already applied by hand.

## Being a good citizen

The default 15-minute interval, the per-cycle cap of 20 items, and the 1.5-second pause between
requests to the embed endpoint all exist for the same reason: so that this tool, multiplied
across however many people run it, does not add up to hammering Instagram's infrastructure.
Please do not lower these values without a real reason to - the tool has no urgency; your library
will get fixed a few items at a time, cycle after cycle, without anyone needing to notice.

## Licence

MIT. See [LICENSE](LICENSE).
