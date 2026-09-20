import type { Config } from "./config.ts";
import type { Item, Library } from "./omnivore.ts";
import { buildTitle } from "./title.ts";

export type Logger = (message: string) => void;

export async function applyFound(
  library: Library, item: Item,
  found: { readonly author: string; readonly caption: string },
  config: Config, log: Logger = () => {},
): Promise<void> {
  const title = buildTitle(found.author, found.caption, config.titleMaxChars);
  if (config.dryRun) {
    log(`[dry-run] would retitle ${item.id} to "${title}" (byline ${found.author})`);
    return;
  }
  await library.updatePage(item.id, title, found.author);
  log(`retitled ${item.id} to "${title}"`);
}

export async function applyGone(
  library: Library, item: Item, config: Config, log: Logger = () => {},
): Promise<void> {
  if (item.labels.includes(config.giveUpLabel)) return;
  // setLabels REPLACES the label set, so send the existing labels back along
  // with ours. Omitting them would silently delete the user's own labels.
  const desired = [...item.labels, config.giveUpLabel];
  if (config.dryRun) {
    log(`[dry-run] would label ${item.id} as ${config.giveUpLabel}`);
    return;
  }
  await library.setLabels(item.id, desired);
  log(`labelled ${item.id} as ${config.giveUpLabel}`);
}
