export type HintUpdate = {
  index: number;
  title: string;
  artist: string;
  youtubeId: string;
  hints: string[];
};

/** Returns a new songs array with ONLY the specified hints changed.
 * Optimistic identity check prevents applying a stale index after a song reorder.
 */
export function replaceSongHints<T extends { title: string; artist: string; youtubeId: string; hints?: string[] }>(
  songs: T[],
  updates: HintUpdate[],
): T[] {
  if (new Set(updates.map(item => item.index)).size !== updates.length) {
    throw new Error('Одна песня указана несколько раз');
  }
  const copy = songs.map(song => ({ ...song }));
  for (const update of updates) {
    const current = copy[update.index];
    if (!current ||
      current.title !== update.title ||
      current.artist !== update.artist ||
      current.youtubeId !== update.youtubeId) {
      throw new Error('Список песен изменился. Обновите игру перед сохранением подсказок');
    }
    copy[update.index] = { ...current, hints: [...update.hints] };
  }
  return copy;
}
