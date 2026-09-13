import type {ReactNode} from 'react';

import {SETTINGS_ROW_GRID} from './SettingsRow';

/** A group's buttons, under the value column: primary `sm`, secondary `ghost sm`. */
export function SettingsActions({children}: {children: ReactNode}) {
  return (
    <div className={SETTINGS_ROW_GRID}>
      <div aria-hidden="true" className="hidden @[36rem]/settings:block" />
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
