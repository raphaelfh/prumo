import {useEffect, useMemo, useState} from 'react';

import {zoteroService} from '@/services/zoteroImportService';
import type {ZoteroSyncStatus} from '@/types/zotero';

export function useZoteroSyncStatus(syncRunId: string | null, pollingMs = 1500) {
    const [data, setData] = useState<ZoteroSyncStatus | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!syncRunId) {
            setData(null);
            setError(null);
            setLoading(false);
            return;
        }

        let active = true;
        let timer: number | null = null;

        const tick = async () => {
            if (!active) return;
            setLoading(true);
            try {
                const next = await zoteroService.getSyncStatus(syncRunId);
                if (!active) return;
                setData(next);
                setError(null);
                if (next.status === 'pending' || next.status === 'running') {
                    timer = window.setTimeout(tick, pollingMs);
                }
            } catch (err) {
                if (!active) return;
                setError(err instanceof Error ? err.message : 'Failed to load sync status');
            } finally {
                if (active) setLoading(false);
            }
        };

        void tick();
        return () => {
            active = false;
            if (timer) window.clearTimeout(timer);
        };
    }, [syncRunId, pollingMs]);

    const isTerminal = useMemo(
        () => !!data && ['completed', 'failed', 'cancelled'].includes(data.status),
        [data]
    );

    return {data, loading, error, isTerminal};
}
