/**
 * Serialized insert queue for the grid's ghost-row Enter-chain (B-5
 * Task 4). The panel keeps the OPTIMISTIC rows (pending state merged
 * into the tree before `buildTemplateTree` — never `setQueryData` on the
 * shared template-entity-types cache, which the worklist/dashboard read);
 * this hook owns the writes and the five concurrency rules:
 *
 *   1. every insert reports back by CLIENT KEY (`onConfirmed`) so the
 *      panel can reconcile its pending row with the server id
 *   2. structure invalidation is SUPPRESSED while the queue is non-empty
 *      and fires ONCE on drain (a 5-field chain must not race the
 *      pending rows with 10 refetches)
 *   3. `sort_order` is computed at DEQUEUE time — session base + inserts
 *      already committed into the section this session
 *   4. the collision suffix sees IN-QUEUE names (there is NO unique
 *      constraint on `(entity_type_id, name)`; a stale suffix would
 *      insert silent duplicates) — a collision never dead-ends mid-chain
 *   5. an edit on a still-pending row queues BEHIND its insert by client
 *      key and runs against the returned server id
 *
 * The permission probe is hoisted ONCE per queue session (not per
 * insert). The queue lives at MODULE scope — no try/finally in the hook
 * body (React Compiler `all_errors`); the async plumbing chains through
 * module-level functions, which the compiler never touches.
 *
 * B-4 invariant (migrated from the late field-management hook's
 * republish test): inserts are draft edits — NOTHING here republishes.
 *
 * @module hooks/extraction/useInsertTemplateField
 */

import {toast} from 'sonner';

import {useAuth} from '@/contexts/AuthContext';
import {useTemplateConfigCaches} from '@/hooks/extraction/useTemplateRepublish';
import {t} from '@/lib/copy';
import {uniqueFieldKey} from '@/lib/extraction/slug';
import {
  checkProjectPermissions,
  insertField,
  updateField,
} from '@/services/extractionFieldService';
import {
  ExtractionFieldSchema,
  type ExtractionField,
  type ExtractionFieldInsert,
  type ExtractionFieldUpdate,
} from '@/types/extraction';

export interface EnqueueInsertArgs {
  entityTypeId: string;
  /** Trimmed, non-empty label from the ghost editor. */
  label: string;
  /** Field names already COMMITTED in the section (fetched rows). Names
   * queued this session are tracked by the queue itself (rule 4). */
  existingNames: readonly string[];
  /** Max sort_order among committed fields in the section (fetched rows). */
  baseSortOrder: number;
}

export interface EnqueuedInsert {
  /** Panel-local identity of the optimistic row until the drain refetch. */
  clientKey: string;
  /** The collision-suffixed snake_case key the row will be inserted with. */
  name: string;
}

export interface UseInsertTemplateFieldArgs {
  projectId: string | undefined;
  templateId: string | undefined;
  /** The server confirmed a queued insert: reconcile the pending row
   * (client key → server row) and remap any focus coordinate. */
  onConfirmed: (clientKey: string, field: ExtractionField) => void;
  /** The insert failed (permission, validation, RLS): drop the row. */
  onFailed: (clientKey: string) => void;
  /** The queue drained AND the one structure refetch landed: confirmed
   * pending rows are now served by the cache and can be pruned.
   * `confirmed` maps client key → server id for every insert this
   * session landed, so the panel can remap its selection/inspector
   * focus to the row's new identity (the grid's focus coordinate
   * already follows via `rowIdRemaps`). */
  onDrained: (confirmed: ReadonlyMap<string, string>) => void;
}

// ---------------------------------------------------------------------------
// Module-scope queue (one Configuration panel is mounted at a time)
// ---------------------------------------------------------------------------

interface SessionDeps {
  userId: string | null;
  projectId: string | undefined;
  /** The typed field endpoints are template-scoped (B-7). */
  templateId: string | undefined;
  invalidateStructure: () => Promise<void>;
  onConfirmed: UseInsertTemplateFieldArgs['onConfirmed'];
  onFailed: UseInsertTemplateFieldArgs['onFailed'];
  onDrained: UseInsertTemplateFieldArgs['onDrained'];
}

interface QueueSession {
  /** Refreshed on every enqueue so late confirmations use live callbacks. */
  deps: SessionDeps;
  /** Hoisted ONCE per session — resolves to canCreate. */
  permissionProbe: Promise<boolean>;
  permissionToastShown: boolean;
  /** ONE toast per session for tasks that THREW (services return
   * ErrorResult, so a rejection is an unexpected bug/network wedge). */
  taskErrorToastShown: boolean;
  /** Names queued or committed this session, per section (rule 4). */
  takenNames: Map<string, Set<string>>;
  /** Which section each queued insert targets — a key EDIT on a
   * still-pending row must land in that section's takenNames (rule 4). */
  sectionByClientKey: Map<string, string>;
  /** Committed max sort_order per section, frozen at first enqueue. */
  sortBase: Map<string, number>;
  /** Inserts committed this session, per section (rule 3). */
  committedCount: Map<string, number>;
  /** Client key → server id, for updates queued behind inserts (rule 5). */
  serverIdByClientKey: Map<string, string>;
  /** Queued-but-unfinished tasks; 0 after a task ⇒ drain. */
  activeTasks: number;
}

let session: QueueSession | null = null;
let queueTail: Promise<void> = Promise.resolve();
let clientKeySeq = 0;

async function probePermission(deps: SessionDeps): Promise<boolean> {
  if (!deps.userId || !deps.projectId) return false;
  const result = await checkProjectPermissions(deps.userId, deps.projectId);
  return result.ok && result.data.canCreate;
}

function ensureSession(deps: SessionDeps): QueueSession {
  if (session) {
    session.deps = deps;
    return session;
  }
  const opened: QueueSession = {
    deps,
    permissionProbe: probePermission(deps),
    permissionToastShown: false,
    taskErrorToastShown: false,
    takenNames: new Map(),
    sectionByClientKey: new Map(),
    sortBase: new Map(),
    committedCount: new Map(),
    serverIdByClientKey: new Map(),
    activeTasks: 0,
  };
  session = opened;
  return opened;
}

/**
 * A task THREW (services return ErrorResult, so this is unexpected):
 * swallow the rejection so the tail chain recovers — an unhandled
 * rejection here would strand `activeTasks`, kill the drain, and chain
 * every later enqueue onto a rejected promise (silent data loss until
 * reload). Insert tasks carry their client key so the panel drops the
 * orphaned optimistic row; update tasks pass null (their row survives).
 */
function failTask(s: QueueSession, clientKey: string | null, error: unknown): void {
  console.error('[useInsertTemplateField] queued task threw:', error);
  if (!s.taskErrorToastShown) {
    s.taskErrorToastShown = true;
    const message = error instanceof Error ? error.message : String(error);
    const copyKey = clientKey ? 'errors_addField' : 'errors_updateField';
    toast.error(`${t('extraction', copyKey)}: ${message}`);
  }
  if (clientKey) s.deps.onFailed(clientKey);
}

function enqueueTask(
  s: QueueSession,
  clientKey: string | null,
  task: () => Promise<void>,
): void {
  s.activeTasks += 1;
  queueTail = queueTail
    .then(task)
    .catch((error: unknown) => failTask(s, clientKey, error))
    .then(() => finishTask(s));
}

async function finishTask(s: QueueSession): Promise<void> {
  s.activeTasks -= 1;
  if (s.activeTasks > 0) return;
  // Drain (rule 2): ONE structure invalidation for the whole chain.
  // invalidateQueries resolves after active queries refetched, so by
  // onDrained the cache serves every confirmed row.
  await s.deps.invalidateStructure();
  if (s.activeTasks > 0) return; // new work joined while the refetch ran
  if (session === s) session = null;
  s.deps.onDrained(new Map(s.serverIdByClientKey));
}

async function runInsert(
  s: QueueSession,
  clientKey: string,
  entityTypeId: string,
  name: string,
  label: string,
): Promise<void> {
  // Missing ids join the no-permission path: the endpoint is
  // project/template-scoped, so without them nothing can write.
  const {projectId, templateId} = s.deps;
  const allowed = projectId && templateId ? await s.permissionProbe : false;
  if (!allowed || !projectId || !templateId) {
    if (!s.permissionToastShown) {
      s.permissionToastShown = true;
      toast.error(t('extraction', 'errors_noPermissionAddField'));
    }
    s.deps.onFailed(clientKey);
    return;
  }

  // Rule 3: dequeue-time sort_order — the frozen committed base plus
  // every insert this session already landed in the section.
  const sortOrder =
    (s.sortBase.get(entityTypeId) ?? 0) + (s.committedCount.get(entityTypeId) ?? 0) + 1;

  // Ghost-insert defaults; same shape the late add-field dialog submitted.
  const zodResult = ExtractionFieldSchema.safeParse({
    name,
    label,
    description: null,
    field_type: 'text',
    is_required: false,
    validation_schema: {},
    sort_order: sortOrder,
  });
  if (!zodResult.success) {
    toast.error(
      t('extraction', 'errors_validationPrefix').replace(
        '{{message}}',
        zodResult.error.errors[0].message,
      ),
    );
    s.deps.onFailed(clientKey);
    return;
  }

  const newField: ExtractionFieldInsert = {
    entity_type_id: entityTypeId,
    name: zodResult.data.name,
    label: zodResult.data.label,
    description: null,
    field_type: zodResult.data.field_type,
    is_required: zodResult.data.is_required,
    validation_schema: zodResult.data.validation_schema ?? {},
    allowed_values: null,
    unit: null,
    allowed_units: null,
    sort_order: zodResult.data.sort_order,
  };

  const result = await insertField(projectId, templateId, newField);
  if (!result.ok) {
    console.error('[useInsertTemplateField] insert failed:', result.error);
    toast.error(`${t('extraction', 'errors_addField')}: ${result.error.message}`);
    s.deps.onFailed(clientKey);
    return;
  }

  s.committedCount.set(entityTypeId, (s.committedCount.get(entityTypeId) ?? 0) + 1);
  s.serverIdByClientKey.set(clientKey, result.data.id);
  s.deps.onConfirmed(clientKey, result.data);
}

async function runUpdate(
  s: QueueSession,
  clientKey: string,
  updates: ExtractionFieldUpdate,
): Promise<void> {
  const serverId = s.serverIdByClientKey.get(clientKey);
  if (!serverId) return; // its insert failed — the pending row is gone
  // A landed insert implies the ids existed; this narrows for TS only.
  const {projectId, templateId} = s.deps;
  if (!projectId || !templateId) return;
  const result = await updateField(projectId, templateId, serverId, updates);
  if (!result.ok) {
    console.error('[useInsertTemplateField] pending-row update failed:', result.error);
    toast.error(`${t('extraction', 'errors_updateField')}: ${result.error.message}`);
  }
}

function enqueueInsertTask(args: EnqueueInsertArgs, deps: SessionDeps): EnqueuedInsert {
  const s = ensureSession(deps);
  if (!s.sortBase.has(args.entityTypeId)) {
    s.sortBase.set(args.entityTypeId, args.baseSortOrder);
  }
  let taken = s.takenNames.get(args.entityTypeId);
  if (!taken) {
    taken = new Set();
    s.takenNames.set(args.entityTypeId, taken);
  }
  // Rule 4: the suffix must see IN-QUEUE names, not just committed ones.
  const name = uniqueFieldKey(args.label, new Set([...args.existingNames, ...taken]));
  taken.add(name);
  clientKeySeq += 1;
  const clientKey = `pending-field-${clientKeySeq}`;
  s.sectionByClientKey.set(clientKey, args.entityTypeId);
  const {entityTypeId, label} = args;
  enqueueTask(s, clientKey, () => runInsert(s, clientKey, entityTypeId, name, label));
  return {clientKey, name};
}

function enqueueUpdateTask(
  clientKey: string,
  updates: ExtractionFieldUpdate,
  deps: SessionDeps,
): void {
  // No session ⇒ the chain drained and the panel pruned its pending rows;
  // the row now lives under its server id and takes the normal mutation.
  if (!session) return;
  const s = session;
  s.deps = deps;
  // A key EDIT on the still-pending row renames it: later ghost inserts
  // must suffix against the NEW name too (rule 4). The old name stays
  // taken — reusing it mid-session risks a silent duplicate.
  if (typeof updates.name === 'string') {
    const sectionId = s.sectionByClientKey.get(clientKey);
    if (sectionId) s.takenNames.get(sectionId)?.add(updates.name);
  }
  // Rule 5: same FIFO as the inserts — the update runs BEHIND the insert
  // that creates its row, then resolves the client key to the server id.
  enqueueTask(s, null, () => runUpdate(s, clientKey, updates));
}

/** Test seam: the queue is module state, so suites must reset it. */
export function resetTemplateFieldInsertQueueForTests(): void {
  session = null;
  queueTail = Promise.resolve();
  clientKeySeq = 0;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useInsertTemplateField(args: UseInsertTemplateFieldArgs) {
  const {user} = useAuth();
  const {invalidateStructure} = useTemplateConfigCaches(args.projectId, args.templateId);

  const deps: SessionDeps = {
    userId: user?.id ?? null,
    projectId: args.projectId,
    templateId: args.templateId,
    invalidateStructure,
    onConfirmed: args.onConfirmed,
    onFailed: args.onFailed,
    onDrained: args.onDrained,
  };

  /** Synchronous: returns the client key + collision-suffixed name the
   * caller uses for its optimistic row; the write runs serialized. */
  const enqueueInsert = (request: EnqueueInsertArgs): EnqueuedInsert =>
    enqueueInsertTask(request, deps);

  /** Edit on a still-pending row: queued behind its insert (rule 5). */
  const enqueueUpdate = (clientKey: string, updates: ExtractionFieldUpdate): void =>
    enqueueUpdateTask(clientKey, updates, deps);

  return {enqueueInsert, enqueueUpdate};
}
