import React, { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Send, CheckCircle, FileText, MapPin, Calendar, Briefcase, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import TypingIndicator from '@/components/chat/TypingIndicator';
import ChatAttachments, { Attachment } from '@/components/chat/ChatAttachments';
import MessageAttachments from '@/components/chat/MessageAttachments';
import { useTypingIndicator } from '@/hooks/useTypingIndicator';

interface Message {
  id: string;
  message: string;
  sender_type: 'user' | 'admin';
  created_at: string;
  attachments?: Attachment[];
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
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { isOtherTyping, sendTyping, sendStopTyping } = useTypingIndicator({
    chatId,
    userId: user?.id || null,
    userType: 'user',
  });

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
          const newMsg = payload.new as any;
          setMessages((prev) => [...prev, {
            id: newMsg.id,
            message: newMsg.message,
            sender_type: newMsg.sender_type,
            created_at: newMsg.created_at,
            attachments: Array.isArray(newMsg.attachments) ? newMsg.attachments : [],
          }]);
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

      const mappedMessages: Message[] = (chatMessages || []).map((msg: any) => ({
        id: msg.id,
        message: msg.message,
        sender_type: msg.sender_type,
        created_at: msg.created_at,
        attachments: Array.isArray(msg.attachments) ? msg.attachments : [],
      }));
      setMessages(mappedMessages);
    } catch (error) {
      console.error('Error initializing chat:', error);
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!newMessage.trim() && attachments.length === 0) || !chatId) return;

    setSending(true);
    sendStopTyping();
    try {
      const { error } = await supabase.from('chat_messages').insert({
        chat_id: chatId,
        message: newMessage.trim() || ' ',
        sender_type: 'user' as const,
        attachments: attachments.length > 0 ? JSON.parse(JSON.stringify(attachments)) : [],
      });

      if (error) throw error;
      setNewMessage('');
      setAttachments([]);
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      setSending(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewMessage(e.target.value);
    sendTyping();
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
                        "max-w-[80%] rounded-2xl px-4 py-2 break-words",
                        msg.sender_type === 'user'
                          ? "bg-primary text-primary-foreground rounded-br-sm ml-auto"
                          : "bg-muted rounded-bl-sm mr-auto"
                      )}
                    >
                      {msg.message.trim() && (
                        <p className="text-sm whitespace-pre-wrap">{msg.message}</p>
                      )}
                      <MessageAttachments 
                        attachments={msg.attachments || []} 
                        isOwnMessage={msg.sender_type === 'user'} 
                      />
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
              <TypingIndicator isTyping={isOtherTyping} />
              <div ref={messagesEndRef} />
            </div>

            <div className="p-4 border-t space-y-2">
              {attachments.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {attachments.map((att, index) => (
                    <div key={index} className="flex items-center gap-2 bg-muted rounded-lg px-3 py-1.5 text-sm flex-shrink-0">
                      <span className="max-w-[100px] truncate">{att.name}</span>
                      <button type="button" onClick={() => setAttachments(prev => prev.filter((_, i) => i !== index))} className="p-0.5 hover:bg-destructive/20 rounded">
                        <Trash2 className="w-3 h-3 text-destructive" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <form onSubmit={sendMessage} className="flex gap-2">
                {user && (
                  <ChatAttachments
                    attachments={attachments}
                    setAttachments={setAttachments}
                    userId={user.id}
                    disabled={sending}
                  />
                )}
                <Input
                  placeholder="Написать сообщение..."
                  value={newMessage}
                  onChange={handleInputChange}
                  disabled={sending}
                  className="flex-1"
                />
                <Button type="submit" disabled={(!newMessage.trim() && attachments.length === 0) || sending}>
                  <Send className="w-4 h-4" />
                </Button>
              </form>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default WorkerSupport;