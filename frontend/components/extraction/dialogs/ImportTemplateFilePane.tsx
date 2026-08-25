// frontend/components/extraction/dialogs/ImportTemplateFilePane.tsx
/**
 * "Add from a file" — a prumo-template@1 JSON file becomes a NEW active
 * template. The browser parses JSON syntax only; the SERVER validates the
 * document and its typed issue list (`details.errors`) renders here; any
 * other refusal renders its message (spec §6.2).
 */

import {useId, useState} from 'react';
import {Import, Loader2} from 'lucide-react';
import {toast} from 'sonner';

import {Alert, AlertDescription, AlertTitle} from '@/components/ui/alert';
import {Button} from '@/components/ui/button';
import {t} from '@/lib/copy';
import {TemplatePortableRefusal, importTemplateFromFile} from '@/services/templateImportService';

/** A real template is tens of KB; the server parses the whole body before
 * its own caps apply, so an oversized file never leaves the browser. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

interface ImportTemplateFilePaneProps {
  projectId: string;
  onImported: (templateId: string) => void;
}

export function ImportTemplateFilePane({projectId, onImported}: ImportTemplateFilePaneProps) {
  const inputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [errorLines, setErrorLines] = useState<string[] | null>(null);
  /** Issues the server capped off (spec: 20 shown, total reported). */
  const [hiddenCount, setHiddenCount] = useState(0);

  const handleImport = async () => {
    if (!file) return;
    setImporting(true);
    setErrorLines(null);
    setHiddenCount(0);
    const result = await importTemplateFromFile(projectId, file);
    setImporting(false);
    if (!result.ok) {
      const refusal = result.error instanceof TemplatePortableRefusal ? result.error : null;
      if (!refusal || refusal.issues.length === 0) {
        setErrorLines([result.error.message]);
        return;
      }
      setErrorLines(refusal.issues.map((i) => `${i.path}: ${i.message}`));
      setHiddenCount(Math.max(0, refusal.errorCount - refusal.issues.length));
      return;
    }
    toast.success(
      `${t('templateConfig', 'importSuccess')}: "${file.name}". ${result.data.entityTypesAdded} ${t('templateConfig', 'importSections')}, ${result.data.fieldsAdded} ${t('templateConfig', 'importFields')}.`,
    );
    setFile(null);
    onImported(result.data.templateId);
  };

  return (
    <section aria-labelledby={`${inputId}-heading`} className="space-y-2">
      <h3 id={`${inputId}-heading`} className="text-[13px] font-medium text-foreground">
        {t('templateConfig', 'importFromFileHeading')}
      </h3>
      <p className="text-xs text-muted-foreground">{t('templateConfig', 'importFromFileHint')}</p>
      <div className="flex items-center gap-2">
        <label
          htmlFor={inputId}
          // `relative`: the sr-only input inside is absolutely positioned — without
          // a positioned ancestor it adds phantom page scroll.
          className="relative inline-flex h-8 cursor-pointer items-center rounded-md border border-border/60 px-3 text-xs font-medium hover:bg-muted/50"
        >
          {t('templateConfig', 'importFileChoose')}
          <input
            id={inputId}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            data-testid="import-template-file-input"
            onChange={(event) => {
              const picked = event.target.files?.[0] ?? null;
              if (picked && picked.size > MAX_FILE_BYTES) {
                setFile(null);
                setErrorLines([t('templateConfig', 'importFileTooLarge')]);
                return;
              }
              setFile(picked);
              setErrorLines(null);
              setHiddenCount(0);
            }}
          />
        </label>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {file?.name ?? t('templateConfig', 'importFileNone')}
        </span>
        <Button
          size="sm"
          data-testid="import-template-file-submit"
          disabled={!file || importing}
          onClick={() => void handleImport()}
        >
          {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Import className="mr-2 h-4 w-4" aria-hidden />}
          {t('templateConfig', 'importFileSubmit')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('templateConfig', 'importFromFileTrust')}</p>
      {errorLines && (
        <Alert variant="destructive" data-testid="import-template-file-errors" className="p-3 text-xs">
          <AlertTitle className="text-xs">{t('templateConfig', 'importFileErrorsHeading')}</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-0.5 pl-4 font-mono text-xs">
              {errorLines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
            {hiddenCount > 0 && (
              <p className="mt-1 text-xs">
                {t('templateConfig', 'importFileMoreIssues').replace('{{n}}', String(hiddenCount))}
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}
