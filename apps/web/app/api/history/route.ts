import { getAuth } from '@/lib/auth';
import { database } from '@/lib/db';
import type { Game } from '@/lib/game';

import { connection } from 'next/server';

type Row = { id: string; state: Game };

/**
 * Historic rooms already persist as PostgreSQL JSONB. Only games created by the
 * authenticated organizer are returned; host/player tokens never leave the DB.
 */
export async function GET(req: Request) {
  await connection();
  const session = await (await getAuth()).api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: 'Сначала войдите в аккаунт' }, { status: 401 });
  const db = await database();
  const rows = (await db.query<Row>(
    `SELECT id, state FROM rooms WHERE state->>'ownerId' = $1
       ORDER BY (state->>'startedAt') DESC NULLS LAST LIMIT 50`,
    [session.user.id],
  )).rows;
  const games = rows.map(({ id, state }) => ({
    id,
    status: state.status,
    startedAt: state.startedAt ?? null,
    endedAt: state.endedAt ?? null,
    roundsPlayed: state.playedSongIds?.length ?? Math.max(0, state.songIndex + (state.status === 'finished' || state.status === 'revealed' ? 1 : 0)),
    totalRounds: state.songs.length,
    players: [...state.players].sort((a, b) => b.score - a.score).map(({ id, name, score }) => ({ id, name, score })),
    scoreEvents: state.scoreEvents,
  }));
  return Response.json({ games }, { headers: { 'Cache-Control': 'no-store' } });
}
