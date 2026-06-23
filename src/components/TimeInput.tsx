import React from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface TimeInputProps {
  value: string; // "HH:MM"
  onChange: (v: string) => void;
  id?: string;
  className?: string;
}

/**
 * Time input that allows manual digit entry on any device.
 * Two text inputs (hours / minutes) with inputMode="numeric".
 * Native <input type="time"> is unreliable for manual digit entry on mobile.
 */
export const TimeInput: React.FC<TimeInputProps> = ({ value, onChange, id, className }) => {
  const [h, m] = (value || '00:00').split(':');

  const setHours = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 2);
    onChange(`${digits.padStart(2, '0')}:${m || '00'}`);
  };
  const setMinutes = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 2);
    onChange(`${h || '00'}:${digits.padStart(2, '0')}`);
  };

  const clampHours = () => {
    let n = parseInt(h || '0', 10);
    if (isNaN(n) || n < 0) n = 0;
    if (n > 23) n = 23;
    onChange(`${String(n).padStart(2, '0')}:${m || '00'}`);
  };
  const clampMinutes = () => {
    let n = parseInt(m || '0', 10);
    if (isNaN(n) || n < 0) n = 0;
    if (n > 59) n = 59;
    onChange(`${h || '00'}:${String(n).padStart(2, '0')}`);
  };

  return (
    <div className={cn('flex items-center gap-1', className)} id={id}>
      <Input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={2}
        value={h ?? ''}
        onChange={(e) => setHours(e.target.value)}
        onBlur={clampHours}
        className="w-16 text-center"
        aria-label="Часы"
      />
      <span className="text-muted-foreground font-medium">:</span>
      <Input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={2}
        value={m ?? ''}
        onChange={(e) => setMinutes(e.target.value)}
        onBlur={clampMinutes}
        className="w-16 text-center"
        aria-label="Минуты"
      />
    </div>
  );
};
