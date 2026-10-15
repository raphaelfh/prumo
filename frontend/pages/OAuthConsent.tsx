/**
 * `/oauth/consent?request=<id>`: an app (an MCP client) asks to connect to the
 * signed-in user's prumo account. The user allows (optionally with "Edit
 * project setup", when the app asked for it) or denies; either way the
 * browser goes back to the redirect URL the server built.
 */
import {useId, useState} from 'react';
import {useSearchParams} from 'react-router';
import {z} from 'zod';
import {AlertCircle, Check, CheckCircle2, Clock, Loader2, ShieldAlert} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Checkbox} from '@/components/ui/checkbox';
import {Label} from '@/components/ui/label';
import {useConsentRequest, useDecideConsent} from '@/hooks/user/useOAuthConsent';
import {t} from '@/lib/copy';
import {leaveApp} from '@/lib/navigation';
import {
  isAlreadyDecidedError,
  isRateLimitedError,
  isRequestGoneError,
  type OAuthConsentDecisionRequest,
  type OAuthConsentRequestRead,
} from '@/services/oauthConsentService';

const requestIdSchema = z.string().uuid();

/** The `?request=` id, or null when it is missing or not a uuid. */
function parseRequestId(raw: string | null): string | null {
  const parsed = requestIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * True inside any frame. The host headers already forbid framing; this is the
 * in-page backstop against clickjacking. A check that throws counts as framed.
 */
function isFramed(): boolean {
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
}

function ConsentFrame({children}: {children: React.ReactNode}) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm border-border/40 p-6 shadow-elev-card">{children}</Card>
    </main>
  );
}

function Progress({label}: {label: string}) {
  return (
    <ConsentFrame>
      <p role="status" className="flex items-center justify-center gap-2 py-6 text-[13px] text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {label}
      </p>
    </ConsentFrame>
  );
}

function Notice({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: React.ElementType;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <ConsentFrame>
      <div className="space-y-3 text-center">
        <Icon className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-base font-semibold">{title}</h1>
        <p className="text-[13px] text-muted-foreground">{body}</p>
        {action}
      </div>
    </ConsentFrame>
  );
}

function RetryButton({onClick, disabled}: {onClick: () => void; disabled?: boolean}) {
  return (
    <Button variant="default" onClick={onClick} disabled={disabled}>
      {t('oauthConsent', 'retry')}
    </Button>
  );
}

function ReadyView({
  request,
  pending,
  onDecide,
}: {
  request: OAuthConsentRequestRead;
  pending: boolean;
  onDecide: (body: OAuthConsentDecisionRequest) => void;
}) {
  const [write, setWrite] = useState(false);
  const writeId = useId();
  const hintId = useId();

  return (
    <ConsentFrame>
      <h1 className="text-base font-semibold">{t('oauthConsent', 'pageTitle')}</h1>

      <dl className="mt-4 space-y-2 text-[13px]">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="shrink-0 text-muted-foreground">{t('oauthConsent', 'clientLabel')}</dt>
          <dd className="min-w-0 text-right font-medium break-words">{request.client_name}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="shrink-0 text-muted-foreground">{t('oauthConsent', 'returnsTo')}</dt>
          <dd className="min-w-0 text-right font-mono text-xs break-all">{request.redirect_host}</dd>
        </div>
      </dl>

      <p className="mt-4 border-t border-border/40 pt-4 text-[13px] text-muted-foreground">
        {t('oauthConsent', 'accessAll')}
      </p>

      <ul className="mt-3 space-y-3 text-[13px]">
        <li className="flex items-center gap-2">
          <Check className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
          {t('oauthConsent', 'readItem')}
        </li>
        {request.offers_write && (
          <li className="flex items-start gap-2">
            <Checkbox
              id={writeId}
              checked={write}
              onCheckedChange={(checked) => setWrite(checked === true)}
              disabled={pending}
              aria-describedby={hintId}
              className="mt-0.5"
            />
            <div className="space-y-0.5">
              <Label htmlFor={writeId} className="text-[13px] font-normal">
                {t('oauthConsent', 'editLabel')}
              </Label>
              <p id={hintId} className="text-xs text-muted-foreground">
                {t('oauthConsent', 'editHint')}
              </p>
            </div>
          </li>
        )}
      </ul>

      <div className="mt-6 flex gap-2">
        <Button
          variant="outline"
          size="default"
          className="flex-1"
          disabled={pending}
          onClick={() => onDecide({approve: false, write: false})}
        >
          {t('oauthConsent', 'deny')}
        </Button>
        <Button
          size="default"
          className="flex-1"
          disabled={pending}
          onClick={() => onDecide({approve: true, write: request.offers_write && write})}
        >
          {t('oauthConsent', 'allow')}
        </Button>
      </div>

      {pending && (
        <p role="status" className="mt-3 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          {t('oauthConsent', 'submitting')}
        </p>
      )}
    </ConsentFrame>
  );
}

export default function OAuthConsent() {
  const [searchParams] = useSearchParams();
  const framed = isFramed();
  const requestId = parseRequestId(searchParams.get('request'));
  // Framed: load nothing, offer nothing.
  const consent = useConsentRequest(framed ? null : requestId);
  const decide = useDecideConsent(requestId ?? '');

  const submit = (body: OAuthConsentDecisionRequest) =>
    decide.mutate(body, {onSuccess: ({redirect_url}) => leaveApp(redirect_url)});

  const expired = <Notice icon={Clock} title={t('oauthConsent', 'expiredTitle')} body={t('oauthConsent', 'expiredBody')} />;

  if (framed) {
    return <Notice icon={ShieldAlert} title={t('oauthConsent', 'pageTitle')} body={t('oauthConsent', 'framedBody')} />;
  }
  if (requestId === null) return expired;
  // Before the error checks: once decided, a background read answering 409 is expected.
  if (decide.isSuccess) return <Progress label={t('oauthConsent', 'returning')} />;

  const error = decide.error ?? consent.error;
  if (error && isRequestGoneError(error)) return expired;
  if (error && isAlreadyDecidedError(error)) {
    return (
      <Notice icon={CheckCircle2} title={t('oauthConsent', 'decidedTitle')} body={t('oauthConsent', 'decidedBody')} />
    );
  }

  if (decide.error) {
    const lastBody = decide.variables;
    return (
      <Notice
        icon={AlertCircle}
        title={t('oauthConsent', 'pageTitle')}
        body={t('oauthConsent', isRateLimitedError(decide.error) ? 'rateLimited' : 'submitError')}
        action={<RetryButton onClick={() => lastBody && submit(lastBody)} />}
      />
    );
  }
  if (consent.error) {
    return (
      <Notice
        icon={AlertCircle}
        title={t('oauthConsent', 'pageTitle')}
        body={t('oauthConsent', isRateLimitedError(consent.error) ? 'rateLimited' : 'loadError')}
        action={<RetryButton onClick={() => void consent.refetch()} disabled={consent.isFetching} />}
      />
    );
  }
  if (consent.isPending) return <Progress label={t('oauthConsent', 'loading')} />;

  return <ReadyView request={consent.data} pending={decide.isPending} onDecide={submit} />;
}
