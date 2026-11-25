import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Game } from './game';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LENGTH = 12;
const VALID = /^[A-HJ-NP-Z2-9]{12}$/;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type RecoveryCredential = { hash: string; expiresAt: string };

export function normalizeRecoveryCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, '');
}

export function formatRecoveryCode(code: string): string {
  return `${code.slice(0,4)}-${code.slice(4,8)}-${code.slice(8,12)}`;
}

export function hashRecoveryCode(room: string, code: string): string {
  return createHash('sha256').update(`melody-room-recovery:${room}:${code}`, 'utf8').digest('hex');
}

/** 12 random base32 symbols (60 bits of entropy), never persisted in plaintext. */
export function issueRecoveryCode(room: string, now = Date.now()) {
  const bytes = randomBytes(LENGTH);
  const secret = Array.from(bytes, byte => ALPHABET[byte & 31]).join('');
  return {
    code: formatRecoveryCode(secret),
    credential: {
      hash: hashRecoveryCode(room, secret),
      expiresAt: new Date(now + TTL_MS).toISOString(),
    } satisfies RecoveryCredential,
  };
}

export function verifyRecoveryCode(room: string, rawCode: string, credential: RecoveryCredential, now = Date.now()): boolean {
  const code = normalizeRecoveryCode(rawCode);
  const expiresAt = Date.parse(credential.expiresAt);
  if (!VALID.test(code) || rawCode.length > 40 || !Number.isFinite(expiresAt) || expiresAt <= now) return false;
  if (!/^[a-f0-9]{64}$/.test(credential.hash)) return false;
  const expected = Buffer.from(credential.hash, 'hex');
  const submitted = Buffer.from(hashRecoveryCode(room, code), 'hex');
  return timingSafeEqual(expected, submitted);
}

/** Search only a room's private recovery records. Never return credentials from publicGame. */
export function findRecoveryPlayer(game: Game, rawCode: string, now = Date.now()) {
  for (const [playerId, credential] of Object.entries(game.recoveryCredentials ?? {})) {
    if (verifyRecoveryCode(game.id, rawCode, credential, now) &&
      game.players.some(player => player.id === playerId)) return playerId;
  }
  return null;
}
