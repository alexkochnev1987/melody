import { z } from 'zod';

export const songInput = z.object({
  title: z.string().trim().min(1).max(120),
  artist: z.string().trim().min(1).max(120),
  youtubeId: z.string().regex(/^[\w-]{11}$/),
  points: z.number().int().min(0).max(100000),
  startSeconds: z.number().int().min(0).max(86400).default(0),
  category: z.string().trim().min(1).max(60).default('Разное'),
  hints: z.array(z.string().trim().min(1).max(220)).max(3).default([]),
});
