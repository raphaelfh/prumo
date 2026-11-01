/**
 * The abstract as read for screening: labelled sections when PubMed
 * structured it, else the raw text as one paragraph.
 */
import {parseStructuredAbstract} from '@/lib/screening/abstract';

export function StructuredAbstract({abstract}: {abstract: string}) {
  const sections = parseStructuredAbstract(abstract);
  if (sections === null) {
    return <p className="whitespace-pre-line leading-relaxed text-foreground">{abstract}</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {sections.map((section, index) =>
        section.label === null ? (
          <p key={index} className="leading-relaxed text-foreground">
            {section.text}
          </p>
        ) : (
          <section key={index} className="flex flex-col gap-0.5">
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
              {section.label}
            </h3>
            <p className="leading-relaxed text-foreground">{section.text}</p>
          </section>
        ),
      )}
    </div>
  );
}
