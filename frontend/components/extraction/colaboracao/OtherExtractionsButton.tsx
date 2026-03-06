/**
 * Button to show other extractions
 *
 * Minimal component with count badge.
 * Usado como trigger do popover.
 * 
 * @component
 */

import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {Users} from 'lucide-react';
import {forwardRef} from 'react';

// =================== INTERFACES ===================

interface OtherExtractionsButtonProps {
  count: number;
  onClick?: () => void;
}

// =================== COMPONENT ===================

export const OtherExtractionsButton = forwardRef<
  HTMLButtonElement,
  OtherExtractionsButtonProps
>((props, ref) => {
  const { count, onClick } = props;

  if (count === 0) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          ref={ref}
          variant="ghost"
          size="icon"
          className="relative h-8 w-8 shrink-0"
          onClick={onClick}
        >
          <Users className="h-4 w-4 text-muted-foreground" />
          {count > 0 && (
            <Badge
              variant="secondary"
              className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
            >
              {count}
            </Badge>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
          <p>View other members' extractions ({count})</p>
      </TooltipContent>
    </Tooltip>
  );
});

OtherExtractionsButton.displayName = 'OtherExtractionsButton';

