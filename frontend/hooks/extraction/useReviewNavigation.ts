import {useState} from 'react';

export interface ReviewCoordinate {instanceId: string; fieldId: string}
export interface ReviewQuestion extends ReviewCoordinate {sectionId: string; label: string; pending: boolean; allowsNoInformation?: boolean}
export function sameReviewCoordinate(a: ReviewCoordinate | null, b: ReviewCoordinate | null): boolean {
  return !!a && !!b && a.instanceId === b.instanceId && a.fieldId === b.fieldId;
}

/** Question state is independent from disclosure and asynchronous job completion. */
export function useReviewNavigation({rows, scope, onNavigate}: {
  rows: ReviewQuestion[];
  scope: string;
  onNavigate?: (row: ReviewQuestion) => void;
}) {
  const [state, setState] = useState({scope, current: null as ReviewCoordinate | null, open: null as ReviewCoordinate | null, focused: false});
  const valid = (coordinate: ReviewCoordinate | null) => rows.find(row => sameReviewCoordinate(row, coordinate)) ?? null;
  const current = state.scope === scope ? valid(state.current) ?? rows[0] ?? null : rows[0] ?? null;
  const open = state.scope === scope ? valid(state.open) : null;
  const focused = state.scope === scope && (!state.current || !!valid(state.current)) && state.focused;
  if (state.scope !== scope || (state.current && !valid(state.current)) || (state.open && !open)) {
    setState({scope, current, open, focused});
  }
  const index = rows.findIndex(row => sameReviewCoordinate(row, current));
  const nextRow = rows.slice(index + 1).find(row => row.pending);
  const previousRow = index > 0 ? rows[index - 1] : undefined;
  const select = (row: ReviewQuestion) => {
    setState(previous => ({...previous, scope, current: row, open: focused ? row : previous.open}));
    onNavigate?.(row);
  };
  return {
    current, open, focused,
    canPrevious: !!previousRow, canNext: !!nextRow,
    select,
    activate: (row: ReviewCoordinate) => setState(previous => ({...previous, scope, current: row, open: focused ? row : previous.open})),
    previous: () => {if (previousRow) select(previousRow);},
    next: () => {if (nextRow) select(nextRow);},
    toggleFocus: () => {if (current) setState(previous => ({...previous, scope, current, focused: !focused, open: !focused ? current : previous.open}));},
    toggleDisclosure: (row: ReviewCoordinate) => setState(previous => ({...previous, scope, open: sameReviewCoordinate(open, row) ? null : row})),
  };
}
