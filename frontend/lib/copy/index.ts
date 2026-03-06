/**
 * Centralized UI copy (English). Consumed via t(ns, key) or direct namespace import.
 * @see specs/004-frontend-i18n/contracts/copy-api.md
 */
import {common} from './common';
import {pages} from './pages';
import {auth} from './auth';
import {extraction} from './extraction';
import {assessment} from './assessment';
import {articles} from './articles';
import {project} from './project';
import {user} from './user';
import {navigation} from './navigation';
import {layout} from './layout';
import {patterns} from './patterns';
import {ui} from './ui';
import {shared} from './shared';
import {pdf} from './pdf';

export {
    common,
    pages,
    auth,
    extraction,
    assessment,
    articles,
    project,
    user,
    navigation,
    layout,
    patterns,
    ui,
    shared,
    pdf
};

const copy = {
    common,
    pages,
    auth,
    extraction,
    assessment,
    articles,
    project,
    user,
    navigation,
    layout,
    patterns,
    ui,
    shared,
    pdf,
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

export default copy;
