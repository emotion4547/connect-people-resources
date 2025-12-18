import React, { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Send, CheckCircle, FileText, MapPin, Calendar, Briefcase } from 'lucide-react';
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

interface LinkedRequest {
  id: string;
  position: string;
  address: string;
  start_date: string;
  status: string;
}

const WorkerSupport: React.FC = () => {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const requestIdFromUrl = searchParams.get('request_id');
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [chatId, setChatId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [linkedRequest, setLinkedRequest] = useState<LinkedRequest | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (user) {
      initializeChat();
    }
  }, [user, requestIdFromUrl]);

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
      // If there's a request_id in URL, try to find or create a chat for this specific request
      let existingChat = null;
      
      if (requestIdFromUrl) {
        // First, try to find existing chat for this request
        const { data: requestChat } = await supabase
          .from('support_chats')
          .select('id, request_id')
          .eq('user_id', user.id)
          .eq('request_id', requestIdFromUrl)
          .maybeSingle();
        
        if (requestChat) {
          existingChat = requestChat;
        } else {
          // Create new chat linked to this request
          const { data: newChat, error } = await supabase
            .from('support_chats')
            .insert({
              user_id: user.id,
              user_type: 'worker',
              request_id: requestIdFromUrl,
            })
            .select()
            .single();

          if (error) throw error;
          existingChat = newChat;
        }

        // Fetch linked request info
        const { data: requestData } = await supabase
          .from('requests')
          .select('id, position, address, start_date, status')
          .eq('id', requestIdFromUrl)
          .maybeSingle();
        
        if (requestData) {
          setLinkedRequest(requestData);
        }
      } else {
        // Find or create general support chat (without request_id)
        const { data: generalChat } = await supabase
          .from('support_chats')
          .select('id, request_id')
          .eq('user_id', user.id)
          .is('request_id', null)
          .maybeSingle();

        if (generalChat) {
          existingChat = generalChat;
        } else {
          const { data: newChat, error } = await supabase
            .from('support_chats')
            .insert({
              user_id: user.id,
              user_type: 'worker',
            })
            .select()
            .single();

          if (error) throw error;
          existingChat = newChat;
        }
      }

      setChatId(existingChat.id);

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

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { label: string; className: string }> = {
      new: { label: 'Новая', className: 'bg-status-orange/20 text-status-orange' },
      in_progress: { label: 'В работе', className: 'bg-primary/20 text-primary' },
      assigned: { label: 'Назначено', className: 'bg-status-gold/20 text-secondary' },
      completed: { label: 'Выполнено', className: 'bg-status-success/20 text-status-success' },
    };
    const variant = variants[status] || variants.new;
    return <Badge className={cn("text-xs", variant.className)}>{variant.label}</Badge>;
  };

  return (
    <DashboardLayout role="worker">
      <PageMeta title="Поддержка" description="Чат с поддержкой для исполнителей" />
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
            
            {/* Linked Request Info */}
            {linkedRequest && (
              <div className="mt-3 p-3 bg-muted rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <FileText className="w-4 h-4 text-primary" />
                  <span className="text-sm font-medium">Обращение по заявке</span>
                  {getStatusBadge(linkedRequest.status)}
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <Briefcase className="w-3 h-3" />
                    <span>{linkedRequest.position}</span>
                  </div>
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <Calendar className="w-3 h-3" />
                    <span>{format(new Date(linkedRequest.start_date), 'd MMM', { locale: ru })}</span>
                  </div>
                  <div className="flex items-center gap-1 text-muted-foreground col-span-2">
                    <MapPin className="w-3 h-3" />
                    <span className="truncate">{linkedRequest.address}</span>
                  </div>
                </div>
              </div>
            )}
          </CardHeader>
          <CardContent className="flex-1 flex flex-col p-0">
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
                    {linkedRequest 
                      ? `Задайте вопрос по заявке "${linkedRequest.position}"`
                      : 'Напишите нам, если у вас есть вопросы'
                    }
                  </p>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

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

export default WorkerSupport;