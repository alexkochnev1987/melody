'use client';

export type BoardChoice = {
  id: string;
  category: string;
  points: number;
  played: boolean;
  selected: boolean;
};

type Props = {
  songs: BoardChoice[];
  onChoose?: (songId: string) => void;
  disabled?: boolean;
};

/** Public board intentionally renders neither song titles nor YouTube links. */
export default function SongBoard({ songs, onChoose, disabled = false }: Props) {
  const groups = Array.from(new Set(songs.map(song => song.category || 'Разное')));
  return (
    <div className="song-board" aria-label="Выбор следующей песни">
      {groups.map(category => (
        <section className="song-board__category" key={category}>
          <h3>{category}</h3>
          <div className="song-board__choices">
            {songs.filter(song => (song.category || 'Разное') === category).map(song => (
              <button
                key={song.id}
                type="button"
                className={`song-board__tile${song.played ? ' song-board__tile--played' : ''}${song.selected ? ' song-board__tile--selected' : ''}`}
                disabled={disabled || song.played || !onChoose}
                aria-label={song.played ? `${category}, ${song.points} очков, сыграно` : `Выбрать категорию ${category}, ${song.points} очков`}
                onClick={() => onChoose?.(song.id)}
              >
                {song.played ? '✓' : song.points}
              </button>
            ))}
          </div>
        </section>
      ))}
      {songs.length === 0 && <p>Доступных песен пока нет.</p>}
    </div>
  );
}
