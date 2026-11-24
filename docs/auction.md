# Melody — timed song auction and host-controlled reveal

The pure state machine lives in `apps/web/lib/game.ts`. Every command is
serialized inside a PostgreSQL transaction using `SELECT ... FOR UPDATE`.

## Before the clip

1. The organizer creates a room with **300 points per player** by default,
   adjustable from 1 to 100,000. A user cannot bid more than their balance.
2. The host or a prior winner selects an unplayed song; the category, nominal
   score and one pregame clue are public. Title/artist/video ID are secret.
3. Players bid an integer number of seconds **≥ 2** and integer points
   **≥ nominal**, within their balances. A new bid must have
   **at least as many points and no more time**, improving one value strictly.
   The *current leader cannot outbid themselves*.
4. After bidding closes, the host prepares the round and uses the explicit
   **▶ Play clip** button. The bidder's fragment starts at the configured
   `startSeconds` and is automatically stopped after the chosen duration.
   Host controls include a Pause button. Browser autoplay may require a click
   on the YouTube player itself.

## Host judgment and second chances

- The bidder **does not press STOP during their fragment**. Once the
  time-limited clip ends, the room changes to `awaitingJudgment` without
  awarding or deducting points. The winner names the answer aloud.
- The host chooses **✓ Correct** to award **+the full wager** or **✕ Wrong**
  to deduct **−the full wager once**.
- A correct answer immediately reveals title, artist, responder and
  awarded points **to all mobiles and the TV** using the same public
  game snapshot. The host must then click **Open next song selection**
  before any player can select a song. The host may also replay the full
  song to enjoy it while the result remains visible.
- A wrong answer opens `openAnswer`. The host has **▶ Replay melody**
  and **⏸ Pause** buttons. Unlike the initial wager, replay is unrestricted.
  While actual replay playback is confirmed, **every player except the
  original bidder** may press STOP.
- First validated STOP changes the room to `secondBuzzed` and pauses
  YouTube. Host judges the answer: correct **+song nominal** and reveal
  to everyone; wrong means no further penalty and the host may replay
  again. This may repeat until someone gets the right answer or the host
  manually chooses **Reveal answer**.
- Playback confirmation expires after 12 seconds without a host heartbeat,
  so STOP is not armed if the browser or host goes offline.
- A too-short/unavailable YouTube upload is handled as a playback error,
  not an automatic loss; the host can skip. YouTube IFrame seeking/end
  boundaries aren't guaranteed to be accurate to the millisecond.

## Data and tests

Room JSONB persists the starting bankroll, bids, score events, winner
and revealed result. `publicGame()` never includes title/artist before
the host confirms a correct answer or manually reveals the solution.
Old rooms without `auctionEnabled` retain their legacy STOP behavior.

Tests cover bid monotonicity, prohibiting self-overbids, credits and all-in
losses, no penalty until host judgment, idempotent scoring, different
players using STOP on replay, skipping, public answer confidentiality,
explicit host-controlled next-song choice, and legacy rooms.

CI runs unit tests, ESLint, TypeScript and the Next.js production build.
A real browser test with playable YouTube media and multiple phones remains
important. Database-provider backups are a separate operational setting.
