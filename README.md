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
credentials - it only reads Instagram's public embed endpoint, the same one any site uses to
show an embedded post, and it identifies itself as `instagram-titles` when it does. Because of
that, it can never resolve private accounts or age-restricted posts. If a post you saved is private, expect its title to stay `Instagram`; that
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
OMNIVORE_API_KEY=$(cat ~/.config/instagram-titles.key) \
docker run --rm --init \
  -e OMNIVORE_API_URL=https://your-omnivore.example/api/graphql \
  -e OMNIVORE_API_KEY \
  -e DRY_RUN=true \
  ghcr.io/rcarvalhoxavier/instagram-titles:latest
```

Naming `OMNIVORE_API_KEY` without a value passes it through from the environment, so the key never
appears in the container's command line where `ps` would show it to every local user. `--init` is
what makes `Ctrl-C` stop it promptly; the section below explains why.

You get one line per item it would change, showing the title and byline it resolved:

```
2026-09-21T12:55:13.302Z INFO  starting; interval=900s max_per_cycle=20 dry_run=true
2026-09-21T12:55:13.600Z INFO  cycle start: 5 candidate(s)
2026-09-21T12:55:21.940Z INFO  [dry-run] would retitle 1f26dba1-... to "3kg de molho de tomate por R$10!! ..." (byline ruimorschel)
2026-09-21T12:55:22.100Z INFO  cycle done: 5 found, 0 gone, 0 unknown
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
put `OMNIVORE_API_KEY=...` in the same `.env` that stack already reads - with one caveat
if your services use `env_file`, described below. The full block is in
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

`:latest` follows every release. To pin a version, use the number **without** the `v` -
`ghcr.io/rcarvalhoxavier/instagram-titles:0.1.0`. The git tag is `v0.1.0` and the image tag is
`0.1.0`; that is the Docker convention and the only spelling published, so `:v0.1.0` will not
resolve.

Two details there are worth explaining.

`OMNIVORE_API_URL` points at `http://api:8080/api/graphql`, not at your public hostname. Inside
the compose network the tool reaches the `api` service directly, so the traffic never leaves the
host and does not depend on your reverse proxy or tunnel being up.

`init: true` is there to reap zombie processes, which is what an init is for. It used to be load
bearing for a second reason - the container took the full stop timeout to die - but that is now
fixed in the tool itself rather than worked around here. The cause was specific and both obvious
explanations were wrong: Node *does* install a `SIGTERM` handler, and the pending timer was *not*
what kept the process alive. With no JavaScript listener registered, Node's handler restores the
default disposition and re-raises the signal at itself, and a default-disposition signal is
exactly what the kernel refuses to deliver to PID 1. `main.ts` now registers a listener, so the
re-raise never happens. Measured on this image: **11 seconds to stop before, 1 second after, with
or without an init**.

### If your compose file uses `env_file`

The block above reads the key by interpolation: Compose substitutes `${OMNIVORE_API_KEY}` from
the `.env` beside your compose file, and only this service ends up holding it. The upstream
Omnivore compose file declares `environment:` service by service, so with it nothing else
changes and the paragraph above is all you need.

If your stack has been adapted so that services load the whole file with `env_file: .env`, the
picture is different. `env_file` injects *every* variable in the file into *every* service that
lists it, so putting the key there hands your `api`, `web` and `queue-processor` containers a
credential that reads and writes your entire library - and Compose recreates each of them,
because their environment changed.

Give the key a file of its own in that case, and point only this service at it:

```yaml
    env_file:
      - .env.instagram-titles
    environment:
      OMNIVORE_API_URL: http://api:8080/api/graphql
```

Measured on a stack adapted that way: with the key in the shared `.env`, `docker inspect` on the
`api` container listed `OMNIVORE_API_KEY`; after moving it to its own file, it did not.

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
npm ci             # typescript, @types/node, and their two transitive packages
npm test           # node --test src/*.test.ts
npm run typecheck  # tsc --noEmit
```

The test suite never touches the network. `fixtures/` holds real embed pages captured from
Instagram - one for each response shape the resolver has to handle - plus one hand-written file
standing in for a blocked response. That one is labelled synthetic in its own comment, because no
real block has ever been observed to capture.

Two rules CI enforces, worth knowing before you send a patch:

- **`src/` and `scripts/` are pure ASCII.** Write non-ASCII characters as escapes (`"\u2026"`,
  `"\u{1F680}"`), including inside comments. This is not fussiness: an invisible U+00A0 in a
  source file was once silently turned into a plain space when copied, breaking an exported
  function's contract while every test stayed green.
- **Only erasable TypeScript syntax.** No `enum`, no `namespace`, no parameter properties
  (`constructor(private x)`). Node's type stripping rejects them, and `tsc` is configured to
  refuse them before they reach anyone.

`scripts/probe-api.ts` is a diagnostic rather than part of the tool. It answers two questions
about a live Omnivore instance - how its search behaves, whether `setLabels` replaces or adds, and
whether `updatePage` preserves the fields it is not sent - and restores anything it changes:

```bash
OMNIVORE_API_URL=... OMNIVORE_API_KEY=... node scripts/probe-api.ts
```

## How the code is laid out

Nine small modules, each with one job, arranged as a pipeline. If something is broken, this tells
you which file to open.

| Module | Job |
| --- | --- |
| `config.ts` | Reads and validates every setting. Owns every default; nothing else has one. |
| `selector.ts` | Decides which library items may be touched. The safety boundary. |
| `fetcher.ts` | The only module that talks to Instagram. URL to HTML, with retries. |
| `resolver.ts` | Pure. HTML to `found` / `gone` / `unknown`. No network, no clock. |
| `title.ts` | Pure. Author plus caption to the title string. |
| `writer.ts` | The only module that writes to your library. |
| `omnivore.ts` | The GraphQL client, and the `Library` contract the others depend on. |
| `cycle.ts` | One pass: select, resolve everything, then write - with the breaker in between. |
| `main.ts` | Configuration, the loop, and the timer. 40 lines. |

A change almost always lands in exactly one of them. **Instagram changed its HTML** is the failure
this tool exists to survive, and it lands in `resolver.ts` - start there, and read
`resolver.test.ts` alongside it, since the fixtures show what the two page shapes look like.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `OMNIVORE_API_URL` | *(required)* | GraphQL endpoint of your Omnivore instance. |
| `OMNIVORE_API_KEY` | *(required)* | API key used to authenticate to that endpoint. |
| `SCAN_INTERVAL` | `15m` | How long to wait between cycles. Accepts `90s`, `15m`, `2h`, or a plain number of seconds; must be between 60s and 24h. |
| `MAX_PER_CYCLE` | `20` | Maximum number of items resolved per cycle. |
| `FETCH_RETRIES` | `3` | Total attempts per item against the embed endpoint, not retries after the first. `1` means a single try. |
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

Three design questions were resolved against a live Omnivore instance rather than guessed at
(`scripts/probe-api.ts` runs these checks yourself):

- Omnivore's `search` query (`in:all instagram.com`) is a text match against saved pages, not a
  strict host filter - it narrows the candidates well enough to be useful, but it can still
  return non-Instagram items. That is why the tool re-filters every result client-side
  (`selector.ts`'s `needsFix`) before treating anything as a candidate.
- `setLabels` **replaces** an item's full label set rather than adding to it. This is why the
  tool always reads an item's existing labels before writing new ones: writing labels naively
  would silently erase any labels you had already applied by hand.
- `updatePage` does the opposite: it **preserves** the fields you do not send. The tool sends only
  a title and a byline, and an item's description, saved date and site name survive untouched.
  This was measured rather than assumed, because `setLabels` had already shown that the intuitive
  answer can be the wrong one.

### How Instagram decides what to send us

The embed endpoint answers with a JavaScript app shell, not the embed, whenever it can parse the
`User-Agent` as a known browser family carrying a version - `Chrome/<v> Safari/<v>` and
`Firefox/<v>` both get the shell. Everything else gets the server-rendered embed, including a
plain `Mozilla/5.0`, an arbitrary identifier, and no `User-Agent` header at all. Removing just the
version from an otherwise identical Chrome string flips the response back to the embed, which is
the signature of a real user-agent parser rather than a substring blocklist.

That reads as a rendering decision rather than an anti-bot one: there is no point sending a
JavaScript shell to a client that will not run it. It is also why this tool's identifier is safe
structurally rather than by luck - it carries no versioned browser-family token. If you edit it,
that is the one thing to avoid.

Measured across 17 variants against one post, from one IP, with one TLS client. The contrast
within the batch was clean and a control was re-run afterwards to rule out drift, but none of that
proves the behaviour holds from a different network.

Either way the failure mode is safe by construction: an app shell carries no author marker and no
broken-media marker, so it lands in `unknown`, the circuit breaker trips, and nothing is written.
Fragility here costs availability, never correctness.
## Being a good citizen

The default 15-minute interval, the per-cycle cap of 20 items, and the 1.5-second pause between
requests to the embed endpoint all exist for the same reason: so that this tool, multiplied
across however many people run it, does not add up to hammering Instagram's infrastructure.
Please do not lower these values without a real reason to - the tool has no urgency; your library
will get fixed a few items at a time, cycle after cycle, without anyone needing to notice.

It also reads from your own Omnivore: up to 20 pages of 100 items per cycle while there is still
work to find, and nothing once the library is clean. Requests to Instagram carry a 20-second
timeout and back off two seconds per attempt; if the circuit breaker trips, the next cycle waits a
full extra hour rather than retrying a peer that is already refusing us.


## Licence

MIT. See [LICENSE](LICENSE).
