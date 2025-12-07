import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { X, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NotificationData {
  id: string;
  chatId: string;
  message: string;
  senderName?: string;
  senderType: 'user' | 'admin';
  userType?: 'hr' | 'worker';
  timestamp: Date;
}

const MessageNotifications: React.FC = () => {
  const { user, role } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [notifications, setNotifications] = useState<NotificationData[]>([]);

  useEffect(() => {
    if (!user || !role) return;

    // Subscribe to new messages
    const channel = supabase
      .channel('global-messages')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
        },
        async (payload) => {
          const newMessage = payload.new as {
            id: string;
            chat_id: string;
            message: string;
            sender_type: 'user' | 'admin';
            created_at: string;
          };

          // For admin: show notifications for user messages
          // For HR/Worker: show notifications for admin messages
          if (role === 'admin') {
            // Skip if we're already on messages page viewing this chat
            if (location.pathname === '/admin/messages') return;
            
            // Only show user messages to admin
            if (newMessage.sender_type !== 'user') return;

            // Get chat info
            const { data: chatData } = await supabase
              .from('support_chats')
              .select('user_id, user_type')
              .eq('id', newMessage.chat_id)
              .maybeSingle();

            if (!chatData) return;

            // Get sender profile
            const { data: profile } = await supabase
              .from('profiles')
              .select('full_name, email')
              .eq('user_id', chatData.user_id)
              .maybeSingle();

            const notification: NotificationData = {
              id: newMessage.id,
              chatId: newMessage.chat_id,
              message: newMessage.message.length > 100 
                ? newMessage.message.substring(0, 100) + '...' 
                : newMessage.message,
              senderName: profile?.full_name || profile?.email || 'Пользователь',
              senderType: newMessage.sender_type,
              userType: chatData.user_type,
              timestamp: new Date(newMessage.created_at),
            };

            setNotifications(prev => [...prev, notification]);
          } else {
            // HR or Worker - show admin messages
            if (newMessage.sender_type !== 'admin') return;
            
            // Skip if already on support page
            if (location.pathname.includes('/support')) return;

            // Check if this chat belongs to the current user
            const { data: chatData } = await supabase
              .from('support_chats')
              .select('user_id')
              .eq('id', newMessage.chat_id)
              .maybeSingle();

            if (!chatData || chatData.user_id !== user.id) return;

            const notification: NotificationData = {
              id: newMessage.id,
              chatId: newMessage.chat_id,
              message: newMessage.message.length > 100 
                ? newMessage.message.substring(0, 100) + '...' 
                : newMessage.message,
              senderName: 'Поддержка',
              senderType: newMessage.sender_type,
              timestamp: new Date(newMessage.created_at),
            };

            setNotifications(prev => [...prev, notification]);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, role, location.pathname]);

  // Auto-remove notifications after 10 seconds
  useEffect(() => {
    if (notifications.length === 0) return;

    const timer = setTimeout(() => {
      setNotifications(prev => prev.slice(1));
    }, 10000);

    return () => clearTimeout(timer);
  }, [notifications]);

  const handleClick = (notification: NotificationData) => {
    // Remove the notification
    setNotifications(prev => prev.filter(n => n.id !== notification.id));
    
    // Navigate to chat
    if (role === 'admin') {
      navigate('/admin/messages');
    } else if (role === 'hr') {
      navigate('/hr/support');
    } else if (role === 'worker') {
      navigate('/worker/support');
    }
  };

  const handleClose = (e: React.MouseEvent, notificationId: string) => {
    e.stopPropagation();
    setNotifications(prev => prev.filter(n => n.id !== notificationId));
  };

  if (notifications.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {notifications.map((notification, index) => (
        <div
          key={notification.id}
          onClick={() => handleClick(notification)}
          className={cn(
            "bg-card border shadow-lg rounded-xl p-4 cursor-pointer",
            "transform transition-all duration-300 hover:scale-[1.02] hover:shadow-xl",
            "animate-slide-in-right"
          )}
          style={{ animationDelay: `${index * 0.1}s` }}
        >
          <div className="flex items-start gap-3">
            <div className={cn(
              "w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0",
              notification.userType === 'hr' 
                ? "bg-primary/20" 
                : notification.userType === 'worker'
                  ? "bg-secondary/20"
                  : "bg-primary/20"
            )}>
              <MessageSquare className={cn(
                "w-5 h-5",
                notification.userType === 'hr' 
                  ? "text-primary" 
                  : notification.userType === 'worker'
                    ? "text-secondary"
                    : "text-primary"
              )} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-sm truncate">
                  {notification.senderName}
                </p>
                <button
                  onClick={(e) => handleClose(e, notification.id)}
                  className="p-1 hover:bg-muted rounded-full transition-colors flex-shrink-0"
                >
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
              <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                {notification.message}
              </p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Нажмите, чтобы открыть чат
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default MessageNotifications;
