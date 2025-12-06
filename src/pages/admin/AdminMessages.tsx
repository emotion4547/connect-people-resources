import React, { useEffect, useState, useRef } from 'react';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { Send, Mail, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface Chat {
  id: string;
  user_id: string;
  user_type: 'hr' | 'worker';
  unread_count: number;
  full_name?: string;
  company?: string;
  email?: string;
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
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  const selectChat = async (chat: Chat) => {
    setSelectedChat(chat);
    const { data } = await supabase.from('chat_messages').select('*').eq('chat_id', chat.id).order('created_at', { ascending: true });
    setMessages(data || []);
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !selectedChat) return;
    setSending(true);
    await supabase.from('chat_messages').insert({ chat_id: selectedChat.id, message: newMessage.trim(), sender_type: 'admin' });
    setNewMessage('');
    setSending(false);
  };

  return (
    <DashboardLayout role="admin">
      <div className="h-[calc(100vh-8rem)] flex flex-col animate-slide-up">
        <h1 className="text-3xl font-bold mb-4">Сообщения поддержки</h1>
        <div className="flex-1 flex gap-4 min-h-0">
          <Card className="w-80 flex-shrink-0 flex flex-col">
            <CardContent className="p-0 flex-1 overflow-y-auto">
              {loading ? <div className="p-4 space-y-2">{[1,2,3].map(i => <div key={i} className="h-16 bg-muted animate-shimmer rounded-lg" />)}</div> : chats.length > 0 ? (
                <div className="divide-y">{chats.map((chat) => (
                  <button key={chat.id} onClick={() => selectChat(chat)} className={cn("w-full p-4 text-left hover:bg-muted/50", selectedChat?.id === chat.id && "bg-muted")}>
                    <div className="flex items-start gap-3">
                      <div className={cn("w-10 h-10 rounded-full flex items-center justify-center", chat.user_type === 'hr' ? "bg-primary/20" : "bg-secondary/20")}>
                        <User className={cn("w-5 h-5", chat.user_type === 'hr' ? "text-primary" : "text-secondary")} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className="font-medium truncate">{chat.full_name || chat.email || 'Пользователь'}</p>
                          {chat.unread_count > 0 && <Badge className="bg-destructive text-destructive-foreground">{chat.unread_count}</Badge>}
                        </div>
                        <p className="text-sm text-muted-foreground truncate">{chat.user_type === 'hr' ? chat.company : 'Исполнитель'}</p>
                      </div>
                    </div>
                  </button>
                ))}</div>
              ) : <div className="text-center py-8 text-muted-foreground"><Mail className="w-8 h-8 mx-auto mb-2 opacity-50" /><p className="text-sm">Нет чатов</p></div>}
            </CardContent>
          </Card>
          <Card className="flex-1 flex flex-col">
            {selectedChat ? (
              <>
                <div className="p-4 border-b flex items-center gap-3">
                  <div className={cn("w-10 h-10 rounded-full flex items-center justify-center", selectedChat.user_type === 'hr' ? "bg-primary/20" : "bg-secondary/20")}>
                    <User className={cn("w-5 h-5", selectedChat.user_type === 'hr' ? "text-primary" : "text-secondary")} />
                  </div>
                  <div><p className="font-medium">{selectedChat.full_name || 'Пользователь'}</p><p className="text-sm text-muted-foreground">{selectedChat.user_type === 'hr' ? `HR • ${selectedChat.company}` : 'Исполнитель'}</p></div>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {messages.map((msg) => (
                    <div key={msg.id} className={cn("flex", msg.sender_type === 'admin' ? "justify-end" : "justify-start")}>
                      <div className={cn("max-w-[70%] rounded-2xl px-4 py-2", msg.sender_type === 'admin' ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-muted rounded-bl-sm")}>
                        <p className="text-sm">{msg.message}</p>
                        <p className={cn("text-xs mt-1", msg.sender_type === 'admin' ? "text-primary-foreground/70" : "text-muted-foreground")}>{format(new Date(msg.created_at), 'HH:mm')}</p>
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
                <form onSubmit={sendMessage} className="p-4 border-t flex gap-2">
                  <Input placeholder="Написать ответ..." value={newMessage} onChange={(e) => setNewMessage(e.target.value)} disabled={sending} className="flex-1" />
                  <Button type="submit" disabled={!newMessage.trim() || sending}><Send className="w-4 h-4" /></Button>
                </form>
              </>
            ) : <div className="flex-1 flex items-center justify-center text-muted-foreground"><Mail className="w-12 h-12 mx-auto mb-3 opacity-50" /><p>Выберите чат</p></div>}
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default AdminMessages;
