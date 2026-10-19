/**
 * Behavior of the read-only MCP Apps AI-run card
 * (`backend/app/api/mcp/apps/ai_run.html`), rendered for `plan_ai_run`
 * (the plan) and `get_ai_runs` (progress). Results use the real
 * `McpAiRunPlan` / `McpAiRuns` fields.
 */
import {afterEach, describe, expect, it, vi} from 'vitest';

import {type CardHarness, type RpcMessage, loadCard} from './mcpAppHarness';

const PROJECT = '00000000-0000-0000-0000-0000000000a1';
const BATCH = '00000000-0000-0000-0000-0000000000b1';

let card: CardHarness | undefined;

function open(): CardHarness {
  vi.useFakeTimers();
  card = loadCard('ai_run.html');
  card.setVisibility('visible');
  return card;
}

afterEach(() => {
  card?.dispose();
  card = undefined;
  vi.useRealTimers();
});

function ok(structured: Record<string, unknown>): Record<string, unknown> {
  return {content: [{type: 'text', text: JSON.stringify(structured)}], structuredContent: structured, isError: false};
}

function err(code: string, message: string): Record<string, unknown> {
  const body = {code, message, retryable: false, next_step: null};
  return {content: [{type: 'text', text: JSON.stringify(body)}], structuredContent: body, isError: true};
}

function counts(overrides: Record<string, number> = {}): Record<string, number> {
  return {total: 4, queued: 1, running: 1, done: 2, done_with_issues: 0, needs_attention: 0, skipped: 0, not_run: 0, ...overrides};
}

function plan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    project: {id: PROJECT, name: 'Demo'},
    template: {id: '00000000-0000-0000-0000-0000000000c1', name: 'CHARMS'},
    engine: {provider: 'anthropic', model: 'claude-test-model', label: null, mode: 'fast', cost_tier: '$'},
    payer: 'your_key',
    counts: {requested: 5, will_run: 3, skipped: 2, remaining_beyond_cap: 7},
    skipped_by_reason: {ALREADY_HAS_AI_SUGGESTIONS: 2},
    articles: [],
    estimate: {basis: 'text_size_lower_bound', input_tokens_low: 1, llm_calls_low: 1, passes: 1},
    limits: {max_articles_per_run: 25, daily_remaining: 90},
    blockers: [],
    warnings: [{code: 'NO_PDF', message: 'One article has no PDF.'}],
    can_start: true,
    plan_token: 'aip1.x.y',
    expires_at: '2026-10-19T12:00:00Z',
    confirm: {article_count: 3, model: 'claude-test-model', payer: 'your_key'},
    confirmation: 'Start AI extraction on 3 articles with claude-test-model, paid with your key?',
    untrusted_content: true,
    untrusted_fields: [],
    ...overrides,
  };
}

function summary(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    batch_id: BATCH,
    template_name: 'CHARMS',
    state: 'active',
    stalled: false,
    started_by_agent: true,
    agent_token_name: 'agent',
    created_at: '2026-10-19T10:00:00Z',
    finished_at: null,
    counts: counts(),
    stop_code: null,
    stop_message: null,
    ...overrides,
  };
}

function item(title: string): Record<string, unknown> {
  return {
    article_id: '00000000-0000-0000-0000-0000000000d1',
    title,
    outcome: 'needs_attention',
    reason_code: 'NO_TEXT',
    message: 'The PDF has no text layer.',
    failed_sections: null,
    total_sections: null,
  };
}

function detail(run: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mode: 'detail',
    project_id: PROJECT,
    project_name: 'Demo',
    runs: [],
    run: {
      ...summary(),
      suggestions_created: 0,
      tokens_used: null,
      attention_items: [],
      next_cursor: null,
      review_hint: "Review the AI suggestions in prumo: open the project's extraction view for each article.",
      ...run,
    },
    untrusted_content: true,
    untrusted_fields: [],
  };
}

function list(runs: Record<string, unknown>[]): Record<string, unknown> {
  return {mode: 'list', project_id: PROJECT, project_name: 'Demo', runs, run: null, untrusted_content: true, untrusted_fields: []};
}

function calls(c: CardHarness): RpcMessage[] {
  return c.sent('tools/call');
}

function loadMore(): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Load more');
}

describe('AI-run card', () => {
  it('initializes with the host and waits for a result', () => {
    const c = open();
    const init = c.lastRequest('ui/initialize');
    expect((init.params?.appInfo as {name: string}).name).toBe('prumo-ai-run');
    expect(c.text()).toContain('Waiting for the AI run…');

    c.reply(init.id as number, {protocolVersion: '2026-01-26', hostInfo: {name: 'h', version: '1'}, hostCapabilities: {}});
    expect(c.sent('ui/notifications/initialized')).toHaveLength(1);
  });

  it('ignores messages from another source', () => {
    const c = open();
    c.deliver({jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: ok(list([]))}, null);
    expect(c.text()).toContain('Waiting for the AI run…');
  });

  describe('plan mode', () => {
    it('shows each blocker with its fix', () => {
      const c = open();
      c.toolResult(
        ok(
          plan({
            can_start: false,
            plan_token: null,
            expires_at: null,
            confirm: null,
            confirmation: null,
            blockers: [
              {code: 'AGENT_RUNS_OFF', reason_code: null, message: 'Agent runs are off.', fix: 'Ask a manager to allow them.', batch_id: null},
              {code: 'NOTHING_TO_RUN', reason_code: null, message: 'Nothing to run.', fix: 'Pick articles with a PDF.', batch_id: null},
            ],
          }),
        ),
      );
      const text = c.text();
      expect(text).toContain('Plan blocked');
      for (const part of ['Agent runs are off.', 'Ask a manager to allow them.', 'Nothing to run.', 'Pick articles with a PDF.']) {
        expect(text).toContain(part);
      }
      expect(text).not.toContain('Plan ready');
      expect(document.querySelector('button')).toBeNull();
    });

    it('shows a ready plan and the confirmation verbatim', () => {
      const c = open();
      c.toolResult(ok(plan()));
      const text = c.text();
      expect(text).toContain('Plan ready');
      expect(text).toContain('Will run: 3');
      expect(text).toContain('Skipped: 2');
      expect(text).toContain('Beyond the cap: 7');
      expect(text).toContain('ALREADY_HAS_AI_SUGGESTIONS: 2');
      expect(text).toContain('claude-test-model');
      expect(text).toContain('Your key');
      expect(text).toContain('One article has no PDF.');
      expect(text).toContain('Start AI extraction on 3 articles with claude-test-model, paid with your key?');
      expect(document.querySelector('button')).toBeNull();
    });

    it('never refreshes', () => {
      const c = open();
      c.toolResult(ok(plan()));
      vi.advanceTimersByTime(90_000);
      expect(calls(c)).toHaveLength(0);
    });
  });

  describe('detail refresh', () => {
    it('re-reads the run after 30 s without a cursor', () => {
      const c = open();
      c.toolResult(ok(detail({next_cursor: 'page2'})));
      vi.advanceTimersByTime(29_999);
      expect(calls(c)).toHaveLength(0);
      vi.advanceTimersByTime(1);
      expect(calls(c)).toHaveLength(1);
      expect(calls(c)[0].params).toEqual({name: 'get_ai_runs', arguments: {project_id: PROJECT, batch_id: BATCH}});
    });

    it('keeps one request in flight', () => {
      const c = open();
      c.toolResult(ok(detail()));
      vi.advanceTimersByTime(30_000);
      vi.advanceTimersByTime(60_000);
      expect(calls(c)).toHaveLength(1);

      c.reply(calls(c)[0].id as number, ok(detail()));
      vi.advanceTimersByTime(29_999);
      expect(calls(c)).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(calls(c)).toHaveLength(2);
    });

    it.each([
      ['finished', {state: 'finished', finished_at: '2026-10-19T11:00:00Z'}, ['Finished']],
      ['stopped', {state: 'stopped', stop_code: 'ENGINE_FAILED', stop_message: 'The model refused.'}, ['Stopped', 'ENGINE_FAILED', 'The model refused.']],
      ['cancelled', {state: 'cancelled'}, ['Cancelled']],
    ])('stops at a %s run', (_name, fields, texts) => {
      const c = open();
      c.toolResult(ok(detail()));
      vi.advanceTimersByTime(30_000);
      c.reply(calls(c)[0].id as number, ok(detail(fields)));
      for (const part of texts) {
        expect(c.text()).toContain(part);
      }
      vi.advanceTimersByTime(120_000);
      expect(calls(c)).toHaveLength(1);
    });

    it('stops after a JSON-RPC error', () => {
      const c = open();
      c.toolResult(ok(detail()));
      vi.advanceTimersByTime(30_000);
      c.replyError(calls(c)[0].id as number, {code: -32000, message: 'x'});
      expect(c.text()).toContain('-32000');
      vi.advanceTimersByTime(120_000);
      expect(calls(c)).toHaveLength(1);
    });

    it('stops after an error result', () => {
      const c = open();
      c.toolResult(ok(detail()));
      vi.advanceTimersByTime(30_000);
      c.reply(calls(c)[0].id as number, err('NOT_FOUND', 'server text'));
      expect(c.text()).toContain('This run was not found.');
      vi.advanceTimersByTime(120_000);
      expect(calls(c)).toHaveLength(1);
    });

    it('shows any other error code and message', () => {
      const c = open();
      c.toolResult(err('RATE_LIMITED', 'Too many calls; retry later.'));
      expect(c.text()).toContain('RATE_LIMITED');
      expect(c.text()).toContain('Too many calls; retry later.');
      vi.advanceTimersByTime(60_000);
      expect(calls(c)).toHaveLength(0);
    });

    it('sends nothing while hidden', () => {
      const c = open();
      c.toolResult(ok(detail()));
      c.setVisibility('hidden');
      vi.advanceTimersByTime(90_000);
      expect(calls(c)).toHaveLength(0);
      c.setVisibility('visible');
      vi.advanceTimersByTime(30_000);
      expect(calls(c)).toHaveLength(1);
    });

    it('renders attention items as text', () => {
      const c = open();
      c.toolResult(ok(detail({attention_items: [item('<img src=x onerror=alert(1)>')]})));
      expect(c.text()).toContain('<img src=x onerror=alert(1)>');
      expect(c.text()).toContain('The PDF has no text layer.');
      expect(document.querySelector('img')).toBeNull();
    });
  });

  describe('detail paging', () => {
    it('has no Load more control without a cursor', () => {
      open().toolResult(ok(detail({attention_items: [item('A')]})));
      expect(document.querySelector('button')).toBeNull();
    });

    it('loads the next page by cursor and appends it', () => {
      const c = open();
      c.toolResult(ok(detail({attention_items: [item('First article')], next_cursor: 'page2'})));
      loadMore()?.click();
      expect(calls(c)).toHaveLength(1);
      expect(calls(c)[0].params).toEqual({
        name: 'get_ai_runs',
        arguments: {project_id: PROJECT, batch_id: BATCH, cursor: 'page2'},
      });

      c.reply(calls(c)[0].id as number, ok(detail({attention_items: [item('Second article')], next_cursor: null})));
      expect(c.text()).toContain('First article');
      expect(c.text()).toContain('Second article');
      expect(loadMore()).toBeUndefined();
    });

    it('sends one page request at a time and skips the refresh meanwhile', () => {
      const c = open();
      c.toolResult(ok(detail({attention_items: [item('First article')], next_cursor: 'page2'})));
      loadMore()?.click();
      loadMore()?.click();
      vi.advanceTimersByTime(30_000);
      expect(calls(c)).toHaveLength(1);
    });

    it('sends no page request while a refresh is pending', () => {
      const c = open();
      c.toolResult(ok(detail({attention_items: [item('First article')], next_cursor: 'page2'})));
      vi.advanceTimersByTime(30_000);
      expect(calls(c)).toHaveLength(1);
      loadMore()?.click();
      expect(calls(c)).toHaveLength(1);
    });

    it('refreshes back to the first page', () => {
      const c = open();
      c.toolResult(ok(detail({attention_items: [item('First article')], next_cursor: 'page2'})));
      loadMore()?.click();
      c.reply(calls(c)[0].id as number, ok(detail({attention_items: [item('Second article')], next_cursor: null})));
      vi.advanceTimersByTime(30_000);
      expect(calls(c)).toHaveLength(2);
      expect((calls(c)[1].params?.arguments as Record<string, unknown>).cursor).toBeUndefined();

      c.reply(calls(c)[1].id as number, ok(detail({attention_items: [item('Fresh article')], next_cursor: 'page2'})));
      expect(c.text()).toContain('Fresh article');
      expect(c.text()).not.toContain('Second article');
      expect(loadMore()).toBeDefined();
    });
  });

  describe('list mode', () => {
    it('re-reads the project with only project_id while a run is active', () => {
      const c = open();
      c.toolResult(ok(list([summary(), summary({batch_id: 'other', state: 'finished'})])));
      vi.advanceTimersByTime(30_000);
      expect(calls(c)).toHaveLength(1);
      expect(calls(c)[0].params).toEqual({name: 'get_ai_runs', arguments: {project_id: PROJECT}});
    });

    it('never refreshes without an active run', () => {
      const c = open();
      c.toolResult(ok(list([summary({state: 'finished'}), summary({state: 'cancelled'})])));
      vi.advanceTimersByTime(120_000);
      expect(calls(c)).toHaveLength(0);
    });

    it('says when the project has no runs', () => {
      const c = open();
      c.toolResult(ok(list([])));
      expect(c.text()).toContain('No AI runs in this project yet.');
      vi.advanceTimersByTime(120_000);
      expect(calls(c)).toHaveLength(0);
    });

    it('labels active and stalled runs', () => {
      const c = open();
      c.toolResult(ok(list([summary({template_name: 'Alpha'}), summary({template_name: 'Beta', stalled: true})])));
      const rows = Array.from(document.querySelectorAll('li')).map((li) => li.textContent ?? '');
      expect(rows).toHaveLength(2);
      expect(rows[0]).toContain('Alpha');
      expect(rows[0]).toContain('Active');
      expect(rows[0]).not.toContain('Stalled');
      expect(rows[1]).toContain('Beta');
      expect(rows[1]).toContain('Stalled');
      expect(document.querySelector('button')).toBeNull();
    });
  });

  it('never opens a link', () => {
    const c = open();
    c.toolResult(ok(detail({next_cursor: 'page2'})));
    vi.advanceTimersByTime(30_000);
    expect(c.sent('ui/open-link')).toHaveLength(0);
  });
});
