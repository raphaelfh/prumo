/**
 * Re-export every domain namespace so consumers can use a single import:
 *
 *   import { projectKeys, articleKeys, extractionKeys } from '@/lib/query-keys'
 *
 * The convention and rationale live in `./README.md`. The enforcement lives
 * in `scripts/fitness/check_react_query_keys.py`.
 */
export { projectKeys } from './project';
export { articleKeys } from './articles';
export { extractionKeys } from './extraction';
