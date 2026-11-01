/**
 * Splits a structured abstract (PubMed writes `LABEL: text` paragraphs) into
 * labelled sections. Anything that is not clearly structured stays plain text,
 * so prose such as "Note: ..." or an inline "BACKGROUND: ... METHODS: ..." is
 * never broken into a misleading section list.
 */
export interface AbstractSection {
  label: string | null;
  text: string;
}

const LABEL = /^([A-Z][A-Z0-9 ,/&()'-]{0,39}):\s+/;

/** null → render the raw abstract as plain text. */
export function parseStructuredAbstract(raw: string): AbstractSection[] | null {
  const parts = raw
    .split(/\n\s*\n|\n/)
    .map((part) => part.trim())
    .filter((part) => part !== '');

  const sections: AbstractSection[] = [];
  for (const part of parts) {
    const match = LABEL.exec(part);
    if (match) {
      sections.push({label: match[1].trim(), text: part.slice(match[0].length).trim()});
    } else if (sections.length === 0) {
      sections.push({label: null, text: part});
    } else {
      return null;
    }
  }

  const labelled = sections.filter((section) => section.label !== null).length;
  return labelled >= 2 ? sections : null;
}
