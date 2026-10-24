/**
 * Turns what the user supplies (pasted text, a PubMed CSV export) into a PMID
 * list, or into the one reason it cannot be sent. Pure of React: the file read
 * lives here so no component needs a `try` around IO.
 */
import Papa from 'papaparse';

export const MAX_PMIDS = 10_000;
export const MAX_CSV_BYTES = 25 * 1024 * 1024;

export type PmidInputError = 'empty' | 'no_pmid_column' | 'invalid' | 'too_many' | 'file_too_large';
export type PmidParseResult =
  | {ok: true; pmids: string[]}
  | {ok: false; error: PmidInputError; invalid?: string[]};

const PMID = /^[0-9]{1,10}$/;
const INVALID_SHOWN = 5;

function validate(tokens: string[]): PmidParseResult {
  if (tokens.length === 0) return {ok: false, error: 'empty'};
  const invalid = tokens.filter((token) => !PMID.test(token));
  if (invalid.length > 0) return {ok: false, error: 'invalid', invalid: invalid.slice(0, INVALID_SHOWN)};
  if (tokens.length > MAX_PMIDS) return {ok: false, error: 'too_many'};
  return {ok: true, pmids: tokens};
}

/** Repeats are kept: the API counts them in `duplicate_in_request`. */
export function parsePmidText(text: string): PmidParseResult {
  return validate(text.split(/[\s,;]+/).filter((token) => token !== ''));
}

export async function parsePmidCsv(file: File): Promise<PmidParseResult> {
  if (file.size > MAX_CSV_BYTES) return {ok: false, error: 'file_too_large'};
  const parsed = Papa.parse<Record<string, string>>(await file.text(), {
    header: true,
    skipEmptyLines: true,
    // PubMed's export starts with a byte-order mark and quotes every header.
    transformHeader: (header) => header.replace(/^\uFEFF/, '').trim(),
  });
  const column = parsed.meta.fields?.find((field) => field.toLowerCase() === 'pmid');
  if (column === undefined) return {ok: false, error: 'no_pmid_column'};
  const values = parsed.data.map((row) => (row[column] ?? '').trim()).filter((value) => value !== '');
  return validate(values);
}
