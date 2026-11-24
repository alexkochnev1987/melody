import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database } from '@/lib/db';
import { applyCommand, createGame, publicGame, type Game, type Command } from '@/lib/game';
import { getAuth } from '@/lib/auth';
import { songInput } from '@/lib/song-input';
import { getGuestIdentity } from '@/lib/guest-identity';

const requestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), songs: z.array(songInput).min(1).max(100), startingPoints: z.number().int().min(1).max(100000).default(300) }),
  z.object({ action: z.literal('join'), room: z.string().length(6), name: z.string().trim().min(1).max(40) }),
  z.object({ action: z.literal('command'), room: z.string().length(6), command: z.discriminatedUnion('type', [
    z.object({ type: z.literal('start'), id: z.string().uuid() }),
    z.object({ type: z.literal('buzz'), id: z.string().uuid(), songId: z.string().uuid() }),
    z.object({ type: z.literal('judge'), id: z.string().uuid(), correct: z.boolean(), playerId: z.string().optional() }),
    z.object({ type: z.literal('resume'), id: z.string().uuid() }),
    z.object({ type: z.literal('adjust'), id: z.string().uuid(), playerId: z.string(), delta: z.number().int(), reason: z.string() }),
    z.object({ type: z.literal('choose'), id: z.string().uuid(), songId: z.string().uuid() }),
    z.object({ type: z.literal('playback'), id: z.string().uuid(), songId: z.string().uuid(), active: z.boolean() }),
    z.object({ type: z.literal('bid'), id: z.string().uuid(), songId: z.string().uuid(),
      points: z.number().int().min(0).max(100000), seconds: z.number().int().min(2) }),
    z.object({ type: z.literal('closeBidding'), id: z.string().uuid() }),
    z.object({ type: z.literal('allowChoice'), id: z.string().uuid() }),
    z.object({ type: z.literal('expire'), id: z.string().uuid(), songId: z.string().uuid() }),
    z.object({ type: z.literal('hint'), id: z.string().uuid() }),
    z.object({ type: z.literal('skip'), id: z.string().uuid() }),
    z.object({ type: z.literal('next'), id: z.string().uuid() }),
  ]) }),
]);
type Row = { state: Game; host_token: string };
const reply = (data: unknown, status = 200, setCookie?: string) => Response.json(data, {
  status,
  headers: { 'Cache-Control': 'private, no-store', ...(setCookie ? { 'Set-Cookie': setCookie } : {}) },
});
const token = (req: Request) => req.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
const secret = () => randomBytes(32).toString('base64url');

export async function GET(req: Request) {
  const room = new URL(req.url).searchParams.get('room')?.toUpperCase();
  if (!room || !/^[A-Z0-9]{6}$/.test(room)) return reply({ error: 'Неверный код комнаты' }, 400);
  const db = await database();
  const row = (await db.query<Row>('SELECT state, host_token FROM rooms WHERE id = $1', [room])).rows[0];
  if (!row) return reply({ error: 'Комната не найдена' }, 404);
  return reply(token(req) && token(req) === row.host_token
    ? { ...publicGame(row.state), hostSong: row.state.songs[row.state.songIndex] }
    : publicGame(row.state));
}

export async function POST(req: Request) {
  try {
    const body = requestSchema.parse(await req.json());
    const db = await database();
    if (body.action === 'create') {
      const session = await (await getAuth()).api.getSession({ headers: req.headers });
      if (!session) return reply({ error: 'Чтобы создать комнату, войдите через Google в разделе «Мои игры».' }, 401);
      const room = randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
      const hostToken = secret();
      const game = createGame(room, body.songs.map(s => ({ ...s, id: randomUUID() })), session.user.id, body.startingPoints);
      await db.query('INSERT INTO rooms (id, host_token, state) VALUES ($1,$2,$3)', [room, hostToken, JSON.stringify(game)]);
      return reply({ room, token: hostToken }, 201);
    }
    return await db.transaction(async tx => {
      const row = (await tx.query<Row>('SELECT state, host_token FROM rooms WHERE id = $1 FOR UPDATE', [body.room])).rows[0];
      if (!row) return reply({ error: 'Комната не найдена' }, 404);
      if (body.action === 'join') {
        const identity = getGuestIdentity(req);
        const existingId = row.state.identityHashes?.[identity.hash];
        if (existingId) {
          // A returning guest can recover their original room participant
          // using their HttpOnly browser identity, without doubling their score.
          const existing = (await tx.query<{ token: string }>(
            'SELECT token FROM room_players WHERE room_id=$1 AND player_id=$2',
            [body.room, existingId],
          )).rows[0];
          if (!existing) return reply({ error: 'Не удалось восстановить участника' }, 409);
          return reply({ room: body.room, token: existing.token, playerId: existingId, restored: true },
            200, identity.setCookie);
        }
        const playerId = randomUUID(), playerToken = secret();
        const game = applyCommand(row.state, {
          type: 'join', id: randomUUID(), playerId, name: body.name, identityHash: identity.hash,
        });
        await tx.query('INSERT INTO room_players (room_id,token,player_id) VALUES ($1,$2,$3)', [body.room, playerToken, playerId]);
        await tx.query('UPDATE rooms SET state=$2 WHERE id=$1', [body.room, JSON.stringify(game)]);
        return reply({ room: body.room, token: playerToken, playerId }, 200, identity.setCookie);
      }
      let command: Command;
      if (body.command.type === 'buzz' || body.command.type === 'choose' || body.command.type === 'bid') {
        const isHost = token(req) && token(req) === row.host_token;
        if (body.command.type === 'choose' && isHost) {
          command = body.command;
        } else {
          const player = (await tx.query<{ player_id: string }>(
            'SELECT player_id FROM room_players WHERE room_id=$1 AND token=$2',
            [body.room, token(req)],
          )).rows[0];
          if (!player) return reply({ error: 'Нет доступа игрока' }, 403);
          command = { ...body.command, playerId: player.player_id };
        }
      } else {
        if (!token(req) || token(req) !== row.host_token) return reply({ error: 'Нет доступа ведущего' }, 403);
        command = body.command;
      }
      const game = applyCommand(row.state, command);
      await tx.query('UPDATE rooms SET state=$2 WHERE id=$1', [body.room, JSON.stringify(game)]);
      return reply(publicGame(game));
    });
  } catch (error) {
    return reply({ error: error instanceof z.ZodError ? 'Проверьте данные' : error instanceof Error ? error.message : 'Ошибка сервера' }, 400);
  }
}
