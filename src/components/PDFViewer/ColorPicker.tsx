import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';

export interface ColorOption {
  name: string;
  color: string;
  defaultOpacity: number;
}

export const ANNOTATION_COLORS: ColorOption[] = [
  { name: 'Amarelo', color: '#FFEB3B', defaultOpacity: 0.4 },
  { name: 'Verde', color: '#4CAF50', defaultOpacity: 0.3 },
  { name: 'Azul', color: '#2196F3', defaultOpacity: 0.3 },
  { name: 'Roxo', color: '#9C27B0', defaultOpacity: 0.3 },
  { name: 'Rosa', color: '#E91E63', defaultOpacity: 0.3 },
  { name: 'Laranja', color: '#FF9800', defaultOpacity: 0.3 },
  { name: 'Vermelho', color: '#F44336', defaultOpacity: 0.3 },
  { name: 'Cinza', color: '#9E9E9E', defaultOpacity: 0.3 },
];

interface ColorPickerProps {
  selectedColor: string;
  selectedOpacity: number;
  onColorChange: (color: string, opacity: number) => void;
  className?: string;
}

export function ColorPicker({
  selectedColor,
  selectedOpacity,
  onColorChange,
  className,
}: ColorPickerProps) {
  const [opacity, setOpacity] = useState(selectedOpacity);

  const handleColorSelect = (colorOption: ColorOption) => {
    setOpacity(colorOption.defaultOpacity);
    onColorChange(colorOption.color, colorOption.defaultOpacity);
  };

  const handleOpacityChange = (value: number[]) => {
    const newOpacity = value[0];
    setOpacity(newOpacity);
    onColorChange(selectedColor, newOpacity);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn('gap-2', className)}
        >
          <div
            className="w-4 h-4 rounded border border-border"
            style={{ backgroundColor: selectedColor, opacity: selectedOpacity }}
          />
          Cor
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64" align="start">
        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-medium mb-2">Escolha a cor</h4>
            <div className="grid grid-cols-4 gap-2">
              {ANNOTATION_COLORS.map((colorOption) => (
                <button
                  key={colorOption.name}
                  onClick={() => handleColorSelect(colorOption)}
                  className={cn(
                    'w-12 h-12 rounded-md border-2 transition-all hover:scale-110',
                    selectedColor === colorOption.color
                      ? 'border-primary ring-2 ring-primary ring-offset-2'
                      : 'border-border'
                  )}
                  style={{
                    backgroundColor: colorOption.color,
                    opacity: selectedColor === colorOption.color ? opacity : colorOption.defaultOpacity,
                  }}
                  title={colorOption.name}
                />
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-sm font-medium mb-2">
              Opacidade: {Math.round(opacity * 100)}%
            </h4>
            <Slider
              value={[opacity]}
              onValueChange={handleOpacityChange}
              min={0.1}
              max={0.9}
              step={0.1}
              className="w-full"
            />
          </div>

          <div
            className="w-full h-12 rounded-md border"
            style={{ backgroundColor: selectedColor, opacity }}
          >
            <div className="w-full h-full flex items-center justify-center text-sm font-medium">
              Prévia
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
