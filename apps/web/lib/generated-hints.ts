import { z } from 'zod';

/** Only object/array primitives are used in the wire schema for OpenAI Structured Outputs.
 * Length validation is applied AFTER generation: strict OpenAI schema does not accept
 * tuple "prefixItems" or all of Zod's string-size JSON Schema keywords.
 */
export const generatedHintsSchema = z.object({
  songs: z.array(z.object({
    index: z.number().int(),
    hints: z.object({
      first: z.string(),
      second: z.string(),
      third: z.string(),
    }),
  })),
});

const hintText = z.string().trim().min(1).max(220);
export function cleanGeneratedHints(
  value: { first: string; second: string; third: string } | undefined,
  title: string,
  artist: string,
): string[] | null {
  if (!value) return null;
  const parsed = z.array(hintText).length(3).safeParse([value.first, value.second, value.third]);
  if (!parsed.success) return null;
  const normalize = (text: string) => text.toLocaleLowerCase('ru').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const secrets = [title, artist].map(normalize).filter(text => text.length >= 3);
  if (parsed.data.some(hint => secrets.some(secret => normalize(hint).includes(secret)))) return null;
  return parsed.data;
}
