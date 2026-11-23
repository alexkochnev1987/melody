export function youtubeId(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    let id: string | null = null;
    if (host === 'youtu.be') id = url.pathname.split('/')[1] ?? null;
    else if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      if (url.pathname === '/watch') id = url.searchParams.get('v');
      else if (/^\/(shorts|embed|live)\//.test(url.pathname)) id = url.pathname.split('/')[2] ?? null;
    }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch { return null; }
}

/** Reject obvious mismatches such as hour-long mixes; the organizer still reviews each match. */
export function titleLooksRelevant(songTitle: string, videoTitle: string): boolean {
  const words = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z0-9а-яё]+/g) ?? [];
  const wanted = words(songTitle).filter(w => w.length > 1);
  const actual = new Set(words(videoTitle));
  return wanted.length > 0 && wanted.filter(w => actual.has(w)).length / wanted.length >= 0.6;
}
