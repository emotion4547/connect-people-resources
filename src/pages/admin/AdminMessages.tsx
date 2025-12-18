import React, { useEffect, useState, useRef, useMemo } from 'react';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { Send, Mail, User, FileText, MapPin, Calendar, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import PageMeta from '@/components/PageMeta';

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
}

const AdminMessages: React.FC = () => {
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [linkedRequest, setLinkedRequest] = useState<Request | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Filters
  const [userTypeFilter, setUserTypeFilter] = useState<string>('all');

  useEffect(() => { fetchChats(); }, []);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  useEffect(() => {
    if (!selectedChat) return;
    const channel = supabase.channel(`admin-chat-${selectedChat.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `chat_id=eq.${selectedChat.id}` },
        (payload) => setMessages((prev) => [...prev, payload.new as Message]))
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
    
    const { data } = await supabase.from('chat_messages').select('*').eq('chat_id', chat.id).order('created_at', { ascending: true });
    setMessages(data || []);

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
    if (!newMessage.trim() || !selectedChat) return;
    setSending(true);
    await supabase.from('chat_messages').insert({ chat_id: selectedChat.id, message: newMessage.trim(), sender_type: 'admin' });
    setNewMessage('');
    setSending(false);
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
      <PageMeta title="Сообщения" description="Управление чатами поддержки" />
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
                    <button 
                      key={chat.id} 
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
                    <div key={msg.id} className={cn("flex", msg.sender_type === 'admin' ? "justify-end" : "justify-start")}>
                      <div className={cn(
                        "max-w-[70%] rounded-2xl px-4 py-2", 
                        msg.sender_type === 'admin' 
                          ? "bg-primary text-primary-foreground rounded-br-sm" 
                          : "bg-muted rounded-bl-sm"
                      )}>
                        <p className="text-sm">{msg.message}</p>
                        <p className={cn(
                          "text-xs mt-1", 
                          msg.sender_type === 'admin' ? "text-primary-foreground/70" : "text-muted-foreground"
                        )}>
                          {format(new Date(msg.created_at), 'HH:mm')}
                        </p>
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>

                {/* Input */}
                <form onSubmit={sendMessage} className="p-4 border-t flex gap-2">
                  <Input 
                    placeholder="Написать ответ..." 
                    value={newMessage} 
                    onChange={(e) => setNewMessage(e.target.value)} 
                    disabled={sending} 
                    className="flex-1" 
                  />
                  <Button type="submit" disabled={!newMessage.trim() || sending}>
                    <Send className="w-4 h-4" />
                  </Button>
                </form>
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