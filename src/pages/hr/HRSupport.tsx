import React, { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Send, CheckCircle, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import PageMeta from '@/components/PageMeta';

interface Message {
  id: string;
  message: string;
  sender_type: 'user' | 'admin';
  created_at: string;
}

interface RequestInfo {
  id: string;
  position: string;
  start_date: string;
  address: string;
  status: string;
}

const HRSupport: React.FC = () => {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const requestId = searchParams.get('request');
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [chatId, setChatId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [requestInfo, setRequestInfo] = useState<RequestInfo | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (user) {
      initializeChat();
    }
  }, [user, requestId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (!chatId) return;

    const channel = supabase
      .channel(`chat-${chatId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `chat_id=eq.${chatId}`,
        },
        (payload) => {
          const newMsg = payload.new as Message;
          setMessages((prev) => [...prev, newMsg]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [chatId]);

  const initializeChat = async () => {
    if (!user) return;

    try {
      // Fetch request info if requestId provided
      if (requestId) {
        const { data: reqData } = await supabase
          .from('requests')
          .select('id, position, start_date, address, status')
          .eq('id', requestId)
          .maybeSingle();
        
        if (reqData) {
          setRequestInfo(reqData);
        }
      }

      // Check for existing chat
      let query = supabase
        .from('support_chats')
        .select('id')
        .eq('user_id', user.id);
      
      if (requestId) {
        query = query.eq('request_id', requestId);
      } else {
        query = query.is('request_id', null);
      }

      let { data: existingChat } = await query.maybeSingle();

      if (!existingChat) {
        // Create new chat
        const { data: newChat, error } = await supabase
          .from('support_chats')
          .insert({
            user_id: user.id,
            user_type: 'hr',
            request_id: requestId || null,
          })
          .select()
          .single();

        if (error) throw error;
        existingChat = newChat;
      }

      setChatId(existingChat.id);

      // Fetch messages
      const { data: chatMessages } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('chat_id', existingChat.id)
        .order('created_at', { ascending: true });

      setMessages(chatMessages || []);
    } catch (error) {
      console.error('Error initializing chat:', error);
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !chatId) return;

    setSending(true);
    try {
      const { error } = await supabase.from('chat_messages').insert({
        chat_id: chatId,
        message: newMessage.trim(),
        sender_type: 'user',
      });

      if (error) throw error;
      setNewMessage('');
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      setSending(false);
    }
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      new: 'Новая',
      in_progress: 'В работе',
      assigned: 'Назначено',
      pending_confirmation: 'Ожидает подтверждения',
      completed: 'Выполнено',
      cancelled: 'Отменена',
    };
    return labels[status] || status;
  };

  return (
    <DashboardLayout role="hr">
      <PageMeta title="Поддержка" description="Чат с поддержкой системы Люди и Ресурсы" />
      <div className="h-[calc(100vh-8rem)] flex flex-col animate-slide-up">
        <Card className="flex-1 flex flex-col">
          <CardHeader className="border-b">
            <div className="flex items-center justify-between">
              <CardTitle>Связь с поддержкой</CardTitle>
              <div className="flex items-center gap-2 text-sm text-status-success">
                <CheckCircle className="w-4 h-4" />
                Менеджер онлайн
              </div>
            </div>
            
            {/* Request Info Banner */}
            {requestInfo && (
              <div className="mt-3 p-3 bg-primary/10 rounded-lg flex items-center gap-3">
                <FileText className="w-5 h-5 text-primary" />
                <div className="flex-1">
                  <p className="text-sm font-medium">Обращение по заявке: {requestInfo.position}</p>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(requestInfo.start_date), 'd MMMM yyyy', { locale: ru })} • {requestInfo.address}
                  </p>
                </div>
                <Badge variant="outline">{getStatusLabel(requestInfo.status)}</Badge>
              </div>
            )}
          </CardHeader>
          <CardContent className="flex-1 flex flex-col p-0">
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {loading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => (
                    <div key={i} className={cn(
                      "h-12 w-48 bg-muted animate-shimmer rounded-2xl",
                      i % 2 === 0 ? "ml-auto" : ""
                    )} />
                  ))}
                </div>
              ) : messages.length > 0 ? (
                messages.map((msg, index) => (
                  <div
                    key={msg.id}
                    className={cn(
                      "flex animate-slide-in-right",
                      msg.sender_type === 'user' ? "justify-end" : "justify-start"
                    )}
                    style={{ animationDelay: `${index * 0.05}s` }}
                  >
                    <div
                      className={cn(
                        "max-w-[80%] rounded-2xl px-4 py-2",
                        msg.sender_type === 'user'
                          ? "bg-primary text-primary-foreground rounded-br-sm"
                          : "bg-muted rounded-bl-sm"
                      )}
                    >
                      <p className="text-sm">{msg.message}</p>
                      <p className={cn(
                        "text-xs mt-1",
                        msg.sender_type === 'user' ? "text-primary-foreground/70" : "text-muted-foreground"
                      )}>
                        {format(new Date(msg.created_at), 'HH:mm')}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center text-muted-foreground py-8">
                  <p>
                    {requestInfo 
                      ? 'Напишите нам по поводу этой заявки' 
                      : 'Напишите нам, если у вас есть вопросы'}
                  </p>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <form onSubmit={sendMessage} className="p-4 border-t flex gap-2">
              <Input
                placeholder="Написать сообщение..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                disabled={sending}
                className="flex-1"
              />
              <Button type="submit" disabled={!newMessage.trim() || sending}>
                <Send className="w-4 h-4" />
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default HRSupport;
