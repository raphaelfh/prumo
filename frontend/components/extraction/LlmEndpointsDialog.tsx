/**
 * Custom-endpoint management dialog (§5.2, C2 C2).
 *
 * Opened from the engine popover footer; manager-only, like the chip that
 * hosts it. Lists the project's OpenAI-compatible endpoints (label, host,
 * validation badge, models count), adds/edits one through a Zod-validated
 * form, runs the capabilities probe, and deletes behind a destructive
 * confirm that surfaces the typed 409 when the project engine still points
 * at the row.
 *
 * The stored API key NEVER round-trips to the client — `has_api_key` is
 * the only trace it exists. The write side is therefore tri-state: a blank
 * key field on edit means KEEP (`api_key: null`), the explicit clear
 * control means CLEAR (`api_key: ""`), a typed value replaces. On create,
 * blank means a keyless endpoint (`api_key: null`); `""` would be a hard
 * 422 there, so the two blanks are never collapsed into one signal.
 *
 * Probe results land in local state as well as invalidating the list: the
 * badge and output-mode chip must answer the click that produced them,
 * not the refetch that follows it. That override is DROPPED on every
 * write to the row and on dismiss — the backend resets
 * validation_status/capabilities whenever base_url or allowed_models
 * changes, so a surviving verdict would assert "Verified" over a row the
 * engine picker has already stopped offering.
 */
import {useRef, useState} from 'react';
import {useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {z} from 'zod';
import {AlertTriangle, Pencil, Plus, ShieldCheck, Trash2, X} from 'lucide-react';
import {toast} from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {Button} from '@/components/ui/button';
import {Checkbox} from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {Input} from '@/components/ui/input';
import {Skeleton} from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  useCreateLlmEndpoint,
  useDeleteLlmEndpoint,
  useLlmEndpoints,
  useUpdateLlmEndpoint,
  useVerifyLlmEndpoint,
} from '@/hooks/extraction/useLlmEndpoints';
import {t} from '@/lib/copy';
import {endpointHost} from '@/lib/llmEndpointHost';
import {cn} from '@/lib/utils';
import type {
  LlmEndpointProbeResult,
  LlmEndpointRead,
} from '@/services/llmEndpointService';

type OutputMode = LlmEndpointProbeResult['output_mode'];
type ValidationStatus = LlmEndpointRead['validation_status'];

const MODE_COPY: Record<NonNullable<OutputMode>, string> = {
  tool: t('llmEngine', 'endpointModeTool'),
  native: t('llmEngine', 'endpointModeNative'),
  prompted: t('llmEngine', 'endpointModePrompted'),
};

const STATUS_COPY: Record<ValidationStatus, string> = {
  unverified: t('llmEngine', 'endpointStatusUnverified'),
  ok: t('llmEngine', 'endpointStatusOk'),
  failed: t('llmEngine', 'endpointStatusFailed'),
};

const STATUS_CLASS: Record<ValidationStatus, string> = {
  unverified: 'border-border bg-muted text-muted-foreground',
  ok: 'border-success/40 bg-success/10 text-success',
  failed: 'border-destructive/40 bg-destructive/10 text-destructive',
};

// Module scope, like MODE_COPY/STATUS_COPY above: the schema is a
// constant, and rebuilding it per render handed the resolver a new object
// on every keystroke.
const ENDPOINT_SCHEMA = z.object({
  label: z
    .string()
    .trim()
    .min(1, t('llmEngine', 'endpointValidationLabelRequired'))
    .max(80, t('llmEngine', 'endpointValidationLabelMax')),
  base_url: z
    .string()
    .trim()
    .url(t('llmEngine', 'endpointValidationBaseUrl'))
    // The backend refuses plaintext outright; failing here spares the
    // round-trip and says it where the hint already promised HTTPS.
    .refine(
      (value) => value.startsWith('https://'),
      t('llmEngine', 'endpointBaseUrlHint'),
    ),
  api_key: z.string(),
  clear_key: z.boolean(),
  allowed_models: z.array(z.string()),
});

type EndpointFormInput = z.infer<typeof ENDPOINT_SCHEMA>;

const EMPTY_FORM: EndpointFormInput = {
  label: '',
  base_url: '',
  api_key: '',
  clear_key: false,
  allowed_models: [],
};

/** Which form the dialog is showing, if any. */
type FormState =
  | {mode: 'create'}
  | {mode: 'edit'; endpoint: LlmEndpointRead}
  | null;

interface LlmEndpointsDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LlmEndpointsDialog({
  projectId,
  open,
  onOpenChange,
}: LlmEndpointsDialogProps) {
  const [formState, setFormState] = useState<FormState>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [modelDraft, setModelDraft] = useState('');
  // Probe outcomes keyed by endpoint id: the badge must answer the click
  // that produced it, before the invalidated list read comes back.
  const [probes, setProbes] = useState<Record<string, LlmEndpointProbeResult>>(
    {},
  );
  const modelInputRef = useRef<HTMLInputElement>(null);

  const endpointsQuery = useLlmEndpoints(projectId);
  const createEndpoint = useCreateLlmEndpoint(projectId);
  const updateEndpoint = useUpdateLlmEndpoint(projectId);
  const deleteEndpoint = useDeleteLlmEndpoint(projectId);
  const verifyEndpoint = useVerifyLlmEndpoint(projectId);

  const endpoints = endpointsQuery.data ?? [];
  const saving = createEndpoint.isPending || updateEndpoint.isPending;

  const form = useForm<EndpointFormInput>({
    resolver: zodResolver(ENDPOINT_SCHEMA),
    defaultValues: EMPTY_FORM,
  });

  /** A probe verdict is only true until the next write to that row. */
  const dropProbe = (endpointId: string) =>
    setProbes((current) => {
      if (!(endpointId in current)) return current;
      const next = {...current};
      delete next[endpointId];
      return next;
    });

  const handleOpenChange = (next: boolean) => {
    // The component stays MOUNTED at open=false, so a probe verdict or a
    // refused-delete banner would otherwise greet the next opener.
    if (!next) {
      setProbes({});
      setDeleteError(null);
    }
    onOpenChange(next);
  };

  const openCreateForm = () => {
    setSaveError(null);
    setModelDraft('');
    form.reset(EMPTY_FORM);
    setFormState({mode: 'create'});
  };

  const openEditForm = (endpoint: LlmEndpointRead) => {
    setSaveError(null);
    setModelDraft('');
    form.reset({
      label: endpoint.label,
      base_url: endpoint.base_url,
      api_key: '',
      clear_key: false,
      allowed_models: [...endpoint.allowed_models],
    });
    setFormState({mode: 'edit', endpoint});
  };

  const closeForm = () => {
    setFormState(null);
    setModelDraft('');
    form.reset(EMPTY_FORM);
  };

  const handleSubmit = (values: EndpointFormInput) => {
    setSaveError(null);
    const typedKey = values.api_key.trim();
    // Whatever sits in the tag input at submit time is a model id the
    // manager typed. The onBlur commit catches the pointer path; this
    // catches every other way a submit fires, so the field is never a
    // trap door that ships an endpoint with zero models.
    const draft = modelDraft.trim();
    const shared = {
      label: values.label,
      base_url: values.base_url,
      allowed_models:
        draft !== '' && !values.allowed_models.includes(draft)
          ? [...values.allowed_models, draft]
          : values.allowed_models,
    };
    setModelDraft('');
    const callbacks = {
      onError: (error: Error) => setSaveError(error.message),
    };

    if (formState?.mode === 'edit') {
      // null KEEPS the stored key, "" CLEARS it — never collapse the two.
      const apiKey = typedKey !== '' ? typedKey : values.clear_key ? '' : null;
      updateEndpoint.mutate(
        {endpointId: formState.endpoint.id, body: {...shared, api_key: apiKey}},
        {
          ...callbacks,
          onSuccess: () => {
            // A base_url / allowed_models change resets the row's
            // validation server-side: the stale verdict must go with it.
            dropProbe(formState.endpoint.id);
            toast.success(t('llmEngine', 'endpointUpdateSuccess'));
            closeForm();
          },
        },
      );
      return;
    }

    createEndpoint.mutate(
      // Blank on create means KEYLESS (local Ollama and friends); "" is a
      // 422 there, so it is null, not the clear signal.
      {...shared, api_key: typedKey !== '' ? typedKey : null},
      {
        ...callbacks,
        onSuccess: () => {
          toast.success(t('llmEngine', 'endpointCreateSuccess'));
          closeForm();
        },
      },
    );
  };

  const handleVerify = (endpointId: string) => {
    verifyEndpoint.mutate(endpointId, {
      onSuccess: (probe) =>
        setProbes((current) => ({...current, [endpointId]: probe})),
      onError: (error: Error) =>
        toast.error(`${t('llmEngine', 'endpointVerifyError')}: ${error.message}`),
    });
  };

  const handleDelete = (endpointId: string) => {
    setDeleteError(null);
    deleteEndpoint.mutate(endpointId, {
      onSuccess: () => {
        dropProbe(endpointId);
        toast.success(t('llmEngine', 'endpointDeleteSuccess'));
      },
      onError: (error: Error) => setDeleteError(error.message),
    });
  };

  const addModel = (field: {
    value: string[];
    onChange: (next: string[]) => void;
  }) => {
    const model = modelDraft.trim();
    if (model === '' || field.value.includes(model)) {
      setModelDraft('');
      return;
    }
    field.onChange([...field.value, model]);
    setModelDraft('');
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl">
        <TooltipProvider>
          <DialogHeader>
            <DialogTitle>{t('llmEngine', 'endpointsTitle')}</DialogTitle>
            <DialogDescription>
              {t('llmEngine', 'endpointsDesc')}
            </DialogDescription>
          </DialogHeader>

          {deleteError && (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-xs text-destructive"
            >
              {deleteError}
            </p>
          )}

          {/* A failed read and an empty project are different facts: one
              of them means the manager's endpoints are still there. */}
          {endpointsQuery.isPending ? (
            <div
              role="status"
              aria-label={t('llmEngine', 'endpointsLoading')}
              className="space-y-2 py-2"
            >
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : endpointsQuery.isError ? (
            <p className="py-4 text-center text-[13px] text-destructive">
              {t('llmEngine', 'endpointsLoadError')}
            </p>
          ) : endpoints.length === 0 ? (
            <p className="py-4 text-center text-[13px] text-muted-foreground">
              {t('llmEngine', 'endpointsEmpty')}
            </p>
          ) : (
            <ul className="divide-y divide-border/40">
              {endpoints.map((endpoint) => {
                const probe = probes[endpoint.id];
                const status = probe?.validation_status ?? endpoint.validation_status;
                const outputMode = probe
                  ? probe.output_mode
                  : endpoint.capabilities.output_mode;
                const probeError = probe?.error ?? null;
                return (
                  <li
                    key={endpoint.id}
                    data-testid={`llm-endpoint-row-${endpoint.id}`}
                    className="flex items-start gap-2 py-2"
                  >
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium">
                          {endpoint.label}
                        </span>
                        <span
                          className={cn(
                            'shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium',
                            STATUS_CLASS[status],
                          )}
                        >
                          {STATUS_COPY[status]}
                        </span>
                        {outputMode && (
                          <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {MODE_COPY[outputMode]}
                          </span>
                        )}
                      </div>
                      <p className="flex min-w-0 items-baseline gap-1.5 text-[11px] text-muted-foreground">
                        <span className="truncate">
                          {endpointHost(endpoint.base_url)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="shrink-0">
                          {t('llmEngine', 'endpointModelsCount').replace(
                            '{{count}}',
                            String(endpoint.allowed_models.length),
                          )}
                        </span>
                      </p>
                      {probeError && (
                        <p className="text-[11px] text-destructive">
                          {probeError}
                        </p>
                      )}
                      {outputMode === 'prompted' && (
                        <p className="flex items-start gap-1.5 text-[11px] text-warning">
                          <AlertTriangle
                            className="mt-0.5 h-3 w-3 shrink-0"
                            strokeWidth={1.5}
                            aria-hidden="true"
                          />
                          <span className="min-w-0">
                            {t('llmEngine', 'endpointPromptedWarn')}
                          </span>
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            aria-label={t('llmEngine', 'endpointVerifyAria')}
                            // Scoped to the row in flight: one slow probe
                            // (up to 60s) must not lock every other row's
                            // Verify button with it.
                            disabled={
                              verifyEndpoint.isPending &&
                              verifyEndpoint.variables === endpoint.id
                            }
                            onClick={() => handleVerify(endpoint.id)}
                          >
                            <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.5} />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t('llmEngine', 'endpointVerifyAria')}
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            aria-label={t('llmEngine', 'endpointEditAria')}
                            onClick={() => openEditForm(endpoint)}
                          >
                            <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t('llmEngine', 'endpointEditAria')}
                        </TooltipContent>
                      </Tooltip>
                      <AlertDialog>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                aria-label={t('llmEngine', 'endpointDeleteAria')}
                              >
                                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                              </Button>
                            </AlertDialogTrigger>
                          </TooltipTrigger>
                          <TooltipContent>
                            {t('llmEngine', 'endpointDeleteAria')}
                          </TooltipContent>
                        </Tooltip>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              {t('llmEngine', 'endpointDeleteTitle')}
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              {t('llmEngine', 'endpointDeleteDesc')}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>
                              {t('common', 'cancel')}
                            </AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleDelete(endpoint.id)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              {t('llmEngine', 'endpointDeleteConfirm')}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {formState === null ? (
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-fit gap-1.5 text-[13px] font-normal"
              onClick={openCreateForm}
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
              {t('llmEngine', 'endpointAddLabel')}
            </Button>
          ) : (
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(handleSubmit)}
                className="space-y-3 rounded-md border border-border/60 p-3"
              >
                <FormField
                  control={form.control}
                  name="label"
                  render={({field}) => (
                    <FormItem>
                      <FormLabel>{t('llmEngine', 'endpointLabelLabel')}</FormLabel>
                      <FormControl>
                        <Input {...field} disabled={saving} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="base_url"
                  render={({field}) => (
                    <FormItem>
                      <FormLabel>
                        {t('llmEngine', 'endpointBaseUrlLabel')}
                      </FormLabel>
                      <FormControl>
                        <Input {...field} disabled={saving} />
                      </FormControl>
                      <FormDescription className="text-[11px]">
                        {t('llmEngine', 'endpointBaseUrlHint')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="api_key"
                  render={({field}) => (
                    <FormItem>
                      <FormLabel>{t('llmEngine', 'endpointKeyLabel')}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="password"
                          autoComplete="off"
                          // Typing a key and asking to clear it are
                          // contradictory: each control switches the other
                          // off, so the submitted tri-state is never
                          // ambiguous. (Kept as paired setValue calls —
                          // `form.watch` is banned by React Compiler.)
                          onChange={(event) => {
                            field.onChange(event);
                            if (event.target.value !== '') {
                              form.setValue('clear_key', false);
                            }
                          }}
                          disabled={saving}
                          placeholder={t(
                            'llmEngine',
                            formState.mode === 'edit' &&
                              formState.endpoint.has_api_key
                              ? 'endpointKeyKeptPlaceholder'
                              : 'endpointKeyNewPlaceholder',
                          )}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {formState.mode === 'edit' && formState.endpoint.has_api_key && (
                  <FormField
                    control={form.control}
                    name="clear_key"
                    render={({field}) => (
                      <FormItem className="flex items-center gap-2 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={(checked) => {
                              field.onChange(checked === true);
                              if (checked === true) form.setValue('api_key', '');
                            }}
                            disabled={saving}
                          />
                        </FormControl>
                        <FormLabel className="text-[11px] font-normal text-muted-foreground">
                          {t('llmEngine', 'endpointKeyClearLabel')}
                        </FormLabel>
                      </FormItem>
                    )}
                  />
                )}

                <FormField
                  control={form.control}
                  name="allowed_models"
                  render={({field}) => (
                    <FormItem>
                      <FormLabel>
                        {t('llmEngine', 'endpointModelsLabel')}
                      </FormLabel>
                      {field.value.length > 0 && (
                        <ul className="flex flex-wrap gap-1">
                          {field.value.map((model) => (
                            <li
                              key={model}
                              className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px]"
                            >
                              <span className="font-mono">{model}</span>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-4 w-4 text-muted-foreground hover:text-foreground"
                                    aria-label={t(
                                      'llmEngine',
                                      'endpointModelRemoveAria',
                                    ).replace('{{model}}', model)}
                                    disabled={saving}
                                    onClick={() => {
                                      field.onChange(
                                        field.value.filter((m) => m !== model),
                                      );
                                      // The removed chip takes focus with
                                      // it; land it on the draft input
                                      // rather than on <body>.
                                      modelInputRef.current?.focus();
                                    }}
                                  >
                                    <X className="h-3 w-3" strokeWidth={1.5} />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {t(
                                    'llmEngine',
                                    'endpointModelRemoveAria',
                                  ).replace('{{model}}', model)}
                                </TooltipContent>
                              </Tooltip>
                            </li>
                          ))}
                        </ul>
                      )}
                      <FormControl>
                        <Input
                          ref={modelInputRef}
                          value={modelDraft}
                          onChange={(event) => setModelDraft(event.target.value)}
                          // Leaving the field commits what is in it: a
                          // manager who types a model id and reaches for
                          // Save with the mouse never loses it.
                          onBlur={() => addModel(field)}
                          onKeyDown={(event) => {
                            // Enter commits a chip instead of submitting the
                            // form — a half-typed model id must never ride
                            // along as a silent omission.
                            if (event.key !== 'Enter' && event.key !== ',') return;
                            event.preventDefault();
                            addModel(field);
                          }}
                          disabled={saving}
                        />
                      </FormControl>
                      <FormDescription className="text-[11px]">
                        {t('llmEngine', 'endpointModelsHint')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {saveError && (
                  <p
                    role="alert"
                    className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-xs text-destructive"
                  >
                    {saveError}
                  </p>
                )}

                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={closeForm}
                    disabled={saving}
                  >
                    {t('common', 'cancel')}
                  </Button>
                  <Button type="submit" size="sm" disabled={saving}>
                    {t('llmEngine', 'endpointSaveLabel')}
                  </Button>
                </div>
              </form>
            </Form>
          )}
        </TooltipProvider>
      </DialogContent>
    </Dialog>
  );
}
