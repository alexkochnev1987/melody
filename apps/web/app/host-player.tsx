'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

declare global { interface Window { onYouTubeIframeAPIReady?: () => void } }

export type HostPlayerHandle = { play: () => boolean; pause: () => void };
type Props = {
  videoId: string;
  startSeconds: number;
  listenSeconds?: number;
  initialRemainingSeconds?: number | null;
  onReady: (ready: boolean) => void;
  onPlaybackChange: (playing: boolean) => void;
  onPlaybackBlocked: () => void;
  onExpired?: () => void;
  onError: () => void;
};

let apiPromise: Promise<void> | undefined;
function loadYouTube(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (!apiPromise) apiPromise = new Promise<void>((resolve, reject) => {
    const oldReady = window.onYouTubeIframeAPIReady;
    const timer = window.setTimeout(() => reject(new Error('YouTube API timeout')), 15000);
    window.onYouTubeIframeAPIReady = () => { clearTimeout(timer); oldReady?.(); resolve(); };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => { clearTimeout(timer); reject(new Error('YouTube API unavailable')); };
    document.head.appendChild(script);
  }).catch(error => { apiPromise = undefined; throw error; });
  return apiPromise;
}

/**
 * Stop after the configured amount of actual YouTube playback rather than
 * counting buffering/paused wall time. Native 'end' is a secondary hard stop.
 * YouTube may start at a nearby keyframe, so sub-second precision isn't guaranteed.
 */
const HostPlayer = forwardRef<HostPlayerHandle, Props>(function HostPlayer({
  videoId, startSeconds, listenSeconds, initialRemainingSeconds,
  onReady, onPlaybackChange, onPlaybackBlocked, onExpired, onError,
}, ref) {
  const container = useRef<HTMLDivElement>(null);
  const player = useRef<YT.Player | null>(null);
  const ready = useRef(false);
  const initialPlayed = useRef(
    listenSeconds && initialRemainingSeconds !== undefined && initialRemainingSeconds !== null ?
      Math.max(0, listenSeconds - initialRemainingSeconds) : 0,
  );

  useImperativeHandle(ref, () => ({
    play: () => {
      if (!ready.current || !player.current) return false;
      player.current.playVideo();
      return true;
    },
    pause: () => { if (ready.current) player.current?.pauseVideo(); },
  }), []);

  useEffect(() => {
    let active = true;
    let playing = false;
    let playedSeconds = initialPlayed.current;
    let lastPosition: number | null = null;
    let expired = false;
    ready.current = false;
    onPlaybackChange(false);

    const finish = () => {
      if (!active || expired || !listenSeconds) return;
      expired = true;
      playing = false;
      player.current?.pauseVideo();
      onPlaybackChange(false);
      onExpired?.();
    };

    // Measure the playback position: STOP cannot remain armed past the clip
    // even if a pause event or an async server request arrives late.
    const timer = window.setInterval(() => {
      if (!active || !playing || !listenSeconds || !player.current || expired) return;
      const position = player.current.getCurrentTime();
      if (!Number.isFinite(position)) return;
      if (lastPosition !== null) {
        const delta = position - lastPosition;
        // Large jumps (manual seeking, initial keyframe) must not count as listening.
        if (delta > 0 && delta < 1) playedSeconds += delta;
      }
      lastPosition = position;
      if (playedSeconds >= listenSeconds) finish();
    }, 80);

    loadYouTube().then(() => {
      if (!active || !container.current) return;
      const node = document.createElement('div');
      container.current.replaceChildren(node);
      player.current = new YT.Player(node, {
        videoId,
        playerVars: {
          start: startSeconds + initialPlayed.current,
          // Native end offers a fallback if browser timers are throttled.
          ...(listenSeconds ? { end: startSeconds + listenSeconds } : {}),
          playsinline: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: () => { if (active) { ready.current = true; onReady(true); } },
          onStateChange: event => {
            if (!active || expired) return;
            playing = event.data === 1;
            lastPosition = null;
            onPlaybackChange(playing);
            if (event.data === 0 && listenSeconds) {
              const position = player.current?.getCurrentTime() ?? 0;
              // Do not charge the player's stake if the video ends before the
              // wagered fragment was available (short/blocked uploads).
              if (playedSeconds + 0.55 >= listenSeconds ||
                position + 0.55 >= startSeconds + listenSeconds) {
                finish();
              } else {
                onPlaybackChange(false);
                onError();
              }
            }
          },
          onAutoplayBlocked: () => {
            if (active) { playing = false; lastPosition = null; onPlaybackChange(false); onPlaybackBlocked(); }
          },
          onError: () => {
            if (active) { playing = false; lastPosition = null; onPlaybackChange(false); onError(); }
          },
        },
      });
    }).catch(() => { if (active) { onPlaybackChange(false); onError(); } });

    return () => {
      active = false;
      window.clearInterval(timer);
      ready.current = false;
      onReady(false);
      onPlaybackChange(false);
      player.current?.destroy();
      player.current = null;
    };
    // The video is intentionally stable for an entire round. A new song is
    // mounted with a different key; live state polling must not reset its timer.
  }, [videoId, startSeconds, listenSeconds, onReady, onPlaybackChange, onPlaybackBlocked, onExpired, onError]);

  return <div className="video" ref={container} aria-label="YouTube плеер" />;
});
export default HostPlayer;
