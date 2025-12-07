import React, { useEffect, useState, useRef, useMemo } from 'react';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { Send, Mail, User, FileText, MapPin, Calendar, RotateCcw, Trash2 } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useAuth } from '@/contexts/AuthContext';
import TypingIndicator from '@/components/chat/TypingIndicator';
import ChatAttachments, { Attachment } from '@/components/chat/ChatAttachments';
import MessageAttachments from '@/components/chat/MessageAttachments';
import { useTypingIndicator } from '@/hooks/useTypingIndicator';

interface Chat {
  id: string;
  user_id: string;
  user_type: 'hr' | 'worker';
  unread_count: number;
  request_id: string | null;
  full_name?: string;
  company?: string;
  email?: string;
}

interface Request {
  id: string;
  position: string;
  address: string;
  start_date: string;
  status: string;
}

interface Message {
  id: string;
  message: string;
  sender_type: 'user' | 'admin';
  created_at: string;
  attachments?: Attachment[];
}

const AdminMessages: React.FC = () => {
  const { user } = useAuth();
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [linkedRequest, setLinkedRequest] = useState<Request | null>(null);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
  const [deletingChatId, setDeletingChatId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { isOtherTyping, sendTyping, sendStopTyping } = useTypingIndicator({
    chatId: selectedChat?.id || null,
    userId: user?.id || null,
    userType: 'admin',
  });

  // Filters
  const [userTypeFilter, setUserTypeFilter] = useState<string>('all');

  useEffect(() => { fetchChats(); }, []);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  useEffect(() => {
    if (!selectedChat) return;
    const channel = supabase.channel(`admin-chat-${selectedChat.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `chat_id=eq.${selectedChat.id}` },
        (payload) => {
          const newMsg = payload.new as any;
          setMessages((prev) => [...prev, {
            ...newMsg,
            attachments: Array.isArray(newMsg.attachments) ? newMsg.attachments : [],
          }]);
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedChat]);

  const fetchChats = async () => {
    try {
      const { data } = await supabase.from('support_chats').select('*').order('updated_at', { ascending: false });
      const userIds = (data || []).map(c => c.user_id);
      const { data: profiles } = await supabase.from('profiles').select('user_id, full_name, company, email').in('user_id', userIds);
      const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);
      setChats((data || []).map(c => ({ ...c, ...profileMap.get(c.user_id) })));
    } catch (error) { console.error('Error fetching chats:', error); }
    finally { setLoading(false); }
  };

  const filteredChats = useMemo(() => {
    if (userTypeFilter === 'all') return chats;
    return chats.filter(c => c.user_type === userTypeFilter);
  }, [chats, userTypeFilter]);

  const resetFilters = () => {
    setUserTypeFilter('all');
  };

  const hasActiveFilters = userTypeFilter !== 'all';

  const selectChat = async (chat: Chat) => {
    setSelectedChat(chat);
    setLinkedRequest(null);
    setAttachments([]);
    
    const { data } = await supabase.from('chat_messages').select('*').eq('chat_id', chat.id).order('created_at', { ascending: true });
    // Map data to proper Message type with attachments
    const mappedMessages: Message[] = (data || []).map((msg: any) => ({
      id: msg.id,
      message: msg.message,
      sender_type: msg.sender_type,
      created_at: msg.created_at,
      attachments: Array.isArray(msg.attachments) ? msg.attachments : [],
    }));
    setMessages(mappedMessages);

    // Fetch linked request if exists
    if (chat.request_id) {
      const { data: requestData } = await supabase
        .from('requests')
        .select('id, position, address, start_date, status')
        .eq('id', chat.request_id)
        .maybeSingle();
      
      if (requestData) {
        setLinkedRequest(requestData);
      }
    }

    // Mark as read
    if (chat.unread_count > 0) {
      await supabase.from('support_chats').update({ unread_count: 0 }).eq('id', chat.id);
      setChats(chats.map(c => c.id === chat.id ? { ...c, unread_count: 0 } : c));
    }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!newMessage.trim() && attachments.length === 0) || !selectedChat) return;
    setSending(true);
    sendStopTyping();
    
    await supabase.from('chat_messages').insert({ 
      chat_id: selectedChat.id, 
      message: newMessage.trim() || ' ', 
      sender_type: 'admin' as const,
      attachments: attachments.length > 0 ? JSON.parse(JSON.stringify(attachments)) : [],
    });
    
    setNewMessage('');
    setAttachments([]);
    setSending(false);
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

  const handleDeleteChat = async (chatId: string) => {
    setDeletingChatId(chatId);
    try {
      // First delete all messages in the chat
      await supabase.from('chat_messages').delete().eq('chat_id', chatId);
      
      // Then delete the chat
      const { error } = await supabase.from('support_chats').delete().eq('id', chatId);

      if (error) throw error;
      
      setChats(chats.filter(c => c.id !== chatId));
      
      if (selectedChat?.id === chatId) {
        setSelectedChat(null);
        setMessages([]);
      }
    } catch (error) {
      console.error('Error deleting chat:', error);
    } finally {
      setDeletingChatId(null);
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
    <DashboardLayout role="admin">
      <div className="h-[calc(100vh-8rem)] flex flex-col animate-slide-up">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-3xl font-bold">Сообщения поддержки</h1>
        </div>

        <div className="flex-1 flex gap-4 min-h-0">
          {/* Chat List */}
          <Card className="w-80 flex-shrink-0 flex flex-col">
            {/* Filter */}
            <div className="p-3 border-b">
              <div className="flex gap-2">
                <Select value={userTypeFilter} onValueChange={setUserTypeFilter}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Все сообщения" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все сообщения</SelectItem>
                    <SelectItem value="hr">От HR</SelectItem>
                    <SelectItem value="worker">От исполнителей</SelectItem>
                  </SelectContent>
                </Select>
                {hasActiveFilters && (
                  <Button variant="ghost" size="icon" onClick={resetFilters}>
                    <RotateCcw className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
            <CardContent className="p-0 flex-1 overflow-y-auto">
              {loading ? (
                <div className="p-4 space-y-2">
                  {[1, 2, 3].map(i => <div key={i} className="h-16 bg-muted animate-shimmer rounded-lg" />)}
                </div>
              ) : filteredChats.length > 0 ? (
                <div className="divide-y">
                  {filteredChats.map((chat) => (
                    <div key={chat.id} className="relative group">
                      <button 
                        onClick={() => selectChat(chat)} 
                        className={cn(
                          "w-full p-4 text-left hover:bg-muted/50 transition-colors", 
                          selectedChat?.id === chat.id && "bg-muted"
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <div className={cn(
                            "w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0", 
                            chat.user_type === 'hr' ? "bg-primary/20" : "bg-secondary/20"
                          )}>
                            <User className={cn("w-5 h-5", chat.user_type === 'hr' ? "text-primary" : "text-secondary")} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <p className="font-medium truncate">{chat.full_name || chat.email || 'Пользователь'}</p>
                              {chat.unread_count > 0 && (
                                <Badge className="bg-destructive text-destructive-foreground flex-shrink-0">
                                  {chat.unread_count}
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground truncate">
                              {chat.user_type === 'hr' ? chat.company || 'HR' : 'Исполнитель'}
                            </p>
                            {chat.request_id && (
                              <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                                <FileText className="w-3 h-3" />
                                <span>К заявке</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <button
                            className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 hover:bg-destructive/10 rounded"
                            disabled={deletingChatId === chat.id}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Удалить чат?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Это действие нельзя отменить. Чат и все сообщения будут удалены.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Отмена</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleDeleteChat(chat.id)}
                              className="bg-destructive hover:bg-destructive/90"
                            >
                              Удалить
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Mail className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">{hasActiveFilters ? 'Нет чатов по фильтру' : 'Нет чатов'}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Chat Area */}
          <Card className="flex-1 flex flex-col">
            {selectedChat ? (
              <>
                {/* Header */}
                <div className="p-4 border-b">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "w-10 h-10 rounded-full flex items-center justify-center", 
                      selectedChat.user_type === 'hr' ? "bg-primary/20" : "bg-secondary/20"
                    )}>
                      <User className={cn("w-5 h-5", selectedChat.user_type === 'hr' ? "text-primary" : "text-secondary")} />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium">{selectedChat.full_name || 'Пользователь'}</p>
                      <p className="text-sm text-muted-foreground">
                        {selectedChat.user_type === 'hr' ? `HR • ${selectedChat.company}` : 'Исполнитель'}
                      </p>
                    </div>
                  </div>
                  
                  {/* Linked Request Info */}
                  {linkedRequest && (
                    <div className="mt-3 p-3 bg-muted rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <FileText className="w-4 h-4 text-primary" />
                        <span className="text-sm font-medium">Связанная заявка</span>
                        {getStatusBadge(linkedRequest.status)}
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <HardHat className="w-3 h-3" />
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
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {messages.map((msg) => (
                    <div key={msg.id} className={cn("flex group", msg.sender_type === 'admin' ? "justify-end" : "justify-start")}>
                      <div className={cn(
                        "relative max-w-[70%]",
                        msg.sender_type === 'admin' ? "ml-auto" : "mr-auto"
                      )}>
                        <div className={cn(
                          "rounded-2xl px-4 py-2 break-words", 
                          msg.sender_type === 'admin' 
                            ? "bg-primary text-primary-foreground rounded-br-sm" 
                            : "bg-muted rounded-bl-sm"
                        )}>
                          {msg.message.trim() && (
                            <p className="text-sm whitespace-pre-wrap">{msg.message}</p>
                          )}
                          <MessageAttachments 
                            attachments={msg.attachments || []} 
                            isOwnMessage={msg.sender_type === 'admin'} 
                          />
                          <p className={cn(
                            "text-xs mt-1", 
                            msg.sender_type === 'admin' ? "text-primary-foreground/70" : "text-muted-foreground"
                          )}>
                            {format(new Date(msg.created_at), 'HH:mm')}
                          </p>
                        </div>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <button
                              className={cn(
                                "absolute top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-destructive/10 rounded",
                                msg.sender_type === 'admin' ? "-left-8" : "-right-8"
                              )}
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
                      </div>
                    </div>
                  ))}
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
                      placeholder="Написать ответ..." 
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
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
                <Mail className="w-12 h-12 mb-3 opacity-50" />
                <p>Выберите чат</p>
              </div>
            )}
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
};

// Import HardHat for the request info display
import { HardHat } from 'lucide-react';

export default AdminMessages;