import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database } from '@/lib/db';
import { getAuth } from '@/lib/auth';
import { createGame } from '@/lib/game';
import { songInput } from '@/lib/song-input';
import { replaceSongHints } from '@/lib/replace-song-hints';

const song = songInput;
const hintUpdate = z.object({
  index: z.number().int().min(0).max(99),
  title: z.string().min(1).max(120),
  artist: z.string().min(1).max(120),
  youtubeId: z.string().max(40),
  hints: z.array(z.string().trim().min(1).max(220)).max(3),
  introHint: z.string().trim().max(220).optional(),
});
const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('saveHints'), id: z.string().min(1), updates: z.array(hintUpdate).min(1).max(100) }),
  z.object({ action: z.literal('save'), id: z.string().optional(), title: z.string().trim().min(1).max(100), description: z.string().max(500), songs: z.array(song).max(100) }),
  z.object({ action: z.literal('copy'), id: z.string().min(1) }),
  z.object({ action: z.literal('start'), id: z.string().min(1) }),
]);
type Song = z.infer<typeof song>;
type GameSet = { id: string; owner_id: string | null; title: string; description: string; songs: Song[] };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(req: Request) {
  const session = await (await getAuth()).api.getSession({ headers: req.headers });
  const db = await database();
  const result = await db.query<GameSet>('SELECT id, owner_id, title, description, songs FROM game_sets WHERE owner_id IS NULL OR owner_id = $1 ORDER BY owner_id NULLS FIRST, updated_at DESC', [session?.user.id ?? '']);
  return json({ games: result.rows, googleConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET), user: session?.user ? { id: session.user.id, name: session.user.name, email: session.user.email } : null });
}

export async function POST(req: Request) {
  try {
    const session = await (await getAuth()).api.getSession({ headers: req.headers });
    if (!session) return json({ error: 'Сначала войдите в аккаунт' }, 401);
    const body = bodySchema.parse(await req.json());
    const db = await database();
    if (body.action === 'saveHints') {
      return db.transaction(async tx => {
        const stored = (await tx.query<Pick<GameSet, 'songs'>>(
          'SELECT songs FROM game_sets WHERE id=$1 AND owner_id=$2 FOR UPDATE',
          [body.id, session.user.id],
        )).rows[0];
        if (!stored) return json({ error: 'Игра не найдена или нет доступа' }, 403);
        let updated: Song[];
        try {
          updated = replaceSongHints(stored.songs, body.updates);
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : 'Список песен изменился' }, 409);
        }
        await tx.query('UPDATE game_sets SET songs=$3, updated_at=now() WHERE id=$1 AND owner_id=$2', [
          body.id, session.user.id, JSON.stringify(updated),
        ]);
        return json({ updated: body.updates.length });
      });
    }
    if (body.action === 'save') {
      if (!body.id) {
        const id = randomUUID();
        await db.query('INSERT INTO game_sets(id, owner_id, title, description, songs) VALUES ($1,$2,$3,$4,$5)', [id, session.user.id, body.title, body.description, JSON.stringify(body.songs)]);
        return json({ id }, 201);
      }
      const result = await db.query<{ id: string }>('UPDATE game_sets SET title=$3, description=$4, songs=$5, updated_at=now() WHERE id=$1 AND owner_id=$2 RETURNING id', [body.id, session.user.id, body.title, body.description, JSON.stringify(body.songs)]);
      return result.rows[0] ? json(result.rows[0]) : json({ error: 'Игру нельзя изменить' }, 403);
    }
    const selected = (await db.query<GameSet>('SELECT id, owner_id, title, description, songs FROM game_sets WHERE id=$1 AND (owner_id IS NULL OR owner_id=$2)', [body.id, session.user.id])).rows[0];
    if (!selected) return json({ error: 'Игра не найдена' }, 404);
    if (body.action === 'copy') {
      const id = randomUUID();
      await db.query('INSERT INTO game_sets(id,owner_id,title,description,songs) VALUES ($1,$2,$3,$4,$5)', [id, session.user.id, selected.title + ' — копия', selected.description, JSON.stringify(selected.songs)]);
      return json({ id }, 201);
    }
    if (!selected.songs.length) return json({ error: 'Добавьте хотя бы одну песню' }, 400);
    const songs = z.array(song).min(1).parse(selected.songs);
    const room = randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
    const hostToken = randomBytes(32).toString('base64url');
    const game = createGame(room, songs.map(s => ({ ...s, id: randomUUID() })), session.user.id);
    await db.query('INSERT INTO rooms(id,host_token,state) VALUES ($1,$2,$3)', [room, hostToken, JSON.stringify(game)]);
    return json({ room, token: hostToken }, 201);
  } catch (err) {
    return json({ error: err instanceof z.ZodError ? 'Проверьте название, песни и YouTube ID' : 'Не удалось выполнить действие' }, 400);
  }
}
