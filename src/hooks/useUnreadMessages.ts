import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

// Base64 encoded notification sound (short beep)
const NOTIFICATION_SOUND = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYNGbTmAAAAAAD/+9DEAAAGAAGn9AAAIgAANP8AAARMQAAAAAAANIAAAAATDEEFQ5AgDA4IAEHC4IBg+D5d0IAgCH2e7u8IAgCAIffy4Pv//y4IB99/EBd3Lv//BAHwQBB3d3d3d3d3d3d3d3d3d3d3d3d3dAAAAAAAAEYJhkIIIYYZBgIIIYA=';

export const useUnreadMessages = () => {
  const { user, role } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Initialize audio element
  useEffect(() => {
    audioRef.current = new Audio(NOTIFICATION_SOUND);
    audioRef.current.volume = 0.6;
  }, []);

  const playNotificationSound = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {
        // Ignore autoplay restrictions
      });
    }
  }, []);

  const fetchUnreadCount = useCallback(async () => {
    if (!user || !role) return;

    try {
      if (role === 'admin') {
        // Admin: count all unread messages from users
        const { data, error } = await supabase
          .from('support_chats')
          .select('unread_count');

        if (!error && data) {
          const total = data.reduce((sum, chat) => sum + (chat.unread_count || 0), 0);
          setUnreadCount(total);
        }
      } else {
        // HR/Worker: count unread messages in their own chat
        const { data: chats, error } = await supabase
          .from('support_chats')
          .select('id')
          .eq('user_id', user.id);

        if (!error && chats && chats.length > 0) {
          const chatIds = chats.map(c => c.id);
          
          const { count, error: msgError } = await supabase
            .from('chat_messages')
            .select('*', { count: 'exact', head: true })
            .in('chat_id', chatIds)
            .eq('sender_type', 'admin')
            .eq('is_read', false);

          if (!msgError) {
            setUnreadCount(count || 0);
          }
        }
      }
    } catch (error) {
      console.error('Error fetching unread count:', error);
    }
  }, [user, role]);

  useEffect(() => {
    fetchUnreadCount();

    // Subscribe to new messages
    const channel = supabase
      .channel('unread-messages-count')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
        },
        async (payload) => {
          const newMessage = payload.new as {
            sender_type: 'user' | 'admin';
            chat_id: string;
          };

          // Check if this message should trigger notification
          if (role === 'admin' && newMessage.sender_type === 'user') {
            playNotificationSound();
            fetchUnreadCount();
          } else if (role !== 'admin' && newMessage.sender_type === 'admin') {
            // Check if this chat belongs to current user
            const { data: chatData } = await supabase
              .from('support_chats')
              .select('user_id')
              .eq('id', newMessage.chat_id)
              .maybeSingle();

            if (chatData && chatData.user_id === user?.id) {
              playNotificationSound();
              fetchUnreadCount();
            }
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'chat_messages',
        },
        () => {
          fetchUnreadCount();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'support_chats',
        },
        () => {
          fetchUnreadCount();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, role, fetchUnreadCount, playNotificationSound]);

  return { unreadCount, refetchUnreadCount: fetchUnreadCount, playNotificationSound };
};
