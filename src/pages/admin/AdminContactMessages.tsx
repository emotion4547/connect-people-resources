import React, { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { Mail, Eye, Trash2, Search, CheckCircle, Clock, RotateCcw } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';
import PageMeta from '@/components/PageMeta';
import { InboxTabs } from '@/components/admin/InboxTabs';

interface ContactMessage {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  subject: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

const AdminContactMessages: React.FC = () => {
  const { toast } = useToast();
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMessage, setSelectedMessage] = useState<ContactMessage | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRead, setFilterRead] = useState<'all' | 'read' | 'unread'>('all');

  useEffect(() => {
    fetchMessages();
  }, []);

  const fetchMessages = async () => {
    try {
      const { data, error } = await supabase
        .from('contact_messages')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setMessages(data || []);
    } catch (error) {
      console.error('Error fetching contact messages:', error);
      toast({
        title: 'Ошибка',
        description: 'Не удалось загрузить обращения',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async (id: string) => {
    try {
      const { error } = await supabase
        .from('contact_messages')
        .update({ is_read: true })
        .eq('id', id);

      if (error) throw error;
      setMessages(messages.map(m => m.id === id ? { ...m, is_read: true } : m));
    } catch (error) {
      console.error('Error marking as read:', error);
    }
  };

  const deleteMessage = async (id: string) => {
    try {
      const { error } = await supabase
        .from('contact_messages')
        .delete()
        .eq('id', id);

      if (error) throw error;
      setMessages(messages.filter(m => m.id !== id));
      setSelectedMessage(null);
      toast({
        title: 'Удалено',
        description: 'Обращение удалено',
      });
    } catch (error) {
      console.error('Error deleting message:', error);
      toast({
        title: 'Ошибка',
        description: 'Не удалось удалить обращение',
        variant: 'destructive',
      });
    }
  };

  const openMessage = async (message: ContactMessage) => {
    setSelectedMessage(message);
    if (!message.is_read) {
      await markAsRead(message.id);
    }
  };

  const filteredMessages = messages.filter(m => {
    const matchesSearch = 
      m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.message.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesFilter = 
      filterRead === 'all' || 
      (filterRead === 'read' && m.is_read) || 
      (filterRead === 'unread' && !m.is_read);

    return matchesSearch && matchesFilter;
  });

  const unreadCount = messages.filter(m => !m.is_read).length;

  return (
    <DashboardLayout role="admin">
      <PageMeta title="Обращения" description="Просмотр обращений с формы обратной связи" />
      
      <div className="space-y-6 animate-slide-up">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold">Входящие</h1>
              <p className="text-muted-foreground">Сообщения с формы обратной связи</p>
            </div>
            {unreadCount > 0 && (
              <Badge className="bg-destructive text-destructive-foreground">
                {unreadCount} непрочитанных
              </Badge>
            )}
          </div>
          <InboxTabs />
        </div>



        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row gap-4 justify-between">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Поиск по обращениям..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant={filterRead === 'all' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFilterRead('all')}
                >
                  Все
                </Button>
                <Button
                  variant={filterRead === 'unread' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFilterRead('unread')}
                >
                  <Clock className="w-4 h-4 mr-1" />
                  Новые
                </Button>
                <Button
                  variant={filterRead === 'read' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFilterRead('read')}
                >
                  <CheckCircle className="w-4 h-4 mr-1" />
                  Прочитанные
                </Button>
                {(searchQuery || filterRead !== 'all') && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setSearchQuery(''); setFilterRead('all'); }}
                  >
                    <RotateCcw className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
                ))}
              </div>
            ) : filteredMessages.length > 0 ? (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12"></TableHead>
                      <TableHead>Имя</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Тема</TableHead>
                      <TableHead>Дата</TableHead>
                      <TableHead className="w-24">Действия</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredMessages.map((message) => (
                      <TableRow 
                        key={message.id} 
                        className={!message.is_read ? 'bg-primary/5' : ''}
                      >
                        <TableCell>
                          {!message.is_read && (
                            <div className="w-2 h-2 bg-primary rounded-full" />
                          )}
                        </TableCell>
                        <TableCell className="font-medium">{message.name}</TableCell>
                        <TableCell className="text-muted-foreground">{message.email}</TableCell>
                        <TableCell>{message.subject}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {format(new Date(message.created_at), 'd MMM yyyy, HH:mm', { locale: ru })}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openMessage(message)}
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => deleteMessage(message.id)}
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <Mail className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="font-medium">Нет обращений</p>
                <p className="text-sm">
                  {searchQuery || filterRead !== 'all' 
                    ? 'Попробуйте изменить параметры поиска' 
                    : 'Обращения с формы обратной связи появятся здесь'}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Message Detail Dialog */}
      <Dialog open={!!selectedMessage} onOpenChange={() => setSelectedMessage(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Обращение от {selectedMessage?.name}</DialogTitle>
          </DialogHeader>
          {selectedMessage && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Email</p>
                  <a 
                    href={`mailto:${selectedMessage.email}`} 
                    className="text-primary hover:underline"
                  >
                    {selectedMessage.email}
                  </a>
                </div>
                {selectedMessage.phone && (
                  <div>
                    <p className="text-muted-foreground">Телефон</p>
                    <a 
                      href={`tel:${selectedMessage.phone}`} 
                      className="text-primary hover:underline"
                    >
                      {selectedMessage.phone}
                    </a>
                  </div>
                )}
                <div>
                  <p className="text-muted-foreground">Тема</p>
                  <p className="font-medium">{selectedMessage.subject}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Дата</p>
                  <p>{format(new Date(selectedMessage.created_at), 'd MMMM yyyy, HH:mm', { locale: ru })}</p>
                </div>
              </div>
              
              <div>
                <p className="text-muted-foreground mb-2">Сообщение</p>
                <div className="bg-muted p-4 rounded-lg whitespace-pre-wrap">
                  {selectedMessage.message}
                </div>
              </div>

              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  onClick={() => setSelectedMessage(null)}
                >
                  Закрыть
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => deleteMessage(selectedMessage.id)}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Удалить
                </Button>
                <Button
                  onClick={() => window.location.href = `mailto:${selectedMessage.email}`}
                >
                  <Mail className="w-4 h-4 mr-2" />
                  Ответить
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default AdminContactMessages;
