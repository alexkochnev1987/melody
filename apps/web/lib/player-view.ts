/** Pure, role-specific presentation state for the mobile player screen. */
export type PlayerSnapshot = {
  status: string;
  round: number;
  totalRounds: number;
  players: { id: string; name: string; score: number }[];
  winnerId: string | null;
  playbackActive?: boolean;
  chooserId?: string | null;
  auctionEnabled?: boolean;
  currentBid?: { playerId: string; points: number; seconds: number; commandId: string } | null;
  introHint?: string | null;
  remainingSeconds?: number | null;
  board?: { id: string; category: string; points: number; played: boolean; selected: boolean }[];
  revealedHints?: string[];
  blockedPlayerIds: string[];
  song: { id: string; points: number; availablePoints?: number; title?: string; artist?: string; category?: string };
};

export type PlayerView = {
  name: string;
  score: number;
  rank: number;
  playersCount: number;
  title: string;
  description: string;
  buttonLabel: string;
  buttonHint: string;
  canBuzz: boolean;
  answer: string | null;
};

export function getPlayerView(state: PlayerSnapshot, playerId: string, connected: boolean, busy: boolean): PlayerView {
  const ranking = [...state.players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ru'));
  const self = ranking.find(player => player.id === playerId);
  const rank = ranking.findIndex(player => player.id === playerId) + 1;
  const blocked = state.blockedPlayerIds.includes(playerId);
  const canBuzz = connected && !busy && state.status === 'playing' && state.playbackActive === true && !blocked &&
    (!state.auctionEnabled || state.currentBid?.playerId === playerId);
  const answer = ['revealed', 'finished'].includes(state.status) && state.song.artist && state.song.title
    ? `${state.song.artist} — ${state.song.title}`
    : null;

  const base = {
    name: self?.name ?? 'Игрок',
    score: self?.score ?? 0,
    rank,
    playersCount: ranking.length,
    canBuzz,
    answer,
  };

  if (!connected) return {
    ...base, title: 'Нет соединения', description: 'Проверяем подключение. Кнопка временно недоступна.',
    buttonLabel: 'ОФЛАЙН', buttonHint: 'Ждём подключения',
  };
  if (busy && state.status === 'playing') return {
    ...base, title: 'Отправляем сигнал…', description: 'Ждём ответа сервера — первенство ещё не подтверждено.',
    buttonLabel: 'ОТПРАВКА', buttonHint: 'Не нажимай повторно',
  };
  if (state.status === 'lobby') return {
    ...base, title: 'Скоро начнём!', description: 'Ведущий готовит музыку. Держи телефон под рукой.',
    buttonLabel: 'ЖДЁМ', buttonHint: 'Ожидаем ведущего',
  };
  if (state.status === 'bidding') return {
    ...base, title: 'Аукцион открыт!', description: 'Перебей ставку баллами или меньшим временем.',
    buttonLabel: 'СТАВКИ', buttonHint: 'Торги идут',
  };
  if (state.status === 'playing' && state.auctionEnabled && state.currentBid?.playerId !== playerId) return {
    ...base, title: 'Слушает другой игрок', description: 'Право ответа у победителя торгов.',
    buttonLabel: 'ЖДЁМ', buttonHint: 'Отвечает победитель аукциона',
  };
  if (state.status === 'playing' && blocked) return {
    ...base, title: 'В этот раз не угадал', description: 'Остальные могут отвечать. Твой шанс вернётся в следующем раунде.',
    buttonLabel: 'ПАУЗА', buttonHint: 'До следующей песни',
  };
  if (state.status === 'playing' && !state.playbackActive) return {
    ...base, title: 'Ждём музыку', description: 'Как только ведущий включит песню, кнопка STOP станет доступной.',
    buttonLabel: 'ЖДЁМ', buttonHint: 'Песня пока не играет',
  };
  if (state.status === 'playing') return {
    ...base, title: 'Узнал мелодию?', description: 'Жми первым, если знаешь исполнителя и название!',
    buttonLabel: 'STOP', buttonHint: 'Я знаю!',
  };
  if (state.status === 'buzzed') return state.winnerId === playerId
    ? { ...base, title: 'Ты первый!', description: 'Музыка остановлена. Назови свой ответ ведущему.',
        buttonLabel: 'ТВОЙ ХОД', buttonHint: 'Отвечай вслух' }
    : { ...base, title: 'Отвечает другой игрок', description: 'Жди решения ведущего. Раунд ещё может продолжиться.',
        buttonLabel: 'ЖДЁМ', buttonHint: 'Сейчас не твой ход' };
  if (state.status === 'selected') return {
    ...base, title: 'Торги завершены!', description: 'Ведущий готовит музыку. Время и очки победителя зафиксированы.',
    buttonLabel: 'СКОРО', buttonHint: 'Ожидаем ведущего',
  };
  if (state.status === 'revealed' && state.chooserId === playerId) return {
    ...base, title: 'Теперь твой выбор!', description: 'Выбери категорию и стоимость следующей песни.',
    buttonLabel: 'ВЫБОР', buttonHint: 'Выбирай следующую песню',
  };
  if (state.status === 'revealed') return {
    ...base, title: 'Раунд завершён', description: 'Проверь очки — впереди следующая песня.',
    buttonLabel: 'ГОТОВО', buttonHint: 'Ожидаем следующий раунд',
  };
  if (state.status === 'finished') return {
    ...base, title: 'Игра окончена!', description: 'Спасибо за игру. Итоговое место уже в твоём рейтинге.',
    buttonLabel: 'ФИНИШ', buttonHint: 'До следующей игры!',
  };
  return { ...base, title: 'Обновляем игру', description: 'Подождём команду ведущего.',
    buttonLabel: 'ЖДЁМ', buttonHint: 'Ожидание' };
}
