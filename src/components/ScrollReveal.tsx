import React from 'react';
import { cn } from '@/lib/utils';
import { useScrollAnimation } from '@/hooks/useScrollAnimation';
import { useIsMobile } from '@/hooks/use-mobile';

type AnimationType = 'fade-up' | 'fade-down' | 'fade-left' | 'fade-right' | 'zoom-in' | 'zoom-out';

interface ScrollRevealProps {
  children: React.ReactNode;
  animation?: AnimationType;
  delay?: number;
  duration?: number;
  className?: string;
  threshold?: number;
  /** Disable animations on mobile for better performance */
  disableOnMobile?: boolean;
  /** Reduce animation intensity on mobile */
  reducedOnMobile?: boolean;
}

const animationClasses: Record<AnimationType, { initial: string; visible: string }> = {
  'fade-up': {
    initial: 'opacity-0 translate-y-8',
    visible: 'opacity-100 translate-y-0',
  },
  'fade-down': {
    initial: 'opacity-0 -translate-y-8',
    visible: 'opacity-100 translate-y-0',
  },
  'fade-left': {
    initial: 'opacity-0 translate-x-8',
    visible: 'opacity-100 translate-x-0',
  },
  'fade-right': {
    initial: 'opacity-0 -translate-x-8',
    visible: 'opacity-100 translate-x-0',
  },
  'zoom-in': {
    initial: 'opacity-0 scale-95',
    visible: 'opacity-100 scale-100',
  },
  'zoom-out': {
    initial: 'opacity-0 scale-105',
    visible: 'opacity-100 scale-100',
  },
};

// Reduced motion animations (only opacity, no transforms)
const reducedAnimationClasses: Record<AnimationType, { initial: string; visible: string }> = {
  'fade-up': { initial: 'opacity-0', visible: 'opacity-100' },
  'fade-down': { initial: 'opacity-0', visible: 'opacity-100' },
  'fade-left': { initial: 'opacity-0', visible: 'opacity-100' },
  'fade-right': { initial: 'opacity-0', visible: 'opacity-100' },
  'zoom-in': { initial: 'opacity-0', visible: 'opacity-100' },
  'zoom-out': { initial: 'opacity-0', visible: 'opacity-100' },
};

export const ScrollReveal: React.FC<ScrollRevealProps> = ({
  children,
  animation = 'fade-up',
  delay = 0,
  duration = 600,
  className,
  threshold = 0.1,
  disableOnMobile = false,
  reducedOnMobile = true,
}) => {
  const isMobile = useIsMobile();
  const shouldDisable = disableOnMobile && isMobile;
  const shouldReduce = reducedOnMobile && isMobile;
  
  const { ref, isVisible, shouldAnimate } = useScrollAnimation({ 
    threshold,
    disabled: shouldDisable 
  });
  
  // Choose animation classes based on mobile/reduced settings
  const classes = shouldReduce ? reducedAnimationClasses : animationClasses;
  const { initial, visible } = classes[animation];
  
  // Reduce duration on mobile for snappier feel
  const actualDuration = shouldReduce ? Math.min(duration, 400) : duration;
  // Reduce delays on mobile
  const actualDelay = shouldReduce ? Math.min(delay, 100) : delay;

  // If animations are completely disabled, render without animation styles
  if (!shouldAnimate) {
    return (
      <div className={className}>
        {children}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className={cn(
        'will-change-[opacity,transform]',
        isVisible ? visible : initial,
        className
      )}
      style={{
        transitionProperty: 'opacity, transform',
        transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
        transitionDuration: `${actualDuration}ms`,
        transitionDelay: `${actualDelay}ms`,
      }}
    >
      {children}
    </div>
  );
};

export default ScrollReveal;