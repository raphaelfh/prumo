import type {ReactNode} from 'react';
import {NavigationControls} from './NavigationControls';
import {ZoomControls} from './ZoomControls';

export function Toolbar({
  className,
  leading,
  trailing,
}: {
  className?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-2 px-3 py-2 border-b bg-background ${className ?? ''}`}
    >
      <div className="flex items-center gap-3">
        {leading}
        <NavigationControls />
      </div>
      <div className="flex items-center gap-3">
        <ZoomControls />
        {trailing}
      </div>
    </div>
  );
}
