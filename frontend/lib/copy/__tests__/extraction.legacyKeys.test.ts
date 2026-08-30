import { describe, expect, it } from 'vitest';
import { extraction } from '@/lib/copy/extraction';

const REMOVED = [
  'exportNoData','exportNoDataHint','exportTitle','exportSubtitle','exportTemplate',
  'exportInstances','exportInstancesCreated','exportValues','exportValuesExtracted',
  'exportCompleteness','exportCompletenessOf','exportSettingsTitle','exportSettingsDesc',
  'exportFormatLabel','exportFormatCsv','exportFormatCsvDesc','exportFormatJson',
  'exportFormatJsonDesc','exportFormatExcel','exportFormatExcelDesc','exportIncludeOptions',
  'exportIncludeEvidence','exportIncludeMetadata','exportOnlyComplete','exportNoTemplate',
  'exportNoTemplateHint','dataPreviewTitle','dataPreviewDesc','valuesLabelShort',
  'moreExportData','moreExportDialogTitle','moreExportDialogDesc',
  // Retired with the catalogue table (spec 2026-08-27, slice A) — the
  // last three were already unreferenced before it.
  'configImportSectionTitle','configAvailableTemplates','configNoTemplatesAvailable',
  'configImportThisTemplate','configSeeDetails','configImportCharmsTitle',
  'configImportCharmsFullDesc','configImportButton',
] as const;
const KEPT = ['exportButton', 'instancesCardTitle', 'configImportTemplateButton'] as const;

describe('extraction copy — legacy export keys removed', () => {
  it.each(REMOVED)('removed: %s', (k) => {
    expect(k in extraction).toBe(false);
  });
  it.each(KEPT)('kept (still referenced): %s', (k) => {
    expect(k in extraction).toBe(true);
  });
});
