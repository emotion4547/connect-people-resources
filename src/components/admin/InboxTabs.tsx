import React, { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Mail, MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

const tabClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors border',
    isActive
      ? 'bg-primary text-primary-foreground border-primary'
      : 'bg-card text-foreground hover:bg-muted border-border',
  );

export const InboxTabs: React.FC = () => {
  const [unreadContact, setUnreadContact] = useState(0);
  const [unreadChats, setUnreadChats] = useState(0);

  useEffect(() => {
    const load = async () => {
      const [{ count: c1 }, { data: chats }] = await Promise.all([
        supabase.from('contact_messages').select('id', { count: 'exact', head: true }).eq('is_read', false),
        supabase.from('support_chats').select('unread_count'),
      ]);
      setUnreadContact(c1 || 0);
      setUnreadChats((chats || []).reduce((sum, c: any) => sum + (c.unread_count || 0), 0));
    };
    load();
    const channel = supabase
      .channel('inbox-tabs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contact_messages' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_chats' }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  return (
    <div className="flex flex-wrap gap-2">
      <NavLink to="/admin/messages" className={tabClass} end>
        <Mail className="w-4 h-4" />
        Чаты поддержки
        {unreadChats > 0 && (
          <Badge variant="destructive" className="ml-1 h-5 px-1.5 text-xs">{unreadChats}</Badge>
        )}
      </NavLink>
      <NavLink to="/admin/contact-messages" className={tabClass} end>
        <MessageCircle className="w-4 h-4" />
        Контактные заявки
        {unreadContact > 0 && (
          <Badge variant="destructive" className="ml-1 h-5 px-1.5 text-xs">{unreadContact}</Badge>
        )}
      </NavLink>
    </div>
  );
};

export default InboxTabs;
