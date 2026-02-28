/**
 * PDFToolbar - Wrapper para a nova MainToolbar modular
 * 
 * Mantido para compatibilidade com código existente.
 * Internamente usa a nova estrutura modular da toolbar.
 */

import {MainToolbar} from './toolbar/MainToolbar';

export function PDFToolbar() {
  return <MainToolbar />;
}
