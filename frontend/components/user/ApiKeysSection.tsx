/**
 * Seção de API Keys
 * Gerenciar API keys de provedores de IA (OpenAI, Anthropic, Gemini, Grok)
 */

import {useEffect, useState} from 'react';
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
import {Collapsible, CollapsibleContent, CollapsibleTrigger,} from '@/components/ui/collapsible';
import {
    CheckCircle2,
    ChevronDown,
    Clock,
    ExternalLink,
    Eye,
    EyeOff,
    Info,
    Key,
    Loader2,
    Plus,
    RefreshCw,
    Star,
    StarOff,
    Trash2,
    XCircle
} from 'lucide-react';
import {toast} from 'sonner';
import {supabase} from '@/integrations/supabase/client';
import {type APIKeyInfo, apiKeysService, type CreateAPIKeyRequest, type ProviderInfo} from '@/services/apiKeysService';

// Ícones e cores por provedor
const PROVIDER_CONFIG: Record<string, { color: string; bgColor: string }> = {
  openai: { color: 'text-green-600', bgColor: 'bg-green-50' },
  anthropic: { color: 'text-orange-600', bgColor: 'bg-orange-50' },
  gemini: { color: 'text-blue-600', bgColor: 'bg-blue-50' },
  grok: { color: 'text-purple-600', bgColor: 'bg-purple-50' },
};

export function ApiKeysSection() {
  const [keys, setKeys] = useState<APIKeyInfo[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState<string | null>(null);
  const [isAddFormOpen, setIsAddFormOpen] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  
  const [formData, setFormData] = useState<CreateAPIKeyRequest>({
    provider: 'openai',
    apiKey: '',
    keyName: '',
    isDefault: true,
    validateKey: true,
  });

  // Carregar dados iniciais
  useEffect(() => {
    loadData();
  }, []);

  const getAccessToken = async (): Promise<string> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      throw new Error('Sessão expirada. Faça login novamente.');
    }
    return session.access_token;
  };

  const loadData = async () => {
    try {
      setLoading(true);
      const token = await getAccessToken();
      
      const [keysData, providersData] = await Promise.all([
        apiKeysService.listKeys(token, false),
        apiKeysService.listProviders(token),
      ]);
      
      setKeys(keysData);
      setProviders(providersData);
    } catch (error) {
      console.error('Erro ao carregar API keys:', error);
      toast.error('Erro ao carregar API keys');
    } finally {
      setLoading(false);
    }
  };

  const handleAddKey = async () => {
    if (!formData.apiKey.trim()) {
      toast.error('Digite a API key');
      return;
    }

    try {
      setSaving(true);
      const token = await getAccessToken();
      
      const result = await apiKeysService.createKey(token, formData);
      
      if (result.validationStatus === 'invalid') {
        toast.error(`API key inválida: ${result.validationMessage || 'Verifique a key'}`);
      } else if (result.validationStatus === 'valid') {
        toast.success('API key adicionada e validada com sucesso!');
      } else {
        toast.success('API key adicionada. Validação pendente.');
      }
      
      // Limpar form e recarregar
      setFormData({
        provider: 'openai',
        apiKey: '',
        keyName: '',
        isDefault: true,
        validateKey: true,
      });
      setShowApiKey(false);
      setIsAddFormOpen(false);
      await loadData();
      
    } catch (error: any) {
      console.error('Erro ao adicionar API key:', error);
      toast.error(error.message || 'Erro ao adicionar API key');
    } finally {
      setSaving(false);
    }
  };

  const handleSetDefault = async (keyId: string) => {
    try {
      const token = await getAccessToken();
      await apiKeysService.updateKey(token, keyId, { isDefault: true });
      toast.success('API key definida como padrão');
      await loadData();
    } catch (error: any) {
      console.error('Erro ao definir como padrão:', error);
      toast.error(error.message || 'Erro ao definir como padrão');
    }
  };

  const handleDeactivate = async (keyId: string) => {
    try {
      const token = await getAccessToken();
      await apiKeysService.updateKey(token, keyId, { isActive: false });
      toast.success('API key desativada');
      await loadData();
    } catch (error: any) {
      console.error('Erro ao desativar:', error);
      toast.error(error.message || 'Erro ao desativar API key');
    }
  };

  const handleDelete = async (keyId: string) => {
    try {
      const token = await getAccessToken();
      await apiKeysService.deleteKey(token, keyId);
      toast.success('API key removida');
      await loadData();
    } catch (error: any) {
      console.error('Erro ao remover:', error);
      toast.error(error.message || 'Erro ao remover API key');
    }
  };

  const handleValidate = async (keyId: string) => {
    try {
      setValidating(keyId);
      const token = await getAccessToken();
      const result = await apiKeysService.validateKey(token, keyId);
      
      if (result.status === 'valid') {
        toast.success('API key válida!');
      } else if (result.status === 'invalid') {
        toast.error(`API key inválida: ${result.message}`);
      } else {
        toast.info('Validação pendente');
      }
      
      await loadData();
    } catch (error: any) {
      console.error('Erro ao validar:', error);
      toast.error(error.message || 'Erro ao validar API key');
    } finally {
      setValidating(null);
    }
  };

  const getValidationBadge = (status: string | null) => {
    switch (status) {
      case 'valid':
        return (
          <Badge variant="outline" className="gap-1 text-green-600 border-green-200 bg-green-50">
            <CheckCircle2 className="h-3 w-3" />
            Válida
          </Badge>
        );
      case 'invalid':
        return (
          <Badge variant="outline" className="gap-1 text-red-600 border-red-200 bg-red-50">
            <XCircle className="h-3 w-3" />
            Inválida
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="gap-1 text-yellow-600 border-yellow-200 bg-yellow-50">
            <Clock className="h-3 w-3" />
            Pendente
          </Badge>
        );
    }
  };

  const getProviderName = (providerId: string) => {
    return providers.find(p => p.id === providerId)?.name || providerId;
  };

  const getProviderDocsUrl = (providerId: string) => {
    return providers.find(p => p.id === providerId)?.docsUrl || '#';
  };

  // Agrupar keys por provedor
  const keysByProvider = keys.reduce((acc, key) => {
    if (!acc[key.provider]) {
      acc[key.provider] = [];
    }
    acc[key.provider].push(key);
    return acc;
  }, {} as Record<string, APIKeyInfo[]>);

  if (loading) {
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
              <Key className="h-5 w-5" />
              API Keys de IA
            </CardTitle>
            <CardDescription className="mt-2">
              Configure suas próprias API keys para usar modelos de IA na extração de dados
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Info sobre BYOK */}
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Com suas próprias API keys, você tem controle total sobre os custos e pode usar
            modelos de diferentes provedores. As keys são criptografadas e nunca expostas.
          </AlertDescription>
        </Alert>

        {/* Formulário para adicionar nova key */}
        <Collapsible open={isAddFormOpen} onOpenChange={setIsAddFormOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between">
              <span className="flex items-center gap-2">
                <Plus className="h-4 w-4" />
                Adicionar API Key
              </span>
              <ChevronDown className={`h-4 w-4 transition-transform ${isAddFormOpen ? 'rotate-180' : ''}`} />
            </Button>
          </CollapsibleTrigger>
          
          <CollapsibleContent className="mt-4 space-y-4 border rounded-lg p-4">
            {/* Provedor */}
            <div className="space-y-2">
              <Label>Provedor</Label>
              <Select
                value={formData.provider}
                onValueChange={(value) => setFormData({ ...formData, provider: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o provedor" />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      <div className="flex items-center gap-2">
                        <span>{provider.name}</span>
                        <span className="text-xs text-muted-foreground">
                          ({provider.description})
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <a
                href={getProviderDocsUrl(formData.provider)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                Como obter uma API key?
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>

            {/* API Key */}
            <div className="space-y-2">
              <Label>API Key</Label>
              <div className="relative">
                <Input
                  type={showApiKey ? 'text' : 'password'}
                  value={formData.apiKey}
                  onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                  placeholder="sk-..."
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1 h-7"
                  onClick={() => setShowApiKey(!showApiKey)}
                >
                  {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {/* Nome (opcional) */}
            <div className="space-y-2">
              <Label>Nome (opcional)</Label>
              <Input
                value={formData.keyName || ''}
                onChange={(e) => setFormData({ ...formData, keyName: e.target.value })}
                placeholder="Ex: Key pessoal, Key do trabalho"
              />
            </div>

            {/* Opções */}
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={formData.isDefault}
                  onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
                  className="rounded"
                />
                Definir como padrão
              </label>
              
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={formData.validateKey}
                  onChange={(e) => setFormData({ ...formData, validateKey: e.target.checked })}
                  className="rounded"
                />
                Validar antes de salvar
              </label>
            </div>

            {/* Botão salvar */}
            <Button
              onClick={handleAddKey}
              disabled={saving || !formData.apiKey.trim()}
              className="w-full"
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Salvando...
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" />
                  Adicionar API Key
                </>
              )}
            </Button>
          </CollapsibleContent>
        </Collapsible>

        {/* Lista de keys por provedor */}
        {Object.keys(keysByProvider).length > 0 ? (
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-muted-foreground">Suas API Keys</h3>
            
            {Object.entries(keysByProvider).map(([providerId, providerKeys]) => {
              const config = PROVIDER_CONFIG[providerId] || { color: 'text-gray-600', bgColor: 'bg-gray-50' };
              
              return (
                <div key={providerId} className={`rounded-lg border p-4 ${config.bgColor}`}>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className={`font-medium ${config.color}`}>
                      {getProviderName(providerId)}
                    </h4>
                    <Badge variant="secondary">{providerKeys.length} key(s)</Badge>
                  </div>
                  
                  <div className="space-y-2">
                    {providerKeys.map((key) => (
                      <div
                        key={key.id}
                        className={`flex items-center justify-between p-3 rounded-md bg-background ${
                          !key.isActive ? 'opacity-50' : ''
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          {key.isDefault && (
                            <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                          )}
                          <div>
                            <p className="text-sm font-medium">
                              {key.keyName || `Key ${key.id.slice(0, 8)}`}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Criada em {new Date(key.createdAt).toLocaleDateString('pt-BR')}
                              {key.lastUsedAt && (
                                <> | Usado em {new Date(key.lastUsedAt).toLocaleDateString('pt-BR')}</>
                              )}
                            </p>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          {getValidationBadge(key.validationStatus)}
                          
                          {/* Botão validar */}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleValidate(key.id)}
                            disabled={validating === key.id}
                            title="Revalidar"
                          >
                            {validating === key.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RefreshCw className="h-4 w-4" />
                            )}
                          </Button>
                          
                          {/* Botão definir como padrão */}
                          {!key.isDefault && key.isActive && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleSetDefault(key.id)}
                              title="Definir como padrão"
                            >
                              <StarOff className="h-4 w-4" />
                            </Button>
                          )}
                          
                          {/* Botão remover */}
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                title="Remover"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Remover API Key</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Tem certeza que deseja remover esta API key? Esta ação não pode ser desfeita.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDelete(key.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Remover
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <Key className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>Nenhuma API key configurada</p>
            <p className="text-sm">
              Adicione suas próprias keys para usar modelos de IA
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
