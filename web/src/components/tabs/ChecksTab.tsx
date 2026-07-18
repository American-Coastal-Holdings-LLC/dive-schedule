'use client';

// Checks — the operation-wide inspection checklist template. Only visible with dive.checklist.manage,
// so add/delete are always available here. GET/POST/DELETE /api/checklist.

import { useState } from 'react';
import { api } from '@/lib/api';
import { useResource } from '@/lib/hooks';
import type { ChecklistQuestion } from '@/lib/types';
import { Icon } from '../Icon';
import { EmptyState, ErrorBanner } from '../common';
import { usePlatform } from '../PlatformProvider';

export function ChecksTab() {
  const { toast } = usePlatform();
  const { data, error, reload } = useResource<{ questions: ChecklistQuestion[] }>('/api/checklist');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const questions = data?.questions ?? [];

  const add = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await api.post('/api/checklist', { text: t });
      setText('');
      reload();
    } catch {
      /* toast surfaced by api */
    } finally {
      setBusy(false);
    }
  };

  const del = async (id: string) => {
    try {
      await api.del(`/api/checklist/${id}`);
      toast('Question removed');
      reload();
    } catch {
      /* toast surfaced by api */
    }
  };

  return (
    <>
      <div className="chk-add">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
          placeholder="Add an inspection question…"
          aria-label="New checklist question"
        />
        <button className="btn btn-primary" style={{ flex: 'none' }} onClick={add} disabled={busy}>
          <Icon name="plus" /> Add
        </button>
      </div>

      {error ? <ErrorBanner message="Couldn’t load the checklist template." /> : null}

      {questions.length === 0 && !error ? (
        <EmptyState
          icon="clipboard"
          title="No checklist questions yet"
          desc="Add the inspection items your divers should answer on every job."
        />
      ) : (
        questions.map((q) => (
          <div className="chk-row" key={q.id}>
            <div className="chk-q">{q.text}</div>
            <button className="chk-del" aria-label="Delete question" onClick={() => del(q.id)}>
              <Icon name="trash" />
            </button>
          </div>
        ))
      )}
    </>
  );
}
