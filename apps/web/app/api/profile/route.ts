import { z } from 'zod';
import { connection } from 'next/server';
import { database } from '@/lib/db';
import { getGuestIdentity } from '@/lib/guest-identity';
import { summarizePlayerRooms, type PlayerRoom } from '@/lib/player-history';
import type { Game } from '@/lib/game';

const linkSchema = z.object({
  room: z.string().regex(/^[A-Z0-9]{6}$/),
  playerToken: z.string().min(16).max(256),
});
const privateReply = (body: unknown, status = 200, setCookie?: string) =>
  Response.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store',
      ...(setCookie ? { 'Set-Cookie': setCookie } : {}) },
  });

/** Guest history is scoped to an unguessable, HttpOnly browser cookie.
 * The fingerprint itself never appears in the response or client JavaScript.
 */
export async function GET(req: Request) {
  await connection();
  const identity = getGuestIdentity(req);
  if (identity.setCookie) {
    // A new browser cannot have linked rooms yet. Avoid a full-table scan.
    return privateReply({
      ...summarizePlayerRooms([], identity.hash), truncated: false,
    }, 200, identity.setCookie);
  }
  const db = await database();
  const rows = (await db.query<PlayerRoom>(
    `SELECT id, state FROM rooms
       WHERE (state->'identityHashes') ? $1
       ORDER BY COALESCE(state->>'endedAt', state->>'startedAt') DESC NULLS LAST, id DESC
       LIMIT 1001`,
    [identity.hash],
  )).rows;
  const truncated = rows.length > 1000;
  return privateReply({
    ...summarizePlayerRooms(rows.slice(0, 1000), identity.hash),
    truncated,
  });
}

/** Associates a pre-existing room participation with this browser.
 * Only the room's original unguessable player token can prove ownership.
 */
export async function POST(req: Request) {
  await connection();
  const parsed = linkSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return privateReply({ error: 'Неверный код комнаты или токен игрока' }, 400);
  const identity = getGuestIdentity(req);
  const db = await database();
  const { room, playerToken } = parsed.data;
  return db.transaction(async tx => {
    const stored = (await tx.query<{ state: Game }>(
      'SELECT state FROM rooms WHERE id=$1 FOR UPDATE', [room],
    )).rows[0];
    if (!stored) return privateReply({ error: 'Комната не найдена' }, 404);
    const participant = (await tx.query<{ player_id: string }>(
      'SELECT player_id FROM room_players WHERE room_id=$1 AND token=$2',
      [room, playerToken],
    )).rows[0];
    if (!participant || !stored.state.players.some(player => player.id === participant.player_id)) {
      return privateReply({ error: 'Нет доступа к этому участнику' }, 403);
    }
    const current = stored.state.identityHashes?.[identity.hash];
    if (current && current !== participant.player_id) {
      return privateReply({ error: 'Этот профиль уже связан с другим игроком в комнате' }, 409);
    }
    if (current === participant.player_id) {
      return privateReply({ linked: true }, 200, identity.setCookie);
    }
    const updated: Game = {
      ...stored.state,
      identityHashes: {
        ...stored.state.identityHashes,
        [identity.hash]: participant.player_id,
      },
    };
    await tx.query('UPDATE rooms SET state=$2 WHERE id=$1',
      [room, JSON.stringify(updated)]);
    return privateReply({ linked: true }, 200, identity.setCookie);
  });
}
