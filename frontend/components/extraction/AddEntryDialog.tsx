/**
 * Add / rename dialogs for one entry of a repeating section.
 *
 * Every `cardinality='many'` section is an entry group: one entry is named
 * by the section's entry noun (`entry_label`) and identified by the value of
 * its key field (`is_entity_key`). The add dialog asks for that value (the
 * label is the same text), lists the siblings already present as chips and
 * blocks an exact duplicate — the guards the model container's dialog had
 * (identity spec §1), now for every repeating section. The container uses
 * this dialog too, since the follow-up train dropped its one extra input.
 * The rename dialog
 * edits the label and the identity apart: re-keying is how a reviewer tells
 * the next AI re-run which entry a finding belongs to (§7 keeps merge out).
 *
 * A keyless section (no `is_entity_key` field) still gets the add dialog:
 * the input is a plain label and nothing is stamped — AI extraction refuses
 * on such a section, the human path does not.
 *
 * Copy interpolates `{{noun}}` at each call site (B-8 D7); the key field's
 * label is DATA and is shown as-is.
 */
import {useState, type FormEvent} from 'react';

import {Alert, AlertDescription} from '@/components/ui/alert';
import {Button} from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {AlertCircle, Loader2, Pencil, Sparkles} from 'lucide-react';
import {t} from '@/lib/copy';
import {isDuplicateEntryKey} from '@/lib/extraction/entryKey';

export interface EntryIdentityChanges {
  label: string;
  /** Null when the section declares no key field. */
  entityKey: string | null;
}

/** Validation shared by both dialogs; null when the value is acceptable. */
function keyProblem(
  value: string,
  existing: readonly string[],
  noun: string,
  fieldLabel: string,
): string | null {
  if (!value.trim()) {
    return t('extraction', 'entryKeyEmpty').replace('{{key}}', fieldLabel);
  }
  if (isDuplicateEntryKey(value, existing)) {
    return t('extraction', 'entryKeyDuplicate')
      .replace('{{noun}}', noun)
      .replace('{{key}}', fieldLabel.toLowerCase());
  }
  return null;
}

/** The error a failed confirm shows: the thrown message, else the fallback.
 * A plain function — the React Compiler cannot compile conditionals inside
 * a component's try/catch, so the branching lives out here. */
function failureMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function SiblingChips({keys}: {keys: readonly string[]}) {
  if (keys.length === 0) return null;
  return (
    <div className="bg-muted/40 rounded-lg p-3 border border-border/40">
      <p className="text-xs text-muted-foreground font-medium mb-2">
        {t('extraction', 'modelsAlreadyAdded')}
      </p>
      <div className="flex flex-wrap gap-2">
        {keys.map((name, index) => (
          <span
            key={`${name}-${index}`}
            className="text-xs bg-card px-2 py-1 rounded border border-border/60 text-foreground"
          >
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}

function KeyHint({noun, keyLabel}: {noun: string; keyLabel: string | null}) {
  return (
    <p className="text-xs text-muted-foreground">
      {keyLabel
        ? t('extraction', 'entryKeyHint')
            .replace('{{noun}}', noun)
            .replace('{{key}}', keyLabel.toLowerCase())
        : t('extraction', 'modelNameHint').replace('{{noun}}', noun)}
    </p>
  );
}

function ErrorAlert({error}: {error: string | null}) {
  if (!error) return null;
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  );
}

// =================== ADD ===================

export interface AddEntryDialogProps {
  open: boolean;
  /** The section's entry noun (`entry_label`, or the fallback). */
  entryLabel: string;
  /** Label of the section's key field; null on a keyless section. */
  keyLabel: string | null;
  /** Identities of the entries already at this coordinate (chips + duplicate block). */
  existingKeys: string[];
  onConfirm: (keyValue: string) => Promise<void>;
  onCancel: () => void;
}

export function AddEntryDialog({
  open,
  entryLabel,
  keyLabel,
  existingKeys,
  onConfirm,
  onCancel,
}: AddEntryDialogProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Reset on close — adjusted during render instead of via effect.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) {
      setValue('');
      setError(null);
      setLoading(false);
    }
  }
  const fieldLabel = keyLabel ?? t('extraction', 'entryLabelField');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = keyProblem(value, existingKeys, entryLabel, fieldLabel);
    if (problem) {
      setError(problem);
      return;
    }
    setLoading(true);
    setError(null);
    const fallback = t('extraction', 'modelCreateError').replace('{{noun}}', entryLabel);
    try {
      await onConfirm(value.trim());
      // The parent closes the dialog; the close resets the state above.
    } catch (err: unknown) {
      setError(failureMessage(err, fallback));
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && !loading && onCancel()}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              {t('extraction', 'addNewModel').replace('{{noun}}', entryLabel)}
            </DialogTitle>
            <DialogDescription>
              {t('extraction', 'addNewModelDesc').replace('{{noun}}', entryLabel)}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="entry-key" className="flex items-center gap-1">
                {fieldLabel}
                <span className="text-destructive">*</span>
              </Label>
              <Input
                id="entry-key"
                placeholder={t('extraction', 'modelNamePlaceholder').replace('{{noun}}', entryLabel)}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                disabled={loading}
                autoFocus
                className={error ? 'border-destructive' : ''}
              />
              <KeyHint noun={entryLabel} keyLabel={keyLabel} />
            </div>

            <ErrorAlert error={error} />
            <SiblingChips keys={existingKeys} />
          </div>

          <DialogFooter>
            <Button size="sm" type="button" variant="outline" onClick={onCancel} disabled={loading}>
              {t('common', 'cancel')}
            </Button>
            <Button size="sm" type="submit" disabled={loading || !value.trim()}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('extraction', 'creating')}
                </>
              ) : (
                t('extraction', 'createModel').replace('{{noun}}', entryLabel)
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// =================== RENAME / RE-KEY ===================

export interface RenameEntryDialogProps {
  open: boolean;
  entryLabel: string;
  keyLabel: string | null;
  initialLabel: string;
  /** What the entry is currently identified by (see `displayEntryKey`). */
  initialKey: string | null;
  /** Identities of the OTHER entries at this coordinate. */
  siblingKeys: string[];
  onConfirm: (changes: EntryIdentityChanges) => Promise<void>;
  onCancel: () => void;
}

export function RenameEntryDialog({
  open,
  entryLabel,
  keyLabel,
  initialLabel,
  initialKey,
  siblingKeys,
  onConfirm,
  onCancel,
}: RenameEntryDialogProps) {
  const [label, setLabel] = useState(initialLabel);
  const [key, setKey] = useState(initialKey ?? '');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Re-seed from the entry each time the dialog opens (the same mounted
  // dialog serves whichever entry is active) — adjusted during render.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setLabel(initialLabel);
      setKey(initialKey ?? '');
      setError(null);
      setLoading(false);
    }
  }
  const labelField = t('extraction', 'entryLabelField');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!label.trim()) {
      setError(t('extraction', 'entryKeyEmpty').replace('{{key}}', labelField));
      return;
    }
    if (keyLabel) {
      const problem = keyProblem(key, siblingKeys, entryLabel, keyLabel);
      if (problem) {
        setError(problem);
        return;
      }
    }
    setLoading(true);
    setError(null);
    // No value blocks inside the try (React Compiler): resolve them first.
    const changes: EntryIdentityChanges = {
      label: label.trim(),
      entityKey: keyLabel ? key.trim() : null,
    };
    const fallback = t('extraction', 'errors_updateEntry').replace('{{noun}}', entryLabel);
    try {
      await onConfirm(changes);
    } catch (err: unknown) {
      setError(failureMessage(err, fallback));
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && !loading && onCancel()}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5 text-primary" />
              {t('extraction', 'renameEntryTitle').replace('{{noun}}', entryLabel)}
            </DialogTitle>
            <DialogDescription>
              {t('extraction', 'renameEntryDesc').replace('{{noun}}', entryLabel)}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="entry-rename-label" className="flex items-center gap-1">
                {labelField}
                <span className="text-destructive">*</span>
              </Label>
              <Input
                id="entry-rename-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                disabled={loading}
                autoFocus
              />
            </div>

            {keyLabel && (
              <div className="space-y-2">
                <Label htmlFor="entry-rename-key" className="flex items-center gap-1">
                  {keyLabel}
                  <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="entry-rename-key"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  disabled={loading}
                  className={error ? 'border-destructive' : ''}
                />
                <KeyHint noun={entryLabel} keyLabel={keyLabel} />
              </div>
            )}

            <ErrorAlert error={error} />
            <SiblingChips keys={siblingKeys} />
          </div>

          <DialogFooter>
            <Button size="sm" type="button" variant="outline" onClick={onCancel} disabled={loading}>
              {t('common', 'cancel')}
            </Button>
            <Button size="sm" type="submit" disabled={loading || !label.trim()}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('extraction', 'saving')}
                </>
              ) : (
                t('common', 'save')
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
