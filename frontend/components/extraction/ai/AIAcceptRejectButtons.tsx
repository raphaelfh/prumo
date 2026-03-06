/**
 * Buttons to accept/reject AI suggestions
 *
 * Minimal component with inline ✓ ✗ buttons
 * 
 * @component
 */

import {Button} from '@/components/ui/button';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {Check, Loader2, X} from 'lucide-react';
import {cn} from '@/lib/utils';

// =================== INTERFACES ===================

interface AIAcceptRejectButtonsProps {
  onAccept?: () => void;
  onReject?: () => void;
  loading?: boolean;
  size?: 'sm' | 'default';
}

// =================== COMPONENT ===================

export function AIAcceptRejectButtons(props: AIAcceptRejectButtonsProps) {
  const { onAccept, onReject, loading = false, size = 'default' } = props;

  const buttonClass = size === 'sm' ? 'h-6 w-6' : 'h-7 w-7';

  return (
    <div className="flex items-center gap-0.5">
        {/* Accept button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            onClick={onAccept}
            disabled={loading}
            className={cn(
              buttonClass,
              "text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950/20"
            )}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
            <p>Accept AI suggestion</p>
        </TooltipContent>
      </Tooltip>

        {/* Reject button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            onClick={onReject}
            disabled={loading}
            className={cn(
              buttonClass,
              "text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20"
            )}
          >
            <X className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
            <p>Reject suggestion</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

