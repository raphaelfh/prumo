/**
 * Review table workspace — production browser coverage (local-hitl, serial).
 *
 * Every case owns a fresh article/run from `createReviewWorkspace` (persisted
 * per-call proposals and evidence, a real one-page PDF) and deletes exactly
 * that graph afterwards. Decisions go through the real backend; the only
 * transport seam is the section-extraction POST/status route in the job
 * independence case, so no AI provider is ever called.
 */
import AxeBuilder from '@axe-core/playwright';
import {expect, test as base, type Page} from '@playwright/test';
import {loginViaUi} from '../_fixtures/auth';
import {adminSelect} from '../_fixtures/supabase-admin';
import {createReviewWorkspace, REVIEW_QUOTES, REVIEW_VALUE, SECONDARY_VALUE} from '../_fixtures/extraction-review-workspace';

type Workspace = Awaited<ReturnType<typeof createReviewWorkspace>>;
const test = base.extend<{workspace: Workspace}>({
  workspace: async ({page, request}, provide) => {
    const token = await loginViaUi(page);
    const workspace = await createReviewWorkspace(request, token);
    try {await provide(workspace);} finally {await workspace.cleanup();}
  },
});
test.describe.configure({retries: 0, timeout: 120000});

type Decision = {id: string; field_id: string; value: unknown; proposal_record_id: string | null};
const decisionsFor = (runId: string) => adminSelect<Decision>('extraction_reviewer_decisions', `run_id=eq.${runId}&select=id,field_id,value,proposal_record_id&order=created_at,id`);
const toolbar = (page: Page) => page.getByRole('toolbar', {name: 'Review suggestion'});
const rowFor = (page: Page, label: string) => page.getByRole('row').filter({has: page.getByRole('rowheader', {name: label, exact: true})});
const disclosureFor = (page: Page, coordinate: Workspace['coordinates'][number]) => page.locator(`#review-disclosure-${coordinate.instanceId}_${coordinate.id}`);
const noPageOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const reviewPane = (page: Page) => page.locator('[data-scroll-container="extraction-form"] [data-radix-scroll-area-viewport]');
/** Top of the review pane: the pinned toolbar and section headers sit in flow and cover no row. */
const scrollReviewPaneToTop = (page: Page) => reviewPane(page).evaluate(viewport => {viewport.scrollTop = 0;});
/** Width observed by the table's ResizeObserver — the review pane, not the viewport. */
const reviewPaneWidth = (page: Page) => page.locator('table').first().locator('xpath=..').evaluate(element => element.getBoundingClientRect().width);
/** Question rows not hidden by focus mode. */
const visibleRowCount = (page: Page) => page.locator('tr[data-field-row]:not([hidden])').count();
/** The section guide's current row must name the section that owns `coordinate`. */
async function expectGuideOn(page: Page, coordinate: Workspace['coordinates'][number]) {
  const [section] = await adminSelect<{label: string}>('extraction_entity_types', `id=eq.${coordinate.entity_type_id}&select=label`);
  if (!section) throw new Error(`Section ${coordinate.entity_type_id} is missing.`);
  const current = page.getByRole('navigation', {name: 'Section navigation', exact: true}).locator('button[aria-current="true"]');
  await expect(current).toHaveCount(1);
  await expect(current).toHaveAccessibleName(new RegExp(`^${section.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`));
}

async function openWorkspace(page: Page, url: string, viewport = {width: 1920, height: 1080}) {
  await page.setViewportSize(viewport);
  await page.goto(url);
  await expect(toolbar(page)).toBeVisible();
}

/** Focusing a question's label makes it the toolbar's current question. */
async function activate(page: Page, label: string) {
  await page.getByRole('rowheader', {name: label, exact: true}).locator('[tabindex="0"]').focus();
  await expect(toolbar(page).getByText(label, {exact: true})).toBeVisible();
}

async function setSourcePanel(page: Page, open: boolean) {
  const toggle = page.getByRole('button', {name: 'Toggle source panel', exact: true});
  if ((await toggle.getAttribute('aria-pressed')) !== String(open)) await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', String(open));
}

/** Drag the document split until the review pane is within 12px of `target`. */
async function setReviewPaneWidth(page: Page, target: number) {
  const separator = page.locator('[data-group] > [role="separator"]');
  await expect(separator, 'the document split separator renders only while the source panel is open').toHaveCount(1);
  for (let attempt = 0; attempt < 4; attempt++) {
    const width = await reviewPaneWidth(page);
    if (Math.abs(width - target) <= 12) return width;
    const box = await separator.boundingBox();
    if (!box) throw new Error('Document split separator has no layout box.');
    const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + target - width, y, {steps: 8});
    await page.mouse.up();
  }
  return reviewPaneWidth(page);
}

test('acceptance survives reload and reversal appends history; undo stays on its original question', async ({page, workspace}) => {
  await openWorkspace(page, workspace.url);
  const [first, second] = workspace.coordinates;
  const row = rowFor(page, first.label);
  const editor = page.getByRole('textbox', {name: first.label, exact: true});
  await expect(editor).toBeVisible();
  await editor.fill('Original reviewer value');
  await toolbar(page).click();
  await expect.poll(async () => (await decisionsFor(workspace.runId)).length).toBe(1);
  await row.getByRole('button', {name: 'Accept extraction', exact: true}).click();
  await expect(row.getByRole('button', {name: 'Unaccept extraction', exact: true})).toBeVisible();
  await expect(editor).toHaveValue(REVIEW_VALUE);
  await page.reload();
  await expect(row.getByRole('button', {name: 'Unaccept extraction', exact: true})).toBeVisible();
  await row.getByRole('button', {name: 'Unaccept extraction', exact: true}).click();
  await expect(editor).toHaveValue('Original reviewer value');
  await expect.poll(async () => (await decisionsFor(workspace.runId)).length).toBe(3);
  await page.reload();
  await expect(editor).toHaveValue('Original reviewer value');
  await row.getByRole('button', {name: 'Accept extraction', exact: true}).click();
  await expect.poll(async () => (await decisionsFor(workspace.runId)).length).toBe(4);
  const before = await decisionsFor(workspace.runId);
  expect(before.map(decision => decision.proposal_record_id === null)).toEqual([true, false, true, false]);
  expect(before[3].value).toEqual({value: REVIEW_VALUE});
  await page.getByRole('textbox', {name: second.label, exact: true}).focus();
  await page.getByRole('button', {name: 'Undo latest local decision', exact: true}).click();
  await expect.poll(async () => (await decisionsFor(workspace.runId)).length).toBe(5);
  const after = await decisionsFor(workspace.runId);
  expect(after.slice(0, 4)).toEqual(before);
  expect(after[4]).toMatchObject({field_id: first.id, proposal_record_id: null, value: {value: 'Original reviewer value'}});
  expect(after.filter(decision => decision.field_id === second.id)).toHaveLength(0);
  await page.reload();
  await expect(editor).toHaveValue('Original reviewer value');
  await expect(page.getByRole('textbox', {name: second.label, exact: true})).toHaveValue('');
});

test('two generations compare side by side, each source locates, unavailable anchors keep the card, axe and reduced motion', async ({page, workspace}) => {
  await openWorkspace(page, workspace.url);
  const [first, second] = workspace.coordinates;
  await rowFor(page, first.label).getByRole('button', {name: REVIEW_VALUE, exact: true}).click();
  const disclosure = disclosureFor(page, first);
  await expect(disclosure.getByRole('article')).toHaveCount(1);
  await expect(disclosure.getByText('1 / 2', {exact: true})).toBeVisible();
  await disclosure.getByRole('button', {name: 'Compare extractions', exact: true}).click();
  const cards = disclosure.getByRole('article');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0).locator('header').getByText('fixture-model-2', {exact: true})).toBeVisible();
  await expect(cards.nth(1).locator('header').getByText('fixture-model-1', {exact: true})).toBeVisible();
  await expect(cards.nth(0).getByText(/^Generation 2 independently/)).toBeVisible();
  await expect(cards.nth(1).getByText(/^Generation 1 independently/)).toBeVisible();
  const [left, right] = [await cards.nth(0).boundingBox(), await cards.nth(1).boundingBox()];
  expect(left && right && Math.abs(left.y - right.y) < 2 && right.x >= left.x + left.width, 'equal-valued generations render side by side').toBe(true);
  expect(await noPageOverflow(page)).toBe(true);

  // Each of the three stored sources locates its own passage in the reader.
  await expect(disclosure.getByRole('button', {name: 'Locate in document', exact: true})).toHaveCount(6);
  const flashed = page.locator('[data-block-id].ring-1');
  const sources = cards.nth(0).getByRole('button', {name: 'Locate in document', exact: true});
  for (const rank of [0, 2, 1]) {
    await sources.nth(rank).click();
    await expect(sources.nth(rank)).toHaveAttribute('aria-pressed', 'true');
    await expect(flashed).toContainText(REVIEW_QUOTES[rank]);
  }

  // Scan at the pane's top: mid-scroll, whichever row passes under the pinned toolbar and section
  // header reads as "partially obscured". Focus reaching a covered control is its own test above.
  await scrollReviewPaneToTop(page);
  const axe = await new AxeBuilder({page})
    .include('[role="toolbar"][aria-label="Review suggestion"]').include('table').include('[id^="review-disclosure-"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(axe.violations.map(violation => `${violation.id}: ${violation.nodes.map(node => `${node.target.join(' ')} — ${node.failureSummary ?? ''}`).join(' | ')}`)).toEqual([]);

  // An anchor the reader cannot resolve: no flash, card and disclosure stay open, no alarm.
  await rowFor(page, second.label).getByRole('button', {name: SECONDARY_VALUE, exact: true}).click();
  const secondDisclosure = disclosureFor(page, second);
  const latest = secondDisclosure.getByRole('article');
  // Compare is a remembered reviewer preference: turned on for the first question, the next one
  // opens side by side too. Back to one card for the single-source checks below.
  await expect(latest).toHaveCount(2);
  await secondDisclosure.getByRole('button', {name: 'Show one extraction', exact: true}).click();
  await expect(latest).toHaveCount(1);
  await expect(flashed).toHaveCount(0, {timeout: 4000});
  const secondSources = latest.getByRole('button', {name: 'Locate in document', exact: true});
  await secondSources.nth(1).click();
  const flashesAfterUnavailable = await page.evaluate(() => new Promise<number>(resolve => {
    let seen = 0;
    const count = () => document.querySelectorAll('[data-block-id].ring-1').length;
    const observer = new MutationObserver(() => {seen += count();});
    observer.observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['class']});
    setTimeout(() => {observer.disconnect(); resolve(seen + count());}, 1000);
  }));
  expect(flashesAfterUnavailable).toBe(0);
  await expect(latest).toBeVisible();
  await expect(secondSources.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(secondDisclosure.getByRole('alert')).toHaveCount(0);
  await secondSources.nth(0).click();
  await expect(flashed).toContainText(REVIEW_QUOTES[0]);
  await expect(latest.getByText('Verify manually', {exact: true})).toBeVisible();
  await expect(latest.getByText('Verified', {exact: true})).toBeVisible();
  await scrollReviewPaneToTop(page);
  const scanDisclosure = async () => (await new AxeBuilder({page}).include('[role="toolbar"][aria-label="Review suggestion"]').include('table').include('[id^="review-disclosure-"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()).violations.map(violation => `${violation.id}: ${violation.nodes.map(node => `${node.target.join(' ')} — ${node.failureSummary ?? ''}`).join(' | ')}`);
  expect(await scanDisclosure(), 'light theme: success and amber attribution badges').toEqual([]);
  await page.emulateMedia({colorScheme: 'dark'});
  await expect(page.locator('html'), 'the system theme follows the emulated dark scheme').toHaveClass(/\bdark\b/);
  expect(await scanDisclosure(), 'dark theme: success and amber attribution badges').toEqual([]);
  await page.emulateMedia({colorScheme: 'light'});
  await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);

  // No-information generation, then carousel motion under reduced motion.
  await page.emulateMedia({reducedMotion: 'reduce'});
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  await secondDisclosure.getByRole('button', {name: 'Next extraction', exact: true}).click();
  await expect(secondDisclosure.getByRole('article').getByText('No information found', {exact: true})).toBeVisible();
  await secondDisclosure.getByRole('button', {name: 'Previous extraction', exact: true}).click();
  await expect(secondDisclosure.getByRole('article').getByText(SECONDARY_VALUE, {exact: true})).toBeVisible();
  // The card declares its reduced-motion override (`motion-reduce:transition-none`): under `reduce`
  // every mounted card's computed transition must resolve to none (the unstyled default is `all`, so
  // dropping the override fails here; no mounted card fails too), and nothing inside the disclosure
  // may be animating.
  expect(await secondDisclosure.evaluate(root => ({
    cardTransitions: [...new Set(Array.from(root.querySelectorAll('article')).map(card => getComputedStyle(card).transitionProperty))],
    running: document.getAnimations().filter(animation => {
      const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
      return target !== null && root.contains(target);
    }).length,
  }))).toEqual({cardTransitions: ['none'], running: 0});
});

test('keyboard focus never leaves a review control hidden under the sticky toolbar', async ({page, workspace}) => {
  // A short viewport leaves the pane enough scroll range to park the disclosure header under the pinned layers.
  await openWorkspace(page, workspace.url, {width: 1920, height: 640});
  const [first] = workspace.coordinates;
  await rowFor(page, first.label).getByRole('button', {name: REVIEW_VALUE, exact: true}).click();
  const disclosure = disclosureFor(page, first);
  // With two extractions the compare toggle is the header control just before the card.
  const headerControl = disclosure.getByRole('button', {name: 'Compare extractions', exact: true});
  const cardAccept = disclosure.getByRole('article').getByRole('button', {name: /^(Unaccept|Accept) extraction$/});
  await expect(cardAccept).toBeVisible();

  // Scroll the pane until the disclosure header sits fully under the sticky toolbar.
  const bar = await toolbar(page).locator('xpath=..').boundingBox();
  const header = await headerControl.boundingBox();
  if (!bar || !header) throw new Error('Toolbar and disclosure header need layout boxes.');
  await page.locator('[data-scroll-container="extraction-form"] [data-radix-scroll-area-viewport]').evaluate((viewport, delta) => {viewport.scrollTop += delta;}, header.y - bar.y);
  const covered = await headerControl.evaluate(element => {
    const box = element.getBoundingClientRect();
    return !element.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
  });
  expect(covered, 'precondition: the header control starts under the sticky toolbar').toBe(true);

  await cardAccept.focus({timeout: 5000});
  await page.keyboard.press('Shift+Tab');
  await expect(headerControl).toBeFocused();
  await expect.poll(() => headerControl.evaluate(element => {
    const box = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
  }), {timeout: 3000}).toBe(true);
});

test('column widths resize by pointer and keyboard only at >=900px panes, reset, persist; long editors resize manually', async ({page, workspace}) => {
  await openWorkspace(page, workspace.url);
  const columnHandles = page.locator('th [role="separator"]');
  await setSourcePanel(page, true);
  await expect.poll(() => reviewPaneWidth(page)).toBeLessThan(900);
  await expect(columnHandles).toHaveCount(0);
  await setSourcePanel(page, false);
  await expect.poll(() => reviewPaneWidth(page)).toBeGreaterThanOrEqual(900);
  const question = page.getByRole('separator', {name: 'Question', exact: true}).first();
  const value = page.getByRole('separator', {name: 'Extracted value', exact: true}).first();
  await expect(question).toHaveAttribute('aria-valuenow', '270');
  await expect(value).toHaveAttribute('aria-valuenow', '315');
  await expect(question).toHaveAttribute('aria-valuemin', '160');
  expect(Math.abs(Number(await question.getAttribute('aria-valuemax')) - (await reviewPaneWidth(page) - 420))).toBeLessThanOrEqual(1);

  await question.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(question).toHaveAttribute('aria-valuenow', '302');
  await page.keyboard.press('Home');
  await expect(question).toHaveAttribute('aria-valuenow', '160');
  await page.keyboard.press('End');
  await expect.poll(async () => Number(await question.getAttribute('aria-valuenow'))).toBeGreaterThan(302);
  await question.dblclick();
  await expect(question).toHaveAttribute('aria-valuenow', '270');

  const box = await question.boundingBox();
  if (!box) throw new Error('Question resize handle has no layout box.');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, {steps: 6});
  await page.mouse.up();
  await expect(question).toHaveAttribute('aria-valuenow', '350');
  const header = await question.locator('xpath=ancestor::th[1]').boundingBox({timeout: 5000});
  expect(Math.abs((header?.width ?? 0) - 350)).toBeLessThanOrEqual(2);
  await value.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(value).toHaveAttribute('aria-valuenow', '299');

  // Preferences survive a reload and a temporarily narrow pane.
  await page.reload();
  await setSourcePanel(page, true);
  await expect(columnHandles).toHaveCount(0);
  await setSourcePanel(page, false);
  await expect(question).toHaveAttribute('aria-valuenow', '350');
  await expect(value).toHaveAttribute('aria-valuenow', '299');
  await toolbar(page).getByRole('button', {name: 'Reset column widths', exact: true}).click();
  await expect(question).toHaveAttribute('aria-valuenow', '270');
  await expect(value).toHaveAttribute('aria-valuenow', '315');
  await page.reload();
  await setSourcePanel(page, false);
  await expect(question).toHaveAttribute('aria-valuenow', '270');

  const editor = page.getByRole('textbox', {name: workspace.coordinates[0].label, exact: true});
  await editor.scrollIntoViewIfNeeded();
  const initial = await editor.boundingBox();
  if (!initial) throw new Error('Long-text editor has no layout box.');
  await page.mouse.move(initial.x + initial.width - 3, initial.y + initial.height - 3);
  await page.mouse.down();
  await page.mouse.move(initial.x + initial.width - 3, initial.y + initial.height + 160, {steps: 8});
  await page.mouse.up();
  const resized = (await editor.boundingBox())?.height ?? 0;
  expect(resized).toBeGreaterThan(initial.height + 100);
  expect(resized).toBeLessThanOrEqual(320);
  await editor.focus();
  await page.keyboard.type('Manual height is kept while typing');
  expect((await editor.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(resized - 1);
});

test('shortcuts accept, focus and navigate but never while typing, in an open menu or dialog; toolbar focus order', async ({page, workspace}) => {
  await openWorkspace(page, workspace.url);
  const [first] = workspace.coordinates;
  const bar = toolbar(page);
  const focusButton = bar.getByRole('button', {name: 'Focus question', exact: true});

  await activate(page, first.label);
  await page.keyboard.press('f');
  await expect(bar.getByRole('button', {name: 'Leave focus', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('tr[data-field-row]:not([hidden])')).toHaveCount(1);
  await page.keyboard.press('f');
  await expect(focusButton).toBeVisible();

  const editor = page.getByRole('textbox', {name: first.label, exact: true});
  await editor.click();
  await page.keyboard.type('af');
  await expect(editor).toHaveValue('af');
  // Typed, not shortcuts: focus mode stays off (every row still renders) and nothing is accepted.
  // A keyboard event commits synchronously, so a toggled focus would already show here.
  await expect(focusButton).toHaveAttribute('aria-pressed', 'false');
  expect(await visibleRowCount(page), 'typing "f" must not enter focus mode').toBeGreaterThan(1);
  await expect(rowFor(page, first.label).getByRole('button', {name: 'Accept extraction', exact: true})).toHaveAttribute('aria-pressed', 'false');

  await page.getByRole('combobox').first().click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('f');
  expect(await visibleRowCount(page), '"f" inside an open listbox must not enter focus mode').toBeGreaterThan(1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(focusButton).toHaveAttribute('aria-pressed', 'false');

  await page.getByRole('button', {name: 'Help and shortcuts', exact: true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('f');
  expect(await visibleRowCount(page), '"f" inside an open dialog must not enter focus mode').toBeGreaterThan(1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(focusButton).toHaveAttribute('aria-pressed', 'false');

  const rowIds = () => page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('tr[data-field-row]')).filter(row => !row.hidden).map(row => row.id));
  const activeRowId = () => page.evaluate(() => document.activeElement?.closest('tr')?.id ?? '');
  const firstId = `review-question-${first.instanceId}_${first.id}`;
  await activate(page, first.label);
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(activeRowId).not.toBe(firstId);
  const order = await rowIds();
  const nextIndex = order.indexOf(await activeRowId());
  expect(nextIndex).toBeGreaterThan(order.indexOf(firstId));
  await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(activeRowId).toBe(order[nextIndex - 1]);

  // Acceptance is inert while a save runs; let the typed draft persist first.
  await expect.poll(async () => (await decisionsFor(workspace.runId)).at(-1)).toMatchObject({field_id: first.id, value: {value: 'af'}});
  expect((await decisionsFor(workspace.runId)).filter(decision => decision.proposal_record_id !== null), 'the "a" typed into the editor wrote no acceptance').toEqual([]);
  await activate(page, first.label);
  await expect(rowFor(page, first.label).getByRole('button', {name: 'Accept extraction', exact: true})).toBeEnabled();
  await page.keyboard.press('a');
  await expect(rowFor(page, first.label).getByRole('button', {name: 'Unaccept extraction', exact: true})).toBeVisible();
  await expect.poll(async () => (await decisionsFor(workspace.runId)).at(-1)).toMatchObject({field_id: first.id, value: {value: REVIEW_VALUE}});
  expect((await decisionsFor(workspace.runId)).at(-1)?.proposal_record_id).not.toBeNull();

  await bar.getByRole('button').first().focus();
  const expected = await bar.evaluate(element => Array.from(element.querySelectorAll('button')).filter(button => !button.disabled).map(button => button.getAttribute('aria-label')));
  const seen: Array<string | null> = [];
  for (let index = 0; index < expected.length; index++) {
    seen.push(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null));
    await page.keyboard.press('Tab');
  }
  expect(seen).toEqual(expected);
});

test('section jobs run independently through a deterministic transport seam without stealing focus', async ({page, workspace}) => {
  const kickoffs: Array<Record<string, unknown>> = [];
  const statuses = new Map<string, 'running' | 'completed'>();
  await page.route(/\/api\/v1\/extraction\/sections(\/status\/[^/?]+)?(\?.*)?$/, async route => {
    const request = route.request();
    const headers = {
      'access-control-allow-origin': (await request.headerValue('origin')) ?? '*',
      'access-control-allow-headers': (await request.headerValue('access-control-request-headers')) ?? 'authorization,content-type,x-trace-id',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({status: 204, headers});
    const status = /\/status\/([^/?]+)/.exec(request.url());
    if (status) {
      const jobId = decodeURIComponent(status[1]);
      const state = statuses.get(jobId);
      if (!state) return route.fulfill({status: 404, headers, json: {ok: false, error: {code: 'NOT_FOUND', message: `Unknown fixture job ${jobId}`}}});
      return route.fulfill({headers, json: {ok: true, data: {jobId, status: state, error: null, errorCode: null, result: state === 'completed' ? {mode: 'section', extractionRunId: workspace.runId, suggestionsCreated: 0} : null}}});
    }
    if (request.method() !== 'POST') return route.fulfill({status: 405, headers, json: {ok: false, error: {code: 'METHOD', message: 'Fixture seam accepts POST only'}}});
    kickoffs.push(request.postDataJSON() as Record<string, unknown>);
    const jobId = `review-workspace-job-${kickoffs.length}`;
    statuses.set(jobId, 'running');
    return route.fulfill({status: 202, headers, json: {ok: true, data: {job_id: jobId}}});
  });
  await openWorkspace(page, workspace.url);
  const actions = page.locator('[data-testid^="section-ai-extract-"]');
  await expect(actions.nth(1)).toBeVisible();
  const [idA, idB] = [await actions.nth(0).getAttribute('data-testid'), await actions.nth(1).getAttribute('data-testid')];
  if (!idA || !idB) throw new Error('Two section extraction actions are required.');
  const [sectionA, sectionB] = [page.getByTestId(idA), page.getByTestId(idB)];
  const [labelA, labelB] = [await sectionA.getAttribute('aria-label'), await sectionB.getAttribute('aria-label')];

  await sectionA.click();
  await expect(sectionA).toHaveAttribute('aria-label', 'Extracting with AI…');
  await expect(sectionA).toBeDisabled();
  await expect(sectionB).toBeEnabled();
  await expect(sectionB).toHaveAttribute('aria-label', labelB ?? '');
  await sectionB.click();
  await expect(sectionB).toHaveAttribute('aria-label', 'Extracting with AI…');
  expect(kickoffs).toHaveLength(2);
  expect(new Set(kickoffs.map(body => body.entityTypeId)).size).toBe(2);
  expect(new Set(kickoffs.map(body => body.requestId)).size).toBe(2);
  for (const body of kickoffs) expect(body).toMatchObject({runId: workspace.runId, articleId: workspace.articleId, templateId: workspace.templateId, extractAllSections: false, requestId: expect.stringMatching(/^[0-9a-f-]{36}$/)});

  const editor = page.getByRole('textbox', {name: workspace.coordinates[0].label, exact: true});
  await editor.focus();
  statuses.set('review-workspace-job-1', 'completed');
  await expect(sectionA).toHaveAttribute('aria-label', labelA ?? '', {timeout: 15000});
  await expect(sectionA).toBeEnabled();
  await expect(sectionB).toHaveAttribute('aria-label', 'Extracting with AI…');
  await expect(editor).toBeFocused();
  statuses.set('review-workspace-job-2', 'completed');
  await expect(sectionB).toHaveAttribute('aria-label', labelB ?? '', {timeout: 15000});
  await expect(editor).toBeFocused();
  expect(kickoffs).toHaveLength(2);
});

test.describe('coarse pointer', () => {
  test.use({hasTouch: true});
  test('column handles and review actions keep coarse touch targets', async ({page, workspace}) => {
    await openWorkspace(page, workspace.url);
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), 'touch emulation must make the primary pointer coarse').toBe(true);
    await setSourcePanel(page, false);
    const handle = page.getByRole('separator', {name: 'Question', exact: true}).first();
    await expect(handle).toBeVisible();
    expect((await handle.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(24);
    for (const action of [rowFor(page, workspace.coordinates[0].label).getByRole('button', {name: 'Accept extraction', exact: true}), toolbar(page).getByRole('button', {name: 'Next pending question', exact: true})]) {
      const box = await action.boundingBox();
      expect(Math.min(box?.width ?? 0, box?.height ?? 0)).toBeGreaterThanOrEqual(44);
    }
  });
});

test('design review captures production states without horizontal page overflow', async ({page, workspace}, testInfo) => {
  const [first, second] = workspace.coordinates;
  const capture = async (name: string) => {
    expect(await noPageOverflow(page), `${name}: horizontal page overflow`).toBe(true);
    await page.screenshot({path: testInfo.outputPath(`${name}.png`)});
  };
  await openWorkspace(page, workspace.url);
  await setSourcePanel(page, true);
  await expect(page.getByRole('img', {name: 'PDF page 1'})).toBeVisible({timeout: 15000});
  await rowFor(page, first.label).getByRole('button', {name: REVIEW_VALUE, exact: true}).click();
  await disclosureFor(page, first).getByRole('button', {name: 'Compare extractions', exact: true}).click();
  await page.getByRole('rowheader', {name: first.label, exact: true}).scrollIntoViewIfNeeded();
  await capture('review-1920-compare');
  await page.setViewportSize({width: 1440, height: 900});
  await page.getByRole('rowheader', {name: first.label, exact: true}).scrollIntoViewIfNeeded();
  await capture('review-1440-compare');

  await page.setViewportSize({width: 1920, height: 1080});
  await setSourcePanel(page, true);
  for (const target of [960, 860, 560]) {
    const width = await setReviewPaneWidth(page, target);
    expect(Math.abs(width - target), `review pane reached ${width}px for target ${target}px`).toBeLessThanOrEqual(12);
    await expect.poll(() => page.locator('th [role="separator"]').count()).toBe(width >= 900 ? await page.locator('table').count() * 2 : 0);
    expect(await page.locator('tr[data-field-row]').first().evaluate(row => getComputedStyle(row).display)).toBe(width < 600 ? 'block' : 'table-row');
    await page.getByRole('rowheader', {name: first.label, exact: true}).scrollIntoViewIfNeeded();
    await capture(`review-pane-${target}`);
  }

  await page.setViewportSize({width: 768, height: 1024});
  await page.getByRole('rowheader', {name: first.label, exact: true}).scrollIntoViewIfNeeded();
  await capture('review-768');

  await page.setViewportSize({width: 1920, height: 1080});
  await activate(page, second.label);
  await toolbar(page).getByRole('button', {name: 'Focus question', exact: true}).click();
  const secondDisclosure = disclosureFor(page, second);
  // Compare was turned on for the first question and is remembered, so this one opens side by side.
  await expect(secondDisclosure.getByRole('article')).toHaveCount(2);
  await secondDisclosure.getByRole('button', {name: 'Show one extraction', exact: true}).click();
  await expect(secondDisclosure.getByRole('article')).toHaveCount(1);
  await secondDisclosure.getByRole('button', {name: 'Next extraction', exact: true}).click();
  await expect(secondDisclosure.getByRole('article').getByText('No information found', {exact: true})).toBeVisible();
  await expectGuideOn(page, second);
  await capture('review-focus-no-information');

  await toolbar(page).getByRole('button', {name: 'Leave focus', exact: true}).click();
  await activate(page, first.label);
  await toolbar(page).getByRole('button', {name: 'Focus question', exact: true}).click();
  await page.keyboard.press('a');
  // Focus mode adds the description to the rowheader's name, so the exact-label row locator cannot match here.
  await expect(page.locator(`#review-question-${first.instanceId}_${first.id}`).getByRole('button', {name: 'Unaccept extraction', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await expectGuideOn(page, first);
  await capture('review-active-actions');
});
