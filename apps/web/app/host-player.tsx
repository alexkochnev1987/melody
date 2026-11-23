'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

declare global { interface Window { onYouTubeIframeAPIReady?: () => void } }

export type HostPlayerHandle = { play: () => boolean; pause: () => void };
type Props = { videoId: string; startSeconds: number; onReady: (ready: boolean) => void; onPlaybackBlocked: () => void; onError: () => void };

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

const HostPlayer = forwardRef<HostPlayerHandle, Props>(function HostPlayer({ videoId, startSeconds, onReady, onPlaybackBlocked, onError }, ref) {
  const container = useRef<HTMLDivElement>(null);
  const player = useRef<YT.Player | null>(null);
  const ready = useRef(false);
  useImperativeHandle(ref, () => ({
    play: () => { if (!ready.current || !player.current) return false; player.current.playVideo(); return true; },
    pause: () => { if (ready.current) player.current?.pauseVideo(); },
  }), []);
  useEffect(() => {
    let active = true;
    ready.current = false;
    loadYouTube().then(() => {
      if (!active || !container.current) return;
      const node = document.createElement('div');
      container.current.replaceChildren(node);
      player.current = new YT.Player(node, {
        videoId,
        playerVars: { start: startSeconds, playsinline: 1, origin: window.location.origin },
        events: {
          onReady: () => { if (active) { ready.current = true; onReady(true); } },
          onAutoplayBlocked: () => { if (active) onPlaybackBlocked(); },
          onError: () => { if (active) onError(); },
        },
      });
    }).catch(() => { if (active) onError(); });
    return () => {
      active = false; ready.current = false; onReady(false);
      player.current?.destroy(); player.current = null;
    };
  }, [videoId, startSeconds, onReady, onPlaybackBlocked, onError]);
  return <div className="video" ref={container} aria-label="YouTube плеер" />;
});
export default HostPlayer;
