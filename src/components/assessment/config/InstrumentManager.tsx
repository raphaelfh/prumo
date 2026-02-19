/**
 * Componente para gerenciar instrumentos de avaliacao
 *
 * Permite clonar instrumentos globais (PROBAST, ROBIS),
 * criar instrumentos customizados e gerenciar instrumentos do projeto.
 */

import React, { useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ArrowLeft,
  ClipboardList,
  Copy,
  Plus,
  Settings,
  CheckCircle,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  GlobalInstrumentSummary,
  ProjectAssessmentInstrument,
} from '@/types/assessment';
import {
  useProjectAssessmentInstrumentManager,
} from '@/hooks/assessment';
import { InstrumentConfigEditor } from './InstrumentConfigEditor';

interface InstrumentManagerProps {
  projectId: string;
}

export function InstrumentManager({ projectId }: InstrumentManagerProps) {
  const [showCloneDialog, setShowCloneDialog] = useState(false);
  const [selectedGlobalInstrument, setSelectedGlobalInstrument] =
    useState<GlobalInstrumentSummary | null>(null);
  const [customName, setCustomName] = useState('');
  const [editingInstrumentId, setEditingInstrumentId] = useState<string | null>(null);

  const {
    globalInstruments,
    projectInstruments,
    isLoadingGlobal,
    isLoadingProject,
    errorGlobal,
    cloneGlobalInstrument,
    isCloning,
    hasConfiguredInstrument,
  } = useProjectAssessmentInstrumentManager(projectId);

  const handleOpenCloneDialog = (instrument: GlobalInstrumentSummary) => {
    setSelectedGlobalInstrument(instrument);
    setCustomName('');
    setShowCloneDialog(true);
  };

  const handleClone = async () => {
    if (!selectedGlobalInstrument) return;

    try {
      await cloneGlobalInstrument(
        selectedGlobalInstrument.id,
        customName || undefined
      );
      toast.success('Instrumento clonado com sucesso!');
      setShowCloneDialog(false);
      setSelectedGlobalInstrument(null);
    } catch (error) {
      console.error('Error cloning instrument:', error);
      toast.error('Erro ao clonar instrumento');
    }
  };

  const isLoading = isLoadingGlobal || isLoadingProject;

  // Show editor when an instrument is selected for configuration
  if (editingInstrumentId) {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setEditingInstrumentId(null)}
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Voltar
        </Button>
        <InstrumentConfigEditor
          instrumentId={editingInstrumentId}
          projectId={projectId}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Instrumentos de Avaliacao</h3>
          <p className="text-sm text-muted-foreground">
            Configure o instrumento de avaliacao de qualidade para este projeto
          </p>
        </div>
      </div>

      {/* Status */}
      {hasConfiguredInstrument ? (
        <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-950 rounded-lg border border-green-200 dark:border-green-800">
          <CheckCircle className="h-5 w-5 text-green-600" />
          <span className="text-sm text-green-700 dark:text-green-300">
            Instrumento configurado: {projectInstruments[0]?.name}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2 p-3 bg-yellow-50 dark:bg-yellow-950 rounded-lg border border-yellow-200 dark:border-yellow-800">
          <AlertCircle className="h-5 w-5 text-yellow-600" />
          <span className="text-sm text-yellow-700 dark:text-yellow-300">
            Nenhum instrumento configurado. Selecione um instrumento abaixo para
            comecar.
          </span>
        </div>
      )}

      {/* Instrumentos Configurados */}
      {projectInstruments.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-muted-foreground">
            Instrumentos do Projeto
          </h4>
          <div className="grid gap-3">
            {projectInstruments.map((instrument) => (
              <Card key={instrument.id} className="border-primary/20">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ClipboardList className="h-5 w-5 text-primary" />
                      <CardTitle className="text-base">
                        {instrument.name}
                      </CardTitle>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{instrument.toolType}</Badge>
                      <Badge variant="outline">{instrument.version}</Badge>
                      {instrument.isActive && (
                        <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">
                          Ativo
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-muted-foreground">
                        {instrument.items?.length || 0} items de avaliacao
                      </p>
                      <Badge
                        variant="outline"
                        className={
                          instrument.targetMode === 'per_model'
                            ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-100'
                            : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100'
                        }
                      >
                        {instrument.targetMode === 'per_model'
                          ? 'Por modelo'
                          : 'Por artigo'}
                      </Badge>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingInstrumentId(instrument.id)}
                    >
                      <Settings className="h-4 w-4 mr-1" />
                      Configurar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Instrumentos Globais Disponiveis */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-muted-foreground">
          Instrumentos Disponiveis para Importar
        </h4>

        {isLoadingGlobal ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : errorGlobal ? (
          <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-950 rounded-lg border border-red-200 dark:border-red-800">
            <AlertCircle className="h-5 w-5 text-red-600" />
            <span className="text-sm text-red-700 dark:text-red-300">
              Erro ao carregar instrumentos: {errorGlobal instanceof Error ? errorGlobal.message : 'Erro desconhecido'}
            </span>
          </div>
        ) : globalInstruments.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            Nenhum instrumento global disponivel.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {globalInstruments.map((instrument) => {
              const alreadyCloned = projectInstruments.some(
                (pi) => pi.globalInstrumentId === instrument.id
              );

              return (
                <Card
                  key={instrument.id}
                  className={alreadyCloned ? 'opacity-60' : ''}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">
                        {instrument.name}
                      </CardTitle>
                      <Badge variant="outline">{instrument.toolType}</Badge>
                    </div>
                    <CardDescription>
                      Versao {instrument.version} | {instrument.itemsCount} items |{' '}
                      {instrument.targetMode === 'per_model' ? 'Por modelo' : 'Por artigo'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between">
                      <div className="flex flex-wrap gap-1">
                        {instrument.domains.slice(0, 3).map((domain) => (
                          <Badge
                            key={domain}
                            variant="secondary"
                            className="text-xs"
                          >
                            {domain}
                          </Badge>
                        ))}
                        {instrument.domains.length > 3 && (
                          <Badge variant="secondary" className="text-xs">
                            +{instrument.domains.length - 3}
                          </Badge>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant={alreadyCloned ? 'ghost' : 'default'}
                        onClick={() => handleOpenCloneDialog(instrument)}
                        disabled={alreadyCloned}
                      >
                        {alreadyCloned ? (
                          <>
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Importado
                          </>
                        ) : (
                          <>
                            <Copy className="h-4 w-4 mr-1" />
                            Importar
                          </>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Clone Dialog */}
      <Dialog open={showCloneDialog} onOpenChange={setShowCloneDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Importar Instrumento</DialogTitle>
            <DialogDescription>
              Importe o instrumento {selectedGlobalInstrument?.name} para este
              projeto. Voce podera customizar os items apos a importacao.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="customName">
                Nome Customizado (opcional)
              </Label>
              <Input
                id="customName"
                placeholder={selectedGlobalInstrument?.name}
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Deixe em branco para usar o nome original
              </p>
            </div>

            {selectedGlobalInstrument && (
              <div className="p-3 bg-muted rounded-lg">
                <p className="text-sm font-medium">
                  {selectedGlobalInstrument.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {selectedGlobalInstrument.itemsCount} items |{' '}
                  {selectedGlobalInstrument.domains.length} dominios
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCloneDialog(false)}
              disabled={isCloning}
            >
              Cancelar
            </Button>
            <Button onClick={handleClone} disabled={isCloning}>
              {isCloning ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Importando...
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 mr-2" />
                  Importar
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default InstrumentManager;
