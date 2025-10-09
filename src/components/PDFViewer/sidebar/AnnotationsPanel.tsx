/**
 * AnnotationsPanel - Painel de anotações com filtros e ordenação
 * 
 * Features:
 * - Lista de todas as anotações
 * - Filtros por tipo (highlight, área, nota)
 * - Ordenação (página, data, autor)
 * - Busca em anotações
 * - Navegação para anotação
 * - Ações rápidas (editar, deletar)
 */

import { useState } from 'react';
import { usePDFStore } from '@/stores/usePDFStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  Search, 
  Trash2, 
  MessageSquare, 
  Highlighter, 
  Square,
  SortAsc,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';

type FilterType = 'all' | 'highlight' | 'area' | 'note';
type SortBy = 'page' | 'date' | 'type';

export function AnnotationsPanel() {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [sortBy, setSortBy] = useState<SortBy>('page');
  
  const {
    annotations,
    selectedAnnotationId,
    selectAnnotation,
    deleteAnnotation,
    goToPage,
  } = usePDFStore();

  // Filtrar anotações ativas
  const activeAnnotations = annotations.filter(a => a.status === 'active');

  // Aplicar filtros
  const filteredAnnotations = activeAnnotations.filter(annotation => {
    // Filtro de tipo
    if (filterType !== 'all' && annotation.type !== filterType) return false;
    
    // Busca por texto (se tiver selectedText)
    if (searchQuery && 'selectedText' in annotation) {
      const text = annotation.selectedText?.toLowerCase() || '';
      if (!text.includes(searchQuery.toLowerCase())) return false;
    }
    
    return true;
  });

  // Aplicar ordenação
  const sortedAnnotations = [...filteredAnnotations].sort((a, b) => {
    switch (sortBy) {
      case 'page':
        return a.pageNumber - b.pageNumber;
      case 'date':
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      case 'type':
        return a.type.localeCompare(b.type);
      default:
        return 0;
    }
  });

  const getTypeLabel = (type: string) => {
    const labels = {
      highlight: 'Destaque',
      area: 'Área',
      note: 'Nota',
    };
    return labels[type as keyof typeof labels] || type;
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'highlight':
        return <Highlighter className="h-3 w-3" />;
      case 'area':
        return <Square className="h-3 w-3" />;
      default:
        return <MessageSquare className="h-3 w-3" />;
    }
  };

  if (activeAnnotations.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center">
        <MessageSquare className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="font-semibold text-sm mb-2">Sem Anotações</h3>
        <p className="text-xs text-muted-foreground">
          Selecione uma ferramenta de anotação na toolbar para começar.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header com Filtros */}
      <div className="p-3 border-b space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">
            Anotações ({filteredAnnotations.length})
          </h3>
        </div>

        {/* Busca */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Buscar..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 pl-7 text-sm"
          />
        </div>

        {/* Filtros */}
        <div className="flex gap-2">
          <Select value={filterType} onValueChange={(v) => setFilterType(v as FilterType)}>
            <SelectTrigger className="h-8 text-xs flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem value="highlight">Destaques</SelectItem>
              <SelectItem value="area">Áreas</SelectItem>
              <SelectItem value="note">Notas</SelectItem>
            </SelectContent>
          </Select>

          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
            <SelectTrigger className="h-8 text-xs w-[100px]">
              <SortAsc className="h-3 w-3 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="page">Página</SelectItem>
              <SelectItem value="date">Data</SelectItem>
              <SelectItem value="type">Tipo</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Lista de Anotações */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-2">
          {sortedAnnotations.map((annotation) => {
            const isSelected = selectedAnnotationId === annotation.id;
            
            return (
              <div
                key={annotation.id}
                className={cn(
                  'p-3 rounded-md border cursor-pointer transition-colors relative group',
                  isSelected
                    ? 'bg-primary/10 border-primary'
                    : 'bg-background hover:bg-accent'
                )}
                onClick={() => {
                  selectAnnotation(annotation.id);
                  goToPage(annotation.pageNumber);
                }}
              >
                {/* Color Bar */}
                <div 
                  className="absolute left-0 top-0 bottom-0 w-1 rounded-l-md"
                  style={{ backgroundColor: annotation.color, opacity: annotation.opacity }}
                />

                {/* Content */}
                <div className="pl-2 space-y-2">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex gap-2 items-center flex-wrap">
                      <Badge variant="secondary" className="text-xs h-5 gap-1">
                        {getTypeIcon(annotation.type)}
                        {getTypeLabel(annotation.type)}
                      </Badge>
                      <Badge variant="outline" className="text-xs h-5">
                        Pág. {annotation.pageNumber}
                      </Badge>
                    </div>
                    
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 opacity-0 group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteAnnotation(annotation.id);
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>

                  {/* Text Preview */}
                  {'selectedText' in annotation && annotation.selectedText && (
                    <p className="text-xs text-foreground line-clamp-2 italic">
                      "{annotation.selectedText}"
                    </p>
                  )}

                  {/* Footer */}
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {formatDistanceToNow(new Date(annotation.createdAt), {
                        addSuffix: true,
                        locale: ptBR,
                      })}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

