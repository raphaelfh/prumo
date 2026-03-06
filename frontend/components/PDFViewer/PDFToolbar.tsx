/**
 * PDFToolbar - Wrapper for the new modular MainToolbar
 *
 * Kept for compatibility with existing code.
 * Internamente usa a nova estrutura modular da toolbar.
 */

import {MainToolbar} from './toolbar/MainToolbar';

export function PDFToolbar() {
  return <MainToolbar />;
}
