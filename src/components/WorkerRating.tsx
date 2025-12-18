import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

interface WorkerRatingProps {
  workerName: string;
  currentRating?: number;
  onSubmit: (rating: number, comment: string) => Promise<void>;
  onSkip?: () => void;
}

export const WorkerRating: React.FC<WorkerRatingProps> = ({
  workerName,
  currentRating,
  onSubmit,
  onSkip,
}) => {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (rating === 0) return;
    
    setIsSubmitting(true);
    try {
      await onSubmit(rating, comment);
    } finally {
      setIsSubmitting(false);
    }
  };

  const displayRating = hoverRating || rating;

  return (
    <div className="space-y-4">
      <div className="text-center">
        <p className="text-sm text-muted-foreground mb-1">Оцените работу исполнителя</p>
        <p className="font-medium">{workerName}</p>
        {currentRating !== undefined && currentRating > 0 && (
          <p className="text-xs text-muted-foreground mt-1">
            Текущий рейтинг: {currentRating.toFixed(1)}
          </p>
        )}
      </div>

      <div className="flex justify-center gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            onClick={() => setRating(star)}
            onMouseEnter={() => setHoverRating(star)}
            onMouseLeave={() => setHoverRating(0)}
            className="p-1 transition-transform hover:scale-110 focus:outline-none"
          >
            <Star
              className={cn(
                "w-8 h-8 transition-colors",
                star <= displayRating
                  ? "fill-secondary text-secondary"
                  : "text-muted-foreground/30"
              )}
            />
          </button>
        ))}
      </div>

      {rating > 0 && (
        <p className="text-center text-sm text-muted-foreground">
          {rating === 1 && 'Очень плохо'}
          {rating === 2 && 'Плохо'}
          {rating === 3 && 'Нормально'}
          {rating === 4 && 'Хорошо'}
          {rating === 5 && 'Отлично'}
        </p>
      )}

      <div>
        <Label className="text-sm">Комментарий (необязательно)</Label>
        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Добавьте комментарий о работе исполнителя..."
          className="mt-1 resize-none"
          rows={3}
        />
      </div>

      <div className="flex gap-2">
        {onSkip && (
          <Button
            variant="outline"
            onClick={onSkip}
            disabled={isSubmitting}
            className="flex-1"
          >
            Пропустить
          </Button>
        )}
        <Button
          onClick={handleSubmit}
          disabled={rating === 0 || isSubmitting}
          className="flex-1"
        >
          {isSubmitting ? 'Сохранение...' : 'Сохранить оценку'}
        </Button>
      </div>
    </div>
  );
};
