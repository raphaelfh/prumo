/**
 * Seção de Integração com Zotero
 * Permite configurar credenciais e testar conexão
 */

import {useState} from 'react';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Badge} from '@/components/ui/badge';
import {Alert, AlertDescription} from '@/components/ui/alert';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {CheckCircle2, ExternalLink, Info, Link as LinkIcon, Loader2, Unlink} from 'lucide-react';
import {useZoteroIntegration} from '@/hooks/useZoteroIntegration';

export function ZoteroIntegrationSection() {
  const {
    integration,
    isConfigured,
    loading,
    testing,
    saveCredentials,
    testConnection,
    disconnect,
  } = useZoteroIntegration();

  const [formData, setFormData] = useState({
    zoteroUserId: '',
    apiKey: '',
    libraryType: 'user' as 'user' | 'group',
  });

  const [showApiKey, setShowApiKey] = useState(false);

  const handleSaveCredentials = async () => {
    if (!formData.zoteroUserId.trim() || !formData.apiKey.trim()) {
      return;
    }

    const success = await saveCredentials(formData);
    
    if (success) {
      // Limpar form
      setFormData({
        zoteroUserId: '',
        apiKey: '',
        libraryType: 'user',
      });
      setShowApiKey(false);
    }
  };

  const handleTestConnection = async () => {
    await testConnection();
  };

  const handleDisconnect = async () => {
    await disconnect();
  };

  const maskUserId = (userId: string) => {
    if (userId.length <= 6) return userId;
    return `${userId.slice(0, 3)}...${userId.slice(-3)}`;
  };

  if (loading && !integration) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <LinkIcon className="h-5 w-5" />
              Integração Zotero
            </CardTitle>
            <CardDescription className="mt-2">
              Importe artigos diretamente das suas collections do Zotero
            </CardDescription>
          </div>
          {isConfigured && (
            <Badge variant="outline" className="gap-1">
              <CheckCircle2 className="h-3 w-3" />
              Conectado
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Estado Configurado */}
        {isConfigured && integration ? (
          <div className="space-y-4">
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>
                Sua conta Zotero está conectada. Você pode importar artigos nas suas listas de artigos.
              </AlertDescription>
            </Alert>

            <div className="rounded-lg border bg-muted/50 p-4 space-y-3">
              <div>
                <Label className="text-sm text-muted-foreground">User ID</Label>
                <p className="font-mono text-sm">{maskUserId(integration.zotero_user_id)}</p>
              </div>
              <div>
                <Label className="text-sm text-muted-foreground">Tipo de Biblioteca</Label>
                <p className="text-sm capitalize">{integration.library_type}</p>
              </div>
              {integration.last_sync_at && (
                <div>
                  <Label className="text-sm text-muted-foreground">Última Sincronização</Label>
                  <p className="text-sm">
                    {new Date(integration.last_sync_at).toLocaleString('pt-BR')}
                  </p>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Button 
                variant="outline" 
                onClick={handleTestConnection}
                disabled={testing}
              >
                {testing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Testando...
                  </>
                ) : (
                  'Testar Conexão'
                )}
              </Button>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" className="text-destructive">
                    <Unlink className="mr-2 h-4 w-4" />
                    Desconectar
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Desconectar do Zotero?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Isso removerá suas credenciais do Zotero. Artigos já importados não serão afetados.
                      Você precisará reconectar para fazer novas importações.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDisconnect}>
                      Desconectar
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        ) : (
          /* Estado Não Configurado */
          <div className="space-y-4">
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                Configure sua integração com o Zotero para importar artigos automaticamente.
                {' '}
                <a 
                  href="https://www.zotero.org/settings/keys/new" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="underline inline-flex items-center gap-1"
                >
                  Gerar API Key
                  <ExternalLink className="h-3 w-3" />
                </a>
              </AlertDescription>
            </Alert>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="zotero-user-id">
                  Zotero User ID
                  <a 
                    href="https://www.zotero.org/settings/keys" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="ml-2 text-xs text-muted-foreground hover:underline inline-flex items-center gap-1"
                  >
                    Como encontrar?
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </Label>
                <Input
                  id="zotero-user-id"
                  placeholder="123456"
                  value={formData.zoteroUserId}
                  onChange={(e) => setFormData({ ...formData, zoteroUserId: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Seu User ID aparece na página de configurações de API Keys
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="api-key">API Key</Label>
                <div className="relative">
                  <Input
                    id="api-key"
                    type={showApiKey ? 'text' : 'password'}
                    placeholder="••••••••••••••••••••••••"
                    value={formData.apiKey}
                    onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                    className="pr-20"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-1 top-1 h-7"
                    onClick={() => setShowApiKey(!showApiKey)}
                  >
                    {showApiKey ? 'Ocultar' : 'Mostrar'}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Permissões necessárias: "Allow library access" e "Allow file access"
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="library-type">Tipo de Biblioteca</Label>
                <Select 
                  value={formData.libraryType} 
                  onValueChange={(value: 'user' | 'group') => 
                    setFormData({ ...formData, libraryType: value })
                  }
                >
                  <SelectTrigger id="library-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">Biblioteca Pessoal</SelectItem>
                    <SelectItem value="group">Biblioteca de Grupo</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex gap-2 pt-2">
                <Button 
                  onClick={handleSaveCredentials}
                  disabled={!formData.zoteroUserId.trim() || !formData.apiKey.trim() || loading}
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Salvando...
                    </>
                  ) : (
                    'Conectar ao Zotero'
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

