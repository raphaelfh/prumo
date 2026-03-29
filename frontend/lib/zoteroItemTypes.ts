/**
 * Zotero API item types (itemType field). Labels match Zotero English UI.
 * @see https://api.zotero.org/itemTypes
 */
export const ZOTERO_ITEM_TYPES: readonly { readonly value: string; readonly label: string }[] = [
    {value: 'artwork', label: 'Artwork'},
    {value: 'attachment', label: 'Attachment'},
    {value: 'audioRecording', label: 'Audio Recording'},
    {value: 'bill', label: 'Bill'},
    {value: 'blogPost', label: 'Blog Post'},
    {value: 'book', label: 'Book'},
    {value: 'bookSection', label: 'Book Section'},
    {value: 'case', label: 'Case'},
    {value: 'computerProgram', label: 'Computer Program'},
    {value: 'conferencePaper', label: 'Conference Paper'},
    {value: 'dataset', label: 'Dataset'},
    {value: 'dictionaryEntry', label: 'Dictionary Entry'},
    {value: 'document', label: 'Document'},
    {value: 'email', label: 'E-mail'},
    {value: 'encyclopediaArticle', label: 'Encyclopedia Article'},
    {value: 'film', label: 'Film'},
    {value: 'forumPost', label: 'Forum Post'},
    {value: 'hearing', label: 'Hearing'},
    {value: 'instantMessage', label: 'Instant Message'},
    {value: 'interview', label: 'Interview'},
    {value: 'journalArticle', label: 'Journal Article'},
    {value: 'letter', label: 'Letter'},
    {value: 'magazineArticle', label: 'Magazine Article'},
    {value: 'manuscript', label: 'Manuscript'},
    {value: 'map', label: 'Map'},
    {value: 'newspaperArticle', label: 'Newspaper Article'},
    {value: 'note', label: 'Note'},
    {value: 'patent', label: 'Patent'},
    {value: 'podcast', label: 'Podcast'},
    {value: 'preprint', label: 'Preprint'},
    {value: 'presentation', label: 'Presentation'},
    {value: 'radioBroadcast', label: 'Radio Broadcast'},
    {value: 'report', label: 'Report'},
    {value: 'standard', label: 'Standard'},
    {value: 'statute', label: 'Statute'},
    {value: 'thesis', label: 'Thesis'},
    {value: 'tvBroadcast', label: 'TV Broadcast'},
    {value: 'videoRecording', label: 'Video Recording'},
    {value: 'webpage', label: 'Web Page'},
] as const;

const LABEL_BY_VALUE: Record<string, string> = Object.fromEntries(
    ZOTERO_ITEM_TYPES.map((t) => [t.value, t.label])
);

export const ZOTERO_ITEM_TYPE_VALUES = new Set(ZOTERO_ITEM_TYPES.map((t) => t.value));

/** Sentinel for Select when value is not a known Zotero key (e.g. RIS TY code). */
export const ITEM_TYPE_CUSTOM_SELECT_VALUE = '__custom_item_type__';

/** Sentinel for empty / not set in Select. */
export const ITEM_TYPE_NONE_SELECT_VALUE = '__no_item_type__';

export function isKnownZoteroItemType(value: string | null | undefined): boolean {
    return !!value && ZOTERO_ITEM_TYPE_VALUES.has(value);
}

/** Human label for table UI; falls back to stored string. */
export function formatZoteroItemTypeForDisplay(value: string | null | undefined): string {
    if (value == null || value === '') return '\u2013';
    return LABEL_BY_VALUE[value] ?? value;
}
