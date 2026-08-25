/**
 * Centralized UI copy (English). Consumed via t(ns, key) or direct namespace import.
 * @see specs/004-frontend-i18n/contracts/copy-api.md
 */
import {common} from './common';
import {pages} from './pages';
import {auth} from './auth';
import {extraction} from './extraction';
import {qa} from './qa';
import {articles} from './articles';
import {project} from './project';
import {consensus} from './consensus';
import {user} from './user';
import {navigation} from './navigation';
import {layout} from './layout';
import {patterns} from './patterns';
import {ui} from './ui';
import {shared} from './shared';
import {pdf} from './pdf';
import {runs} from './runs';
import {parsing} from './parsing';
import {templateConfig} from './templateConfig';
import {llmEngine} from './llmEngine';

export {
    common,
    auth,
    extraction,
    qa,
    consensus,
    templateConfig,
    llmEngine,
};

const copy = {
    common,
    pages,
    auth,
    extraction,
    qa,
    articles,
    project,
    consensus,
    user,
    navigation,
    layout,
    patterns,
    ui,
    shared,
    pdf,
    runs,
    parsing,
    templateConfig,
    llmEngine,
} as const;

export type CopyNamespace = keyof typeof copy;

/**
 * Typed helper: returns the English string for the given namespace and key.
 * Usage: t('common', 'save') => 'Save'
 */
export function t<N extends CopyNamespace>(ns: N, key: keyof (typeof copy)[N]): string {
    const nsObj = copy[ns] as Record<string, string>;
    return nsObj[key as string] ?? '';
}

/**
 * The whole namespace tree. Production reads copy through `t(ns, key)` — this
 * export exists so `copy-run-vocabulary.test.ts` can sweep *every* namespace
 * for leaked vocabulary, including namespaces added after the test was
 * written. Rebuilding the aggregate inside the test would silently stop
 * covering new namespaces, which is the one thing that test is for.
 *
 * @internal
 */
export default copy;
