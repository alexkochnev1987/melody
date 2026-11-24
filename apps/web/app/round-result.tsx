type RoundResultProps = {
  song: { title?: string; artist?: string };
  result?: { playerId: string; points: number } | null;
  players: { id: string; name: string }[];
};

/** Same reveal card on TV/host and all mobile devices. Never render before public song is revealed. */
export default function RoundResult({ song, result, players }: RoundResultProps) {
  if (!song.title || !song.artist) return null;
  const winner = result ? players.find(player => player.id === result.playerId) : null;

  return <section className="round-result" aria-label="Правильный ответ" role="status">
    <span className="round-result__eyebrow">♫ ПРАВИЛЬНЫЙ ОТВЕТ</span>
    <h2>{song.title}</h2>
    <p className="round-result__artist">{song.artist}</p>
    {result ? <p className="round-result__winner">
      ✓ Угадал {winner?.name ?? 'Игрок'} · +{result.points} очков
    </p> : <p className="round-result__no-winner">Никто не угадал — ведущий открыл ответ</p>}
  </section>;
}
