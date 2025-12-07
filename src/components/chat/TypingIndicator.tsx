import React from 'react';
import { cn } from '@/lib/utils';

interface TypingIndicatorProps {
  isTyping: boolean;
  className?: string;
}

const TypingIndicator: React.FC<TypingIndicatorProps> = ({ isTyping, className }) => {
  if (!isTyping) return null;

  return (
    <div className={cn("flex justify-start", className)}>
      <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-3">
        <div className="flex gap-1">
          <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  );
};

export default TypingIndicator;
