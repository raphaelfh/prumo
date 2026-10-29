import {describe, expect, it, vi} from 'vitest';

import {MAX_CSV_BYTES, MAX_PMIDS, parsePmidCsv, parsePmidText} from '@/lib/screening/pmidInput';

const BOM = String.fromCharCode(0xfeff);

describe('parsePmidCsv', () => {
  it('finds a BOM-prefixed quoted PMID header', async () => {
    const file = new File([`${BOM}"PMID","Title"\n"42908551","A"\n"42875467","B"\n`], 'pubmed.csv');
    expect(await parsePmidCsv(file)).toEqual({ok: true, pmids: ['42908551', '42875467']});
  });

  it('reports a CSV without a PMID column', async () => {
    const file = new File(['Title,DOI\nA,10.1/x\n'], 'x.csv');
    expect(await parsePmidCsv(file)).toEqual({ok: false, error: 'no_pmid_column'});
  });

  it('refuses files over 25 MB without reading', async () => {
    const file = new File(['PMID\n1\n'], 'big.csv');
    Object.defineProperty(file, 'size', {value: MAX_CSV_BYTES + 1});
    const text = vi.spyOn(file, 'text');
    expect(await parsePmidCsv(file)).toEqual({ok: false, error: 'file_too_large'});
    expect(text).not.toHaveBeenCalled();
  });

  it('matches the PMID header case-insensitively and trims values', async () => {
    const file = new File(['title, pmid \nA, 7 \nB,\n'], 'x.csv');
    expect(await parsePmidCsv(file)).toEqual({ok: true, pmids: ['7']});
  });
});

describe('parsePmidText', () => {
  it('splits on whitespace, commas and semicolons and keeps repeats', () => {
    expect(parsePmidText('1, 2;3\n1')).toEqual({ok: true, pmids: ['1', '2', '3', '1']});
  });

  it('lists invalid tokens', () => {
    expect(parsePmidText('123 abc 45x')).toEqual({ok: false, error: 'invalid', invalid: ['abc', '45x']});
  });

  it('lists only the first five invalid tokens', () => {
    const result = parsePmidText('a b c d e f g');
    expect(result).toEqual({ok: false, error: 'invalid', invalid: ['a', 'b', 'c', 'd', 'e']});
  });

  it('rejects a PMID longer than ten digits', () => {
    expect(parsePmidText('12345678901')).toEqual({ok: false, error: 'invalid', invalid: ['12345678901']});
  });

  it('caps at 10,000', () => {
    const tokens = (n: number) => Array.from({length: n}, () => '1').join(' ');
    expect(parsePmidText(tokens(MAX_PMIDS))).toMatchObject({ok: true});
    expect(parsePmidText(tokens(MAX_PMIDS + 1))).toEqual({ok: false, error: 'too_many'});
  });

  it('reports empty input', () => {
    expect(parsePmidText('  \n ')).toEqual({ok: false, error: 'empty'});
  });
});
