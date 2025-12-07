import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface UseTypingIndicatorProps {
  chatId: string | null;
  userId: string | null;
  userType: 'user' | 'admin';
}

export const useTypingIndicator = ({ chatId, userId, userType }: UseTypingIndicatorProps) => {
  const [isOtherTyping, setIsOtherTyping] = useState(false);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastTypingRef = useRef<number>(0);

  // Listen for typing events from the other party
  useEffect(() => {
    if (!chatId) return;

    const channel = supabase.channel(`typing-${chatId}`)
      .on('broadcast', { event: 'typing' }, (payload) => {
        // Only show typing if it's from the other party
        if (payload.payload?.userType !== userType) {
          setIsOtherTyping(true);
          
          // Clear existing timeout
          if (typingTimeoutRef.current) {
            clearTimeout(typingTimeoutRef.current);
          }
          
          // Hide typing indicator after 3 seconds of no activity
          typingTimeoutRef.current = setTimeout(() => {
            setIsOtherTyping(false);
          }, 3000);
        }
      })
      .on('broadcast', { event: 'stop_typing' }, (payload) => {
        if (payload.payload?.userType !== userType) {
          setIsOtherTyping(false);
          if (typingTimeoutRef.current) {
            clearTimeout(typingTimeoutRef.current);
          }
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, [chatId, userType]);

  // Send typing event (throttled)
  const sendTyping = useCallback(() => {
    if (!chatId || !userId) return;

    const now = Date.now();
    // Throttle: only send every 2 seconds
    if (now - lastTypingRef.current < 2000) return;
    lastTypingRef.current = now;

    supabase.channel(`typing-${chatId}`).send({
      type: 'broadcast',
      event: 'typing',
      payload: { userId, userType },
    });
  }, [chatId, userId, userType]);

  // Send stop typing event
  const sendStopTyping = useCallback(() => {
    if (!chatId || !userId) return;

    supabase.channel(`typing-${chatId}`).send({
      type: 'broadcast',
      event: 'stop_typing',
      payload: { userId, userType },
    });
  }, [chatId, userId, userType]);

  return {
    isOtherTyping,
    sendTyping,
    sendStopTyping,
  };
};
