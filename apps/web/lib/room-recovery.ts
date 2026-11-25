import type { Game, Player } from './game';

/** A browser can claim only a room participant already bound to its hashed cookie. */
export function findGuestPlayer(game: Game, guestHash: string): Player | null {
  if (!/^[a-f0-9]{64}$/.test(guestHash)) return null;
  const playerId = game.identityHashes?.[guestHash];
  return game.players.find(player => player.id === playerId) ?? null;
}
