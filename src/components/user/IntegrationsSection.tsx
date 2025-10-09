/**
 * Seção de Integrações
 * Gerenciar integrações com serviços externos (Zotero, etc.)
 */

import { Plug } from 'lucide-react';
import { ZoteroIntegrationSection } from '@/components/project/settings/ZoteroIntegrationSection';

export function IntegrationsSection() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-2 flex items-center gap-2">
          <Plug className="h-5 w-5" />
          Integrações
        </h2>
        <p className="text-sm text-muted-foreground">
          Configure integrações com serviços externos para importar e sincronizar dados.
        </p>
      </div>

      {/* Integração Zotero */}
      <ZoteroIntegrationSection />

      {/* Futuras integrações podem ser adicionadas aqui */}
    </div>
  );
}

