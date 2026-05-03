/**
 * Dialog for importing articles from a Scopus CSV export file.
 *
 * Flow:
 * 1. User selects a CSV file
 * 2. CSV is parsed client-side for preview
 * 3. CSV is uploaded to backend for processing
 * 4. Articles are bulk-inserted with deduplication by DOI
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
import {Badge} from '@/components/ui/badge';
import {AlertCircle, CheckCircle2, FileSpreadsheet, Loader2, Upload} from 'lucide-react';
import {supabase} from '@/integrations/supabase/client';
import {toast} from 'sonner';
import {t} from '@/lib/copy';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';

interface CSVPreviewRow {
    title: string;
    authors: string;
    year: string;
    journal: string;
    doi: string;
}

interface ImportResult {
    successCount: number;
    failCount: number;
    duplicateCount: number;
    errors: string[];
}

interface CSVImportDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    projectId: string;
    onImportComplete?: () => void;
}

export function CSVImportDialog({
    open,
    onOpenChange,
    projectId,
    onImportComplete,
}: CSVImportDialogProps) {
    const [file, setFile] = useState<File | null>(null);
    const [preview, setPreview] = useState<CSVPreviewRow[]>([]);
    const [totalRows, setTotalRows] = useState(0);
    const [importing, setImporting] = useState(false);
    const [result, setResult] = useState<ImportResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    const reset = useCallback(() => {
        setFile(null);
        setPreview([]);
        setTotalRows(0);
        setImporting(false);
        setResult(null);
        setError(null);
    }, []);

    const parseCSVPreview = (text: string): {rows: CSVPreviewRow[], total: number} => {
        const lines = text.split('\n');
        if (lines.length < 2) return {rows: [], total: 0};

        // Simple CSV header parsing
        const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
        const titleIdx = headers.indexOf('Title');
        const authorsIdx = headers.indexOf('Authors');
        const yearIdx = headers.indexOf('Year');
        const journalIdx = headers.indexOf('Source title');
        const doiIdx = headers.indexOf('DOI');

        if (titleIdx === -1) {
            throw new Error('CSV must have a "Title" column. Expected Scopus export format.');
        }

        // Parse rows (simple — handles basic quoting)
        const rows: CSVPreviewRow[] = [];
        let total = 0;

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            // Simple field extraction (handles quoted fields with commas)
            const fields: string[] = [];
            let current = '';
            let inQuotes = false;
            for (const char of line) {
                if (char === '"') {
                    inQuotes = !inQuotes;
                } else if (char === ',' && !inQuotes) {
                    fields.push(current.trim());
                    current = '';
                } else {
                    current += char;
                }
            }
            fields.push(current.trim());

            const title = (fields[titleIdx] || '').replace(/^"|"$/g, '');
            if (!title) continue;

            total++;

            if (rows.length < 10) {
                rows.push({
                    title: title.length > 70 ? title.slice(0, 70) + '...' : title,
                    authors: (fields[authorsIdx] || '').replace(/^"|"$/g, '').slice(0, 50),
                    year: (fields[yearIdx] || '').replace(/^"|"$/g, ''),
                    journal: (fields[journalIdx] || '').replace(/^"|"$/g, '').slice(0, 40),
                    doi: (fields[doiIdx] || '').replace(/^"|"$/g, '').slice(0, 30),
                });
            }
        }

        return {rows, total};
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        e.target.value = '';
        reset();
        if (!selectedFile) return;

        if (!selectedFile.name.endsWith('.csv')) {
            setError('Please select a .csv file');
            return;
        }

        setFile(selectedFile);
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const text = reader.result as string;
                const {rows, total} = parseCSVPreview(text);
                if (total === 0) {
                    setError('No articles found in CSV file');
                    return;
                }
                setPreview(rows);
                setTotalRows(total);
                setError(null);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Error reading CSV');
            }
        };
        reader.onerror = () => setError('Failed to read file');
        reader.readAsText(selectedFile, 'UTF-8');
    };

    const handleImport = async () => {
        if (!file) return;
        setImporting(true);
        setError(null);

        try {
            const {data: {session}} = await supabase.auth.getSession();
            if (!session?.access_token) {
                throw new Error('Authentication required');
            }

            const formData = new FormData();
            formData.append('project_id', projectId);
            formData.append('file', file);

            const response = await fetch(`${API_BASE_URL}/api/v1/article-import/csv-import`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${session.access_token}`,
                },
                body: formData,
            });

            const data = await response.json();

            if (!data.ok) {
                throw new Error(data.error?.message || 'Import failed');
            }

            const importResult: ImportResult = data.data;
            setResult(importResult);

            if (importResult.successCount > 0) {
                toast.success(`${importResult.successCount} article(s) imported successfully!`);
                onImportComplete?.();
            }
            if (importResult.duplicateCount > 0) {
                toast.info(`${importResult.duplicateCount} duplicate(s) skipped (same DOI).`);
            }
            if (importResult.failCount > 0) {
                toast.warning(`${importResult.failCount} article(s) failed to import.`);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            setError(message);
            toast.error(message);
        } finally {
            setImporting(false);
        }
    };

    const handleOpenChange = (next: boolean) => {
        if (!next && importing) {
            return; // Prevent closing during import
        }
        if (!next) reset();
        onOpenChange(next);
    };

    const handleClose = () => {
        reset();
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <FileSpreadsheet className="h-5 w-5"/>
                        Import from CSV (Scopus)
                    </DialogTitle>
                    <DialogDescription>
                        Select a .csv file exported from Scopus. Articles will be imported with deduplication by DOI.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    {/* File selector */}
                    {!result && (
                        <div className="flex items-center gap-2">
                            <input
                                type="file"
                                accept=".csv"
                                onChange={handleFileChange}
                                className="hidden"
                                id="csv-import-input"
                            />
                            <Button
                                variant="outline"
                                size="sm"
                                className="shrink-0"
                                onClick={() => document.getElementById('csv-import-input')?.click()}
                                disabled={importing}
                            >
                                <Upload className="h-4 w-4 mr-2"/>
                                Select CSV file
                            </Button>
                            {file && (
                                <span className="text-[13px] text-muted-foreground truncate" title={file.name}>
                                    {file.name}
                                </span>
                            )}
                        </div>
                    )}

                    {error && (
                        <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/5 rounded-md p-3">
                            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0"/>
                            {error}
                        </div>
                    )}

                    {/* Preview */}
                    {preview.length > 0 && !result && (
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <Badge variant="secondary" className="text-xs">
                                    {totalRows} article(s)
                                </Badge>
                                <span className="text-[13px] text-muted-foreground">Preview (first 10):</span>
                            </div>
                            <ScrollArea className="h-[200px] rounded-md border border-border/40 p-3">
                                <ul className="text-[13px] text-foreground space-y-2 list-none">
                                    {preview.map((row, i) => (
                                        <li key={i} className="space-y-0.5">
                                            <p className="font-medium">{i + 1}. {row.title}</p>
                                            <p className="text-muted-foreground text-xs">
                                                {[row.authors, row.journal, row.year, row.doi].filter(Boolean).join(' | ')}
                                            </p>
                                        </li>
                                    ))}
                                </ul>
                            </ScrollArea>
                        </div>
                    )}

                    {/* Import result */}
                    {result && (
                        <div className="space-y-3 py-2">
                            <div className="flex items-center gap-2">
                                <CheckCircle2 className="h-5 w-5 text-green-500"/>
                                <span className="font-medium text-sm">Import complete</span>
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                                <div className="rounded-md border border-border/40 p-3 text-center">
                                    <p className="text-2xl font-semibold text-green-600">{result.successCount}</p>
                                    <p className="text-xs text-muted-foreground">Imported</p>
                                </div>
                                <div className="rounded-md border border-border/40 p-3 text-center">
                                    <p className="text-2xl font-semibold text-yellow-600">{result.duplicateCount}</p>
                                    <p className="text-xs text-muted-foreground">Duplicates</p>
                                </div>
                                <div className="rounded-md border border-border/40 p-3 text-center">
                                    <p className="text-2xl font-semibold text-red-600">{result.failCount}</p>
                                    <p className="text-xs text-muted-foreground">Failed</p>
                                </div>
                            </div>
                            {result.errors.length > 0 && (
                                <ScrollArea className="h-[100px] rounded-md border border-border/40 p-3">
                                    <ul className="text-xs text-muted-foreground space-y-1 list-none">
                                        {result.errors.map((err, i) => (
                                            <li key={i}>{err}</li>
                                        ))}
                                    </ul>
                                </ScrollArea>
                            )}
                        </div>
                    )}
                </div>

                <DialogFooter>
                    {result ? (
                        <Button onClick={handleClose}>
                            Close
                        </Button>
                    ) : (
                        <>
                            <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={importing}>
                                {t('common', 'cancel')}
                            </Button>
                            <Button
                                onClick={handleImport}
                                disabled={totalRows === 0 || importing}
                            >
                                {importing ? (
                                    <>
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin"/>
                                        Importing...
                                    </>
                                ) : (
                                    `Import ${totalRows} article(s)`
                                )}
                            </Button>
                        </>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
