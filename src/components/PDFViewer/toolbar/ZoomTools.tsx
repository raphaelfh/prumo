/**
 * ZoomTools - Ferramentas de controle de zoom
 * 
 * Features:
 * - Zoom In/Out
 * - Input de zoom personalizado
 * - Presets de zoom (Fit Width, Fit Page, Actual Size)
 * - Zoom com Ctrl/Cmd + Scroll (registrado no core)
 */

import { useState, useEffect } from 'react';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { usePDFStore } from '@/stores/usePDFStore';

export function ZoomTools() {
  const { scale, zoomIn, zoomOut, setScale } = usePDFStore();
  const [zoomInput, setZoomInput] = useState(Math.round(scale * 100).toString());

  // Sincronizar input com scale
  useEffect(() => {
    setZoomInput(Math.round(scale * 100).toString());
  }, [scale]);

  const handleZoomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const zoomPercent = parseInt(zoomInput, 10);
    
    if (!isNaN(zoomPercent) && zoomPercent >= 50 && zoomPercent <= 300) {
      setScale(zoomPercent / 100);
    } else {
      // Resetar para zoom atual se inválido
      setZoomInput(Math.round(scale * 100).toString());
    }
  };

  const handleZoomInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    // Permitir apenas números
    if (value === '' || /^\d+$/.test(value)) {
      setZoomInput(value);
    }
  };

  const presets = [
    { label: 'Ajustar à Largura', value: 1.0 },
    { label: 'Ajustar à Página', value: 0.85 },
    { label: 'Tamanho Real', value: 1.0 },
    { label: '50%', value: 0.5 },
    { label: '75%', value: 0.75 },
    { label: '100%', value: 1.0 },
    { label: '125%', value: 1.25 },
    { label: '150%', value: 1.5 },
    { label: '200%', value: 2.0 },
  ];

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        onClick={zoomOut}
        disabled={scale <= 0.5}
        title="Reduzir Zoom (Ctrl -)"
        className="h-8 w-8"
      >
        <ZoomOut className="h-4 w-4" />
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="h-8 px-2 min-w-[70px] justify-center hover:bg-accent"
            title="Opções de Zoom"
          >
            <form onSubmit={handleZoomSubmit} className="flex items-center" onClick={(e) => e.stopPropagation()}>
              <Input
                type="text"
                value={zoomInput}
                onChange={handleZoomInputChange}
                onBlur={handleZoomSubmit}
                className="w-10 h-6 text-center text-sm px-1 border-none shadow-none focus-visible:ring-0 bg-transparent hover:bg-transparent"
                aria-label="Porcentagem de zoom"
                style={{
                  color: 'inherit', // Herdar cor do parent para manter legibilidade
                }}
              />
              <span className="text-sm">%</span>
            </form>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {presets.map((preset) => (
            <DropdownMenuItem
              key={preset.label}
              onClick={() => setScale(preset.value)}
            >
              {preset.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        variant="ghost"
        size="icon"
        onClick={zoomIn}
        disabled={scale >= 3.0}
        title="Aumentar Zoom (Ctrl +)"
        className="h-8 w-8"
      >
        <ZoomIn className="h-4 w-4" />
      </Button>
    </div>
  );
}

