'use client';

import { useState } from 'react';

type Props = {
  room: string;
  code?: string;
  busy: boolean;
  onRefresh: () => void;
};

/** The secret is only on this player's device, not in public room snapshots. */
export default function RecoveryAccess({ room, code, busy, onRefresh }: Props) {
  const [open, setOpen] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState('');

  return <>
    <button type="button" className="player-screen__recovery-trigger"
      onClick={() => { setOpen(true); setCopyFeedback(''); }}>
      <span aria-hidden="true">🔑</span> Код возврата
    </button>
    {open && <div className="player-recovery-overlay" role="presentation">
      <section className="player-recovery-dialog" role="dialog" aria-modal="true"
        aria-labelledby="player-recovery-title">
        <button type="button" className="player-recovery-close" onClick={() => setOpen(false)}
          aria-label="Закрыть код восстановления">✕</button>
        <span className="player-recovery-eyebrow">ДОСТУП К СВОЕМУ МЕСТУ</span>
        <h2 id="player-recovery-title">Код возврата</h2>
        <p>Сфотографируй или скопируй этот код. Если телефон разрядится или приватная вкладка закроется, ты сможешь вернуться с любого устройства.</p>
        <span className="player-recovery-room">Комната {room}</span>
        {code ? <strong className="player-recovery-secret" aria-label="Личный код восстановления">{code}</strong>
          : <p className="player-recovery-empty">Для этого устройства ещё не создан код. Нажми «Создать код».</p>}
        {code && <button type="button" disabled={typeof navigator === 'undefined' || !navigator.clipboard} onClick={() => {
          void navigator.clipboard.writeText(code).then(() => setCopyFeedback('Код скопирован'))
            .catch(() => setCopyFeedback('Не удалось скопировать. Сохрани код вручную.'));
        }}>Скопировать код</button>}
        <button type="button" className="secondary" disabled={busy} onClick={onRefresh}>
          {busy ? 'Создаём код…' : code ? 'Создать новый код' : 'Создать код'}
        </button>
        <p className="player-recovery-details">Код действует 7 дней. После использования старый код и доступ прежнего устройства прекращают действовать. Никому не показывай его.</p>
        {copyFeedback && <p role="status">{copyFeedback}</p>}
      </section>
    </div>}
  </>;
}
