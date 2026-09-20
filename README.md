# instagram-titles

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

## Requirements

- Running outside a container: Node.js 24 or later. No dependencies to install.
- Running the image: nothing beyond Docker (or Podman) itself.

## Install

Add the service below to the compose file that already runs your Omnivore stack, set
`OMNIVORE_API_KEY` in your `.env`, and point `OMNIVORE_API_URL` at your instance's GraphQL
endpoint (see `compose.example.yaml` for the full block):

```yaml
services:
  instagram-titles:
    image: ghcr.io/rcarvalhoxavier/instagram-titles:latest
    container_name: instagram-titles
    environment:
      OMNIVORE_API_URL: http://api:8080/api/graphql
      OMNIVORE_API_KEY: ${OMNIVORE_API_KEY:?set this in your .env}
      DRY_RUN: "true"
    restart: unless-stopped
```

`OMNIVORE_API_URL` and `OMNIVORE_API_KEY` are the only two variables you must set; everything
else has a default.

Start with `DRY_RUN=true`. Let it run one cycle, read the logs to see what it would have
changed, and only then remove the variable (or set it to `false`) to let it write.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `OMNIVORE_API_URL` | *(required)* | GraphQL endpoint of your Omnivore instance. |
| `OMNIVORE_API_KEY` | *(required)* | API key used to authenticate to that endpoint. |
| `SCAN_INTERVAL` | `15m` | How long to wait between cycles. Accepts forms like `30s`, `15m`, `2h`. |
| `MAX_PER_CYCLE` | `20` | Maximum number of items resolved per cycle. |
| `FETCH_RETRIES` | `3` | Retries per item against the embed endpoint before giving up. |
| `TITLE_MAX_CHARS` | `120` | Length at which a generated title is truncated at a word boundary. |
| `GENERIC_TITLE_PATTERN` | `^Instagram$` | Regular expression used to recognise an unfixed title. See the warning below the table before changing this. |
| `GIVE_UP_LABEL` | `instagram-unavailable` | Label applied when Instagram confirms a post is gone. |
| `UNKNOWN_RATIO_LIMIT` | `0.5` | Share of `unknown` results in a cycle above which the circuit breaker trips. |
| `MIN_SAMPLE_FOR_BREAKER` | `5` | Minimum number of items in a cycle before the breaker can trip. |
| `RETRY_LABELED` | `false` | When `true`, items already labelled `GIVE_UP_LABEL` are reconsidered. |
| `DRY_RUN` | `false` | When `true`, logs what would be written but writes nothing. |

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

- Omnivore's `search` query does filter by host, so restricting the search to Instagram links
  server-side works as expected.
- `setLabels` **replaces** an item's full label set rather than adding to it. This is why the
  tool always reads an item's existing labels before writing new ones: writing labels naively
  would silently erase any labels you had already applied by hand.

## Being a good citizen

The default 15-minute interval, the per-cycle cap of 20 items, and the 1.5-second pause between
requests to the embed endpoint all exist for the same reason: so that this tool, multiplied
across however many people run it, does not add up to hammering Instagram's infrastructure.
Please do not lower these values without a real reason to - the tool has no urgency; your library
will get fixed a few items at a time, cycle after cycle, without anyone needing to notice.
