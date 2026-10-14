import { useEffect, useState } from 'react';
import type { JobProgressRecord } from '@finance/contracts';

/**
 * Follows a job's durable progress over SSE. EventSource resends Last-Event-ID on reconnect,
 * so the server replays anything missed while disconnected.
 */
export function useJobProgress(jobId: string | null | undefined, enabled: boolean, onEnd?: () => void) {
  const [latest, setLatest] = useState<JobProgressRecord | null>(null);
  useEffect(() => {
    if (!jobId || !enabled) return;
    const source = new EventSource(`/api/jobs/${jobId}/events`);
    source.addEventListener('progress', (e) => setLatest(JSON.parse((e as MessageEvent).data)));
    source.addEventListener('end', () => {
      source.close();
      onEnd?.();
    });
    return () => source.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, enabled]);
  return latest;
}
