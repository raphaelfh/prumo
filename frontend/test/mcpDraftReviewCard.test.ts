/**
 * Behavior of the read-only MCP Apps draft-review card
 * (`backend/app/api/mcp/apps/draft_review.html`), rendered for
 * `get_template` results. Results use the real `McpTemplateView` fields.
 */
import {afterEach, describe, expect, it, vi} from 'vitest';

import {type CardHarness, loadCard} from './mcpAppHarness';

let card: CardHarness | undefined;

function open(): CardHarness {
  card = loadCard('draft_review.html');
  return card;
}

afterEach(() => {
  card?.dispose();
  card = undefined;
  vi.useRealTimers();
});

function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    template_id: '00000000-0000-0000-0000-000000000001',
    template_name: 'CHARMS',
    project_name: 'Demo',
    view: 'published',
    kind: 'extraction',
    instrument: 'charms',
    published_version: 3,
    narrow: false,
    instruction: null,
    instruction_is_default: false,
    draft_open: true,
    sections: [],
    draft_diff: null,
    next_cursor: null,
    fingerprint: null,
    status: null,
    counts: null,
    changes: null,
    lint: null,
    note: null,
    editor_url: null,
    untrusted_content: true,
    untrusted_fields: [],
    ...overrides,
  };
}

function ok(structured: Record<string, unknown>): Record<string, unknown> {
  return {content: [{type: 'text', text: JSON.stringify(structured)}], structuredContent: structured, isError: false};
}

function err(code: string, message: string): Record<string, unknown> {
  const body = {code, message, retryable: false, next_step: null};
  return {content: [{type: 'text', text: JSON.stringify(body)}], structuredContent: body, isError: true};
}

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'r1',
    tier: 'semantic',
    variant: 'field_modified',
    label_path: ['Participants', 'Age'],
    attribute: 'label',
    before: 'Age',
    after: 'Age (years)',
    affects_recorded_data: false,
    affects_ai: true,
    ...overrides,
  };
}

function changesView(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return envelope({
    view: 'changes',
    status: 'available',
    counts: {additive: 1, semantic: 2},
    changes: [
      row(),
      row({id: 'r2', tier: 'additive', label_path: ['Outcomes'], attribute: null, before: null, after: 'Mortality', affects_ai: false}),
    ],
    ...overrides,
  });
}

describe('draft-review card', () => {
  it('initializes with the host, then announces it is initialized', () => {
    const c = open();
    const init = c.lastRequest('ui/initialize');
    expect(c.sent('ui/initialize')).toHaveLength(1);
    expect((init.params?.appInfo as {name: string}).name).toBe('prumo-draft-review');
    expect(c.sent('ui/notifications/initialized')).toHaveLength(0);

    c.reply(init.id as number, {protocolVersion: '2026-01-26', hostInfo: {name: 'h', version: '1'}, hostCapabilities: {}});

    expect(c.sent('ui/notifications/initialized')).toHaveLength(1);
  });

  it('waits for a result', () => {
    expect(open().text()).toContain('Waiting for the questionnaire…');
  });

  it('ignores messages from another source or without jsonrpc 2.0', () => {
    const c = open();
    c.deliver({jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: ok(envelope({draft_open: false}))}, null);
    c.deliver({method: 'ui/notifications/tool-result', params: ok(envelope({draft_open: false}))});

    expect(c.text()).toContain('Waiting for the questionnaire…');
    expect(c.text()).not.toContain('No unpublished changes');
  });

  it('shows the no-draft state', () => {
    const c = open();
    c.toolResult(ok(envelope({draft_open: false})));
    expect(c.text()).toContain('No unpublished changes');
  });

  it('shows the no-draft state for a draft view with a note', () => {
    const c = open();
    c.toolResult(ok(envelope({view: 'draft', draft_open: false, note: 'No draft is open; this is the published questionnaire.', lint: []})));
    expect(c.text()).toContain('No unpublished changes');
  });

  it.each([
    ['MANAGER_REQUIRED', 'Only managers can review the draft'],
    ['NOT_FOUND', 'This questionnaire was not found.'],
  ])('maps %s to its state text', (code, expected) => {
    const c = open();
    c.toolResult(err(code, 'server text'));
    expect(c.text()).toContain(expected);
    expect(c.text()).not.toContain('Waiting for the questionnaire…');
  });

  it('shows any other error code and message', () => {
    const c = open();
    c.toolResult(err('RATE_LIMITED', 'Too many calls; retry later.'));
    expect(c.text()).toContain('RATE_LIMITED');
    expect(c.text()).toContain('Too many calls; retry later.');
  });

  it('groups changes by tier with the affects-AI marker', () => {
    const c = open();
    c.toolResult(ok(changesView()));
    const text = c.text();
    expect(text).toContain('semantic');
    expect(text).toContain('additive');
    expect(text).toContain('Participants › Age');
    expect(text).toContain('Age (years)');
    expect(text).toContain('Mortality');
    expect(text.match(/affects AI/g)).toHaveLength(1);
  });

  it('says how many rows a paged changes view shows', () => {
    const c = open();
    c.toolResult(ok(changesView({next_cursor: 'abc'})));
    expect(c.text()).toContain('Showing 2 of 3');
  });

  it('renders the published draft diff and its truncation', () => {
    const c = open();
    c.toolResult(
      ok(
        envelope({
          draft_diff: {status: 'available', counts: {semantic: 5}, changes: [row()], changes_truncated: true, fingerprint: 'f'},
        }),
      ),
    );
    expect(c.text()).toContain('Participants › Age');
    expect(c.text()).toContain('Showing 1 of 5');
  });

  it('renders the draft view lint', () => {
    const c = open();
    c.toolResult(
      ok(
        envelope({
          view: 'draft',
          fingerprint: 'f',
          lint: [{code: 'EMPTY_SECTION', status: 'block', section_label: 'Outcomes', question_labels: ['Q1'], count: 2}],
        }),
      ),
    );
    const text = c.text();
    expect(text).toContain('EMPTY_SECTION');
    expect(text).toContain('block');
    expect(text).toContain('Outcomes');
    expect(text).toContain('Q1');
  });

  it('shows only a summary to a non-manager', () => {
    const c = open();
    c.toolResult(
      ok(envelope({draft_open: null, sections: [{name: 's', label: 'Participants', questions: [{label: 'Age'}, {label: 'Sex'}]}]})),
    );
    const text = c.text();
    expect(text).toContain('CHARMS');
    expect(text).toContain('3');
    expect(text).not.toContain('No unpublished changes');
    expect(document.querySelector('button')).toBeNull();
  });

  it('renders from the text content when structuredContent is absent', () => {
    const c = open();
    c.toolResult({content: [{type: 'text', text: JSON.stringify(changesView())}], isError: false});
    const fromText = c.text();
    c.dispose();

    const d = open();
    d.toolResult(ok(changesView()));
    expect(d.text()).toBe(fromText);
  });

  it('treats labels as text, never markup', () => {
    const c = open();
    c.toolResult(ok(changesView({changes: [row({label_path: ['<img src=x onerror=alert(1)>']})]})));
    expect(c.text()).toContain('<img src=x onerror=alert(1)>');
    expect(document.querySelector('img')).toBeNull();
  });

  it.each(['https://app.example/x', 'http://localhost:5173/x'])('opens %s through the host', (url) => {
    const c = open();
    c.toolResult(ok(changesView({editor_url: url})));
    const button = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Review and publish in prumo');
    expect(button).toBeDefined();
    button?.click();
    const links = c.sent('ui/open-link');
    expect(links).toHaveLength(1);
    expect(links[0].params).toEqual({url});
    expect(typeof links[0].id).toBe('number');
  });

  it.each(['javascript:alert(1)', 'data:text/html,x', 'not a url'])('refuses to open %s', (url) => {
    const c = open();
    c.toolResult(ok(changesView({editor_url: url})));
    document.querySelector('button')?.click();
    expect(c.sent('ui/open-link')).toHaveLength(0);
  });

  it('has no link without an editor_url and never calls a tool', () => {
    const c = open();
    c.toolResult(ok(changesView()));
    expect(document.querySelector('button')).toBeNull();
    expect(c.sent('tools/call')).toHaveLength(0);
  });
});
