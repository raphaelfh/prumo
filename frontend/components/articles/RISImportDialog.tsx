/**
 * Diálogo para importação de artigos a partir de arquivo RIS.
 * Exibe preview dos registros e insere na tabela articles via Supabase.
 */

import {useCallback, useState} from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {ScrollArea} from '@/components/ui/scroll-area';
import {FileText, Loader2, Upload} from 'lucide-react';
import {mapRisRecordToArticle, type ParsedRisRecord, parseRisFile} from '@/lib/risParser';
import {supabase} from '@/integrations/supabase/client';
import {toast} from 'sonner';
import {t} from '@/lib/copy';

interface RISImportDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    projectId: string;
    onImportComplete?: () => void;
}

export function RISImportDialog({
                                    open,
                                    onOpenChange,
                                    projectId,
                                    onImportComplete,
                                }: RISImportDialogProps) {
    const [records, setRecords] = useState<ParsedRisRecord[]>([]);
    const [fileName, setFileName] = useState<string | null>(null);
    const [importing, setImporting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const reset = useCallback(() => {
        setRecords([]);
        setFileName(null);
        setError(null);
    }, []);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        reset();
        if (!file) return;
        setFileName(file.name);
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const text = reader.result as string;
                const parsed = parseRisFile(text);
                if (parsed.length === 0) {
                    setError(t('articles', 'risNoRecords'));
                    setRecords([]);
                } else {
                    setRecords(parsed);
                    setError(null);
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : t('articles', 'risReadError');
                setError(message);
                setRecords([]);
            }
        };
        reader.onerror = () => {
            setError(t('articles', 'risFileReadFailed'));
            setRecords([]);
        };
        reader.readAsText(file, 'UTF-8');
    };

    const handleImport = async () => {
        if (records.length === 0) return;
        setImporting(true);
        setError(null);
        let successCount = 0;
        let failCount = 0;
        for (const record of records) {
            try {
                const payload = mapRisRecordToArticle(record, projectId);
                const {error: insertError} = await supabase
                    .from('articles')
                    .insert(payload)
                    .select('id')
                    .single();
                if (insertError) {
                    failCount++;
                    console.error('[RISImport] Error inserting article:', insertError);
                } else {
                    successCount++;
                }
            } catch (err) {
                failCount++;
                console.error('[RISImport] Error inserting article:', err);
            }
        }
        setImporting(false);
        if (successCount > 0) {
            toast.success(`${successCount} ${t('articles', 'risSuccessCount')}`);
            onImportComplete?.();
            onOpenChange(false);
            reset();
        }
        if (failCount > 0) {
            toast.error(`${failCount} ${t('articles', 'risFailCount')}`);
        }
        if (successCount === 0 && failCount > 0) {
            setError(t('articles', 'risNoImported'));
        }
    };

    const handleOpenChange = (next: boolean) => {
        if (!next && (records.length > 0 || importing)) {
            if (window.confirm(t('articles', 'risCloseConfirm'))) {
                reset();
                onOpenChange(false);
            }
            return;
        }
        if (!next) reset();
        onOpenChange(next);
    };

    const previewTitles = records.slice(0, 10).map((r, i) => {
        const title = r.fields['TI']?.[0] ?? r.fields['T1']?.[0] ?? t('articles', 'risNoTitle');
        return `${i + 1}. ${title.length > 60 ? title.slice(0, 60) + '…' : title}`;
    });

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <FileText className="h-5 w-5"/>
                        {t('articles', 'risTitle')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('articles', 'risDesc')}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="flex items-center gap-2">
                        <input
                            type="file"
                            accept=".ris,text/plain,application/x-research-info-systems"
                            onChange={handleFileChange}
                            className="hidden"
                            id="ris-file-input"
                        />
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                            onClick={() => document.getElementById('ris-file-input')?.click()}
                        >
                            <Upload className="h-4 w-4 mr-2"/>
                            {t('articles', 'risSelectFile')}
                        </Button>
                        {fileName && (
                            <span className="text-[13px] text-muted-foreground truncate" title={fileName}>
                {fileName}
              </span>
                        )}
                    </div>

                    {error && (
                        <p className="text-sm text-destructive" role="alert">
                            {error}
                        </p>
                    )}

                    {records.length > 0 && (
                        <div className="space-y-2">
                            <p className="text-[13px] text-muted-foreground">
                                {records.length} {t('articles', 'risRecordsFound')}
                            </p>
                            <ScrollArea className="h-[140px] rounded-md border border-border/40 p-3">
                                <ul className="text-[13px] text-foreground space-y-1 list-none">
                                    {previewTitles.map((line, i) => (
                                        <li key={i}>{line}</li>
                                    ))}
                                </ul>
                            </ScrollArea>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={importing}>
                        {t('common', 'cancel')}
                    </Button>
                    <Button
                        onClick={handleImport}
                        disabled={records.length === 0 || importing}
                    >
                        {importing ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin"/>
                                {t('articles', 'risImporting')}
                            </>
                        ) : (
                            `${t('articles', 'risImportCount')} ${records.length} article(s)`
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
