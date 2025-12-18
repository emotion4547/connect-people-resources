import { useEffect, useRef, useState } from 'react';

interface UseScrollAnimationOptions {
  threshold?: number;
  rootMargin?: string;
  triggerOnce?: boolean;
  disabled?: boolean;
}

// Check if user prefers reduced motion
const prefersReducedMotion = (): boolean => {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
};

export const useScrollAnimation = (options: UseScrollAnimationOptions = {}) => {
  const { 
    threshold = 0.1, 
    rootMargin = '0px', 
    triggerOnce = true,
    disabled = false 
  } = options;
  
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [shouldAnimate, setShouldAnimate] = useState(true);

  useEffect(() => {
    // Check for reduced motion preference
    setShouldAnimate(!prefersReducedMotion() && !disabled);
  }, [disabled]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // If animations are disabled, show content immediately
    if (!shouldAnimate) {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          if (triggerOnce) {
            observer.unobserve(element);
          }
        } else if (!triggerOnce) {
          setIsVisible(false);
        }
      },
      { threshold, rootMargin }
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, [threshold, rootMargin, triggerOnce, shouldAnimate]);

  return { ref, isVisible, shouldAnimate };
};

export default useScrollAnimation;