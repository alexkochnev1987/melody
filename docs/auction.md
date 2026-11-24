# Melody auction rules and mobile flow

Implemented in PR #5 (2026-11-24). The pure state machine is in
`apps/web/lib/game.ts`, and the application persists every accepted command
under PostgreSQL's `SELECT ... FOR UPDATE` transaction lock.

## Before a round

1. The host creates a room with **300 starting points per player** by default,
   editable from 1 to 100,000. These points are credited when players join.
   The setting belongs to the room, not the playlist template.
2. The host or the prior correct responder selects an unplayed song. Its
   category and nominal points are public; title, artist and video ID remain
   hidden from players and TV.
3. All players see the **single selected pregame joke**. The organizer may
   generate three alternatives but saves only one selected `introHint`.
   Existing `hints[0]` is a fallback for old playlists.
4. Bidding opens. Each player can enter **any whole number of seconds >= 2**
   and **whole-number points >= the song's nominal**. No player may bid
   more than their current score or bid with zero points.
5. A bid beats the existing bid only when its points do **not decrease**
   and its listening time does **not increase**, with at least one strict
   improvement. Parallel bids are serialized and validated again server-side;
   players' IDs come from the access token, not client input.
6. Host closes bidding. The highest valid bid becomes final. **No separate
   time choice or changed amount is allowed** after this point.
7. Host prepares the round, then explicitly presses the play control:
   this avoids starting the shortest 2-second clip before the server's
   `playing` status is confirmed.

## During/after playback

- YouTube plays **only on the host device**. The host-side player uses both
  the YouTube `end` parameter and an 80ms check of actual playback position.
  Pauses and buffering do not deliberately consume the local time budget.
  YouTube iframe playback is not a guaranteed millisecond-accurate audio
  transport; seek/keyframe behavior and networking can cause deviations.
- STOP is server-authorized only for the winning bidder and only during an
  active YouTube playback lease. The host periodically renews the lease,
  which expires after 12 seconds of disconnection.
- STOP before the limit lets the winner answer aloud. The host marks
  correct **+the wager** or wrong **−the wager**.
- If the clip ends without a valid STOP, the host reports expiry and
  the winner loses **the wager**. The game records one `scoreEvent`.
  An upload that ends *too early* is treated as a playback problem instead
  of automatically penalizing the player; the host can skip.
- Host may skip a problematic song without charge. In the next round,
  only users with sufficient remaining balance can bid.
- Bid history, initial balance, scores, score events and room state are
  stored in PostgreSQL JSONB and exported via the organizer's History view.
  No schema migration is required. External Neon backups must still be
  configured/verified separately.

## Compatibility and tests

Old rooms with `auctionEnabled` absent continue using their original
buzzer and scoring logic. New rooms require `choose → bid → closeBidding
→ start → playback → buzz/judge OR expire → reveal`.

Unit tests cover minimum time, outbid monotonicity, insufficient/zero
balance, all-in loss, score handling, idempotency, concurrent STOP-vs-expire
ordering, playback pause/renewal, answer confidentiality and legacy rooms.

CI: `node --import tsx --test lib/*.test.ts`, `npm run lint`,
`npm run build`. Manual end-to-end tests still require a host browser
with an actual playable YouTube clip and a second mobile device.
