/**
 * Primitives shared by the inspector's field and section panes (B-8 T6
 * extraction — the section pane moved to its own file when
 * TemplateInspector outgrew the file-size ceiling).
 */
export function Label({
  children,
  htmlFor,
}: {
  children: React.ReactNode;
  htmlFor?: string;
}) {
  const cls =
    'mb-[3px] mt-[9px] block text-[11px] uppercase tracking-[0.05em] text-muted-foreground';
  if (htmlFor) {
    return (
      <label htmlFor={htmlFor} className={cls}>
        {children}
      </label>
    );
  }
  return <div className={cls}>{children}</div>;
}

export function ReadOnlyValue({
  children,
  muted,
}: {
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <div
      className={`rounded-md border bg-background px-2 py-1 ${muted ? 'text-muted-foreground' : ''}`}
    >
      {children}
    </div>
  );
}
