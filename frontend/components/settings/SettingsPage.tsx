import type {ReactNode} from 'react';

interface SettingsPageProps {
  intro?: ReactNode;
  /** SettingsGroup elements only; loading, empty and error states render inside a group. */
  children: ReactNode;
}

/** The one wrapper per settings section body. The view owns the `p-2` gutter; this owns the width. */
export function SettingsPage({intro, children}: SettingsPageProps) {
  return (
    <div className="mx-0 w-full max-w-3xl">
      {intro ? <p className="mb-4 text-[13px] text-muted-foreground">{intro}</p> : null}
      <div className="@container/settings">{children}</div>
    </div>
  );
}
