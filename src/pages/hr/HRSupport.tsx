import React, { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Send, CheckCircle, FileText, Trash2 } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
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
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
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

  const handleDeleteMessage = async (messageId: string) => {
    setDeletingMessageId(messageId);
    try {
      const { error } = await supabase
        .from('chat_messages')
        .delete()
        .eq('id', messageId);

      if (error) throw error;
      
      setMessages(messages.filter(m => m.id !== messageId));
    } catch (error) {
      console.error('Error deleting message:', error);
    } finally {
      setDeletingMessageId(null);
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
                      "flex animate-slide-in-right group",
                      msg.sender_type === 'user' ? "justify-end" : "justify-start"
                    )}
                    style={{ animationDelay: `${index * 0.05}s` }}
                  >
                    <div className={cn(
                      "relative max-w-[80%]",
                      msg.sender_type === 'user' ? "ml-auto" : "mr-auto"
                    )}>
                      <div
                        className={cn(
                          "rounded-2xl px-4 py-2 break-words",
                          msg.sender_type === 'user'
                            ? "bg-primary text-primary-foreground rounded-br-sm"
                            : "bg-muted rounded-bl-sm"
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
                      {msg.sender_type === 'user' && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <button
                              className="absolute -left-8 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-destructive/10 rounded"
                              disabled={deletingMessageId === msg.id}
                            >
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Удалить сообщение?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Это действие нельзя отменить.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Отмена</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDeleteMessage(msg.id)}
                                className="bg-destructive hover:bg-destructive/90"
                              >
                                Удалить
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
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
              <TypingIndicator isTyping={isOtherTyping} />
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
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

export default HRSupport;
