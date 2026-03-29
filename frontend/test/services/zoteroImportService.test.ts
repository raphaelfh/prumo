import {describe, expect, it, vi} from 'vitest';

import {ZoteroImportService} from '@/services/zoteroImportService';

describe('ZoteroImportService sync methods', () => {
    it('calls sync-collection through helper', async () => {
        const service = new ZoteroImportService();
        const spy = vi
            .spyOn(service as unknown as {
                callZoteroApi: (action: string, payload?: Record<string, unknown>) => Promise<unknown>
            }, 'callZoteroApi')
            .mockResolvedValue({syncRunId: 'run-1', status: 'pending', message: 'ok'});

        const result = await service.startSync('project-1', 'collection-1', {
            downloadPdfs: true,
            onlyPdfs: true,
            updateExisting: true,
            importTags: true,
            conflictResolution: 'update',
        });
        expect(spy).toHaveBeenCalledWith(
            'sync-collection',
            expect.objectContaining({projectId: 'project-1', collectionKey: 'collection-1'})
        );
        expect(result.syncRunId).toBe('run-1');
    });

    it('calls sync-status through helper', async () => {
        const service = new ZoteroImportService();
        const spy = vi
            .spyOn(service as unknown as {
                callZoteroApi: (action: string, payload?: Record<string, unknown>) => Promise<unknown>
            }, 'callZoteroApi')
            .mockResolvedValue({
                syncRunId: 'run-1',
                status: 'running',
                counts: {
                    totalReceived: 10,
                    persisted: 1,
                    updated: 0,
                    skipped: 0,
                    failed: 0,
                    removedAtSource: 0,
                    reactivated: 0,
                },
            });

        const result = await service.getSyncStatus('run-1');
        expect(spy).toHaveBeenCalledWith('sync-status', {syncRunId: 'run-1'});
        expect(result.status).toBe('running');
    });
});
