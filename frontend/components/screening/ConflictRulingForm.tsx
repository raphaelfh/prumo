/**
 * The arbitrator's ruling on one record in conflict, inside the record panel.
 * Reviewers are labelled "Reviewer A / B / C" in the server's order, never by
 * name (spec §4.4: less authority bias); the payload keeps the names for
 * every other state. A ruling adopts one decision or decides differently;
 * the optional note rides either, and every ruling names every decision the
 * arbitrator saw, so the server refuses it when they changed since. Each
 * reviewer's own note (`rationale`) shows under their line.
 */
import {zodResolver} from '@hookform/resolvers/zod';
import {useState} from 'react';
import {useForm} from 'react-hook-form';
import {z} from 'zod';

import {Button} from '@/components/ui/button';
import {Form, FormControl, FormField, FormItem, FormLabel, FormMessage} from '@/components/ui/form';
import {Textarea} from '@/components/ui/textarea';
import {t} from '@/lib/copy';
import type {
  ScreeningArbitrationCreate,
  ScreeningAssignmentRead,
  ScreeningPhase,
} from '@/services/screeningService';

import {DecisionButtons} from './DecisionButtons';
import {decisionLabel} from './ScreeningParts';

type Ruling = Omit<ScreeningArbitrationCreate, 'ruled_on_decision_ids' | 'rationale'>;

const NOTE_MAX = 2000;
const noteSchema = z.object({rationale: z.string().max(NOTE_MAX)});
type NoteValues = z.infer<typeof noteSchema>;

function reviewerLabel(index: number): string {
  return t('screening', 'reviewerLetter').replace('{{letter}}', String.fromCharCode(65 + index));
}

export interface ConflictRulingFormProps {
  read: ScreeningAssignmentRead;
  busy: boolean;
  onRule: (body: ScreeningArbitrationCreate) => void;
  /** The record's phase: at full text the override has no Maybe and an exclusion needs a reason. */
  phase: ScreeningPhase;
}

export function ConflictRulingForm({read, busy, onRule, phase}: ConflictRulingFormProps) {
  const form = useForm<NoteValues>({resolver: zodResolver(noteSchema), defaultValues: {rationale: ''}});
  const [deciding, setDeciding] = useState(false);
  const ruledOn = read.peer_decisions.map((d) => d.id);

  const rule = (ruling: Ruling) =>
    void form.handleSubmit(({rationale}) => {
      onRule({
        ruled_on_decision_ids: ruledOn,
        ...ruling,
        ...(rationale.trim() ? {rationale: rationale.trim()} : {}),
      });
    })();

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {read.peer_decisions.map((d, index) => {
          const label = reviewerLabel(index);
          return (
            // A grid, not a wrapping flex row: a long reason wraps inside its
            // column instead of pushing this reviewer's button onto a line of its own.
            <li key={d.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[13px] text-foreground">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium">{decisionLabel(d.decision)}</span>
                  {d.exclusion_reason && <span className="text-muted-foreground">{d.exclusion_reason}</span>}
                </p>
                {d.rationale && (
                  <p className="whitespace-pre-line break-words text-[13px] text-muted-foreground">
                    {t('screening', 'peerNote').replace('{{note}}', () => d.rationale ?? '')}
                  </p>
                )}
              </div>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => rule({selected_decision_id: d.id})}>
                {t('screening', 'useDecisionOf').replace('{{name}}', label)}
              </Button>
            </li>
          );
        })}
      </ul>

      <Form {...form}>
        <form onSubmit={(event) => event.preventDefault()} className="flex flex-col gap-3">
          <FormField
            control={form.control}
            name="rationale"
            render={({field}) => (
              <FormItem>
                <FormLabel className="text-xs font-medium text-muted-foreground">
                  {t('screening', 'rulingNote')}
                </FormLabel>
                <FormControl>
                  <Textarea rows={2} maxLength={NOTE_MAX} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </Form>

      <div className="flex flex-col gap-2">
        <div>
          <Button size="sm" variant="ghost" aria-expanded={deciding} onClick={() => setDeciding((open) => !open)}>
            {t('screening', 'decideDifferently')}
          </Button>
        </div>
        {deciding && (
          <DecisionButtons
            reasons={read.exclusion_reasons}
            disabled={busy}
            onDecide={({decision, exclusion_reason}) => rule({decision, exclusion_reason})}
            phase={phase}
            withNote={false}
          />
        )}
      </div>
    </div>
  );
}
