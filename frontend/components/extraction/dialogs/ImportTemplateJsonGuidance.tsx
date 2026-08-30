/**
 * The JSON tab's guidance: what a `prumo-template@1` file must contain, a
 * prompt to hand an AI assistant, and the worked example as a download.
 *
 * The rules and the prompt both read `templateConfig.importGuidanceRules`, so
 * the panel and the clipboard can never disagree about the format.
 */

import {Check, Copy, Download} from 'lucide-react';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {Button} from '@/components/ui/button';
import {useCopyToClipboard} from '@/hooks/useCopyToClipboard';
import {templateConfig} from '@/lib/copy';
import {t} from '@/lib/copy';
import {triggerDownload} from '@/lib/download';
import {AI_TEMPLATE_PROMPT, EXAMPLE_TEMPLATE_JSON} from '@/lib/templateImport/aiPrompt';

export function ImportTemplateJsonGuidance() {
  const {copied, copy} = useCopyToClipboard();

  const downloadExample = () => {
    triggerDownload(
      new Blob([EXAMPLE_TEMPLATE_JSON], {type: 'application/json'}),
      t('templateConfig', 'importExampleFilename'),
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          type="button"
          data-testid="import-template-copy-prompt"
          onClick={() => copy(AI_TEMPLATE_PROMPT)}
        >
          {copied ? (
            <Check className="mr-2 h-4 w-4" aria-hidden />
          ) : (
            <Copy className="mr-2 h-4 w-4" aria-hidden />
          )}
          {copied
            ? t('templateConfig', 'importCopyPromptDone')
            : t('templateConfig', 'importCopyPrompt')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          type="button"
          data-testid="import-template-download-example"
          onClick={downloadExample}
        >
          <Download className="mr-2 h-4 w-4" aria-hidden />
          {t('templateConfig', 'importDownloadExample')}
        </Button>
      </div>

      <Accordion type="single" collapsible>
        <AccordionItem value="format" className="border-b-0">
          <AccordionTrigger
            className="py-2 text-[13px] font-medium"
            data-testid="import-template-guidance-trigger"
          >
            {t('templateConfig', 'importGuidanceTitle')}
          </AccordionTrigger>
          <AccordionContent className="pb-2">
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              {templateConfig.importGuidanceRules.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
