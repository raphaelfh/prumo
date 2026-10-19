/**
 * Batch-level copy shared by the notification bell and the batch details
 * sheet: why a batch stopped, and who started it.
 */
import {t} from '@/lib/copy';
import type {aiBatch} from '@/lib/copy/aiBatch';

type AiBatchKey = keyof typeof aiBatch;

// Batch stop codes (extraction_batch.ENGINE_STOP_CODES and
// extraction_batch_agent_guard) mapped to their `aiBatch` copy key. A code not
// mapped here reads `bellStoppedUnknown` — never the raw code.
const STOP_CODE_COPY_KEY: Record<string, AiBatchKey> = {
  MISSING_API_KEY: 'bellStoppedMissingKey',
  ENGINE_RETIRED: 'bellStoppedEngineRetired',
  LLM_ENDPOINT_UNAVAILABLE: 'bellStoppedEndpoint',
  AGENT_TOKEN_INACTIVE: 'bellStoppedTokenInactive',
  AGENT_RUNS_DISABLED: 'bellStoppedAgentRunsDisabled',
  AGENT_ENGINE_CHANGED: 'bellStoppedEngineChanged',
};

const ENGINE_STOP_CODES = new Set(['MISSING_API_KEY', 'ENGINE_RETIRED', 'LLM_ENDPOINT_UNAVAILABLE']);

export function stopCodeMessage(code: string | null): string {
  const key = code == null ? undefined : STOP_CODE_COPY_KEY[code];
  return t('aiBatch', key ?? 'bellStoppedUnknown');
}

/** A stop the user fixes in the engine settings (vs. an agent guard). */
export function isEngineStop(code: string | null): boolean {
  return code != null && ENGINE_STOP_CODES.has(code);
}

/**
 * "Started by agent · <token name>", or without the name once the token is
 * gone; null for a batch started in the app. The name is user text: it is
 * substituted by a function so `$&`-style patterns stay literal.
 */
export function agentOriginLabel(startedByAgent: boolean, tokenName: string | null): string | null {
  if (!startedByAgent) return null;
  if (!tokenName) return t('aiBatch', 'startedByAgent');
  return t('aiBatch', 'startedByAgentNamed').replace('{{name}}', () => tokenName);
}
