/**
 * The screened record's meta: PMID/DOI links, the type and non-English
 * language chips, and the MeSH and keyword lines. Each hides when empty.
 */
import {Badge} from '@/components/ui/badge';
import {t} from '@/lib/copy';
import {doiUrl} from '@/lib/doi';
import {articleTypeChipLabel, languageChipLabel, pubmedUrl} from '@/lib/screening/recordMeta';
import type {ScreeningAssignmentRead} from '@/services/screeningService';

type ScreeningArticle = ScreeningAssignmentRead['article'];

const LINK_CLASS =
  'rounded-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

function Identifier({label, value, href}: {label: string; value: string; href: string | null}) {
  return (
    <span className="min-w-0 break-all">
      {label}{' '}
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
          {value}
        </a>
      ) : (
        value
      )}
    </span>
  );
}

/** `PMID 12345 · DOI 10.x/y`, each linked; null when both are missing. */
export function RecordIdentifiers({article}: {article: Pick<ScreeningArticle, 'pmid' | 'doi'>}) {
  const pmid = article.pmid?.trim() || null;
  const doi = article.doi?.trim() || null;
  if (pmid === null && doi === null) return null;
  return (
    <p className="flex flex-wrap gap-x-1.5 text-[13px] text-muted-foreground">
      {pmid && <Identifier label={t('screening', 'pmidLabel')} value={pmid} href={pubmedUrl(pmid)} />}
      {pmid && doi && <span aria-hidden="true">·</span>}
      {doi && <Identifier label={t('screening', 'doiLabel')} value={doi} href={doiUrl(doi)} />}
    </p>
  );
}

function Chip({label, srLabel}: {label: string; srLabel: string}) {
  return (
    <Badge variant="outline" className="font-medium">
      <span className="sr-only">{srLabel}</span>
      <span aria-hidden="true">{label}</span>
    </Badge>
  );
}

/** The article-type and non-English language chips; null when neither applies. */
export function RecordChips({article}: {article: Pick<ScreeningArticle, 'article_type' | 'language'>}) {
  const type = articleTypeChipLabel(article.article_type);
  const language = languageChipLabel(article.language);
  if (type === null && language === null) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {type && <Chip label={type} srLabel={t('screening', 'typeChipAria').replace('{{type}}', type)} />}
      {language && (
        <Chip label={language} srLabel={t('screening', 'languageChipAria').replace('{{language}}', language)} />
      )}
    </div>
  );
}

function TermLine({label, terms}: {label: string; terms: string[] | null}) {
  if (!terms || terms.length === 0) return null;
  return (
    <p className="text-[13px] text-muted-foreground">
      <span className="font-medium text-foreground">{label}</span> {terms.join(' · ')}
    </p>
  );
}

/** The MeSH and keyword lines; null when both are empty. */
export function RecordTerms({article}: {article: Pick<ScreeningArticle, 'mesh_terms' | 'keywords'>}) {
  const hasMesh = (article.mesh_terms?.length ?? 0) > 0;
  const hasKeywords = (article.keywords?.length ?? 0) > 0;
  if (!hasMesh && !hasKeywords) return null;
  return (
    <div className="flex flex-col gap-1">
      <TermLine label={t('screening', 'meshLabel')} terms={article.mesh_terms} />
      <TermLine label={t('screening', 'keywordsLabel')} terms={article.keywords} />
    </div>
  );
}
