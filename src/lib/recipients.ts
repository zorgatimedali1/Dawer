import { seededShuffle } from './shuffle';

interface BatchItem {
  id: string;
}

export interface BatchPick {
  /** Selected ids (id list of the recipients that get marked as chosen). */
  ids: string[];
  /** True when the list was trimmed down to the plan's batch limit. */
  capped: boolean;
  /** How many items the list had before the trim (only set when capped). */
  total: number;
}

/**
 * "Select all" for broadcast pickers.
 *
 * `batchLimit` comes from the plan (0 = unlimited). When the full list fits,
 * every item is selected; when it would overflow the per-broadcast ceiling,
 * exactly `batchLimit` items are picked at random so the merchant can send
 * immediately instead of trimming the selection by hand.
 */
export function selectWithinBatch<T extends BatchItem>(items: readonly T[], batchLimit: number): BatchPick {
  if (batchLimit <= 0 || items.length <= batchLimit) {
    return { ids: items.map((item) => item.id), capped: false, total: items.length };
  }
  const picked = seededShuffle(items, Math.floor(Math.random() * 0x8000_0000)).slice(0, batchLimit);
  return { ids: picked.map((item) => item.id), capped: true, total: items.length };
}
