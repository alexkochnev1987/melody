/** Only a bulk hint operation blocks all hint controls. Per-song work is independent. */
export type HintOperation = 'generate' | 'save';
export type HintTasks = Readonly<Record<string, HintOperation>>;
export const ALL_HINTS = 'all';
export const songHintKey = (index: number) => `song:${index}`;

export function canStartHintTask(tasks: HintTasks, key: string): boolean {
  if (tasks[ALL_HINTS]) return false;
  if (key === ALL_HINTS) return Object.keys(tasks).length === 0;
  return tasks[key] === undefined;
}
