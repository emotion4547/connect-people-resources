import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useOrg } from '@/contexts/OrgContext';
import { db, rpc } from '@/lib/db';
import { enablePush, pushSupported } from '@/lib/push';
import { fmtDateTime } from '@/lib/timesheetsMeta';
import PageMeta from '@/components/PageMeta';

interface Item { id: string; event: string; title: string; body: string | null; link: string | null; is_read: boolean; created_at: string }
interface EventDef { code: string; title: string; critical: boolean; audience: string }
interface Contact { id: string; channel: string; address: string }

const Notifications: React.FC = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { orgId } = useOrg();
  const { role } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [events, setEvents] = useState<EventDef[]>([]);
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [maxId, setMaxId] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(true);

  const layoutRole = role === 'worker' ? 'worker' : role === 'hr' || role === 'client_admin' || role === 'client_manager' ? 'hr' : role === 'admin' ? 'admin' : 'staff';

  const load = useCallback(async () => {
    const [n, e, p, c] = await Promise.all([
      db('notifications').select('*').order('created_at', { ascending: false }).limit(100),
      db('notification_events').select('code,title,critical,audience').order('title'),
      db('notification_prefs').select('event,enabled'),
      db('notification_contacts').select('id,channel,address').eq('is_active', true),
    ]);
    setLoading(false);
    setItems(n.data ?? []); setEvents(e.data ?? []);
    setPrefs(Object.fromEntries((p.data ?? []).map((x: { event: string; enabled: boolean }) => [x.event, x.enabled])));
    setContacts(c.data ?? []);
    setMaxId((c.data ?? []).find((x: Contact) => x.channel === 'max')?.address ?? '');
    setPhone((c.data ?? []).find((x: Contact) => x.channel === 'sms')?.address ?? '');
  }, []);

  useEffect(() => { load(); }, [load]);

  const open = async (it: Item) => {
    if (!it.is_read) await rpc('mark_notifications_read', { _ids: [it.id] });
    if (it.link) navigate(it.link); else load();
  };

  const readAll = async () => { await rpc('mark_notifications_read', {}); load(); };

  const toggle = async (code: string, enabled: boolean) => {
    setPrefs((p) => ({ ...p, [code]: enabled }));
    const { error } = await db('notification_prefs').upsert({ event: code, enabled }, { onConflict: 'user_id,event' });
    if (error) { toast({ title: 'Не сохранено', description: error.message, variant: 'destructive' }); load(); }
  };

  const saveContact = async (channel: 'max' | 'sms', value: string) => {
    if (!orgId) return;
    const old = contacts.find((c) => c.channel === channel);
    if (old && old.address === value.trim()) return;
    if (old) await db('notification_contacts').delete().eq('id', old.id);
    if (value.trim()) {
      const { error } = await db('notification_contacts').insert({ org_id: orgId, channel, address: value.trim() });
      if (error) { toast({ title: 'Не сохранено', description: error.message, variant: 'destructive' }); return; }
    }
    toast({ title: 'Сохранено' });
    load();
  };

  const push = async () => {
    if (!orgId) return;
    try { await enablePush(orgId); toast({ title: 'Уведомления в браузере включены' }); load(); }
    catch (e) { toast({ title: 'Не получилось', description: (e as Error).message, variant: 'destructive' }); }
  };

  return (
    <DashboardLayout role={layoutRole}>
      <PageMeta title="Уведомления" description="Лента уведомлений и настройки" />
      <div className="max-w-2xl mx-auto space-y-4 animate-slide-up">
        <h1 className="text-2xl font-bold">Уведомления</h1>
        <Tabs defaultValue="feed">
          <TabsList><TabsTrigger value="feed">Лента</TabsTrigger><TabsTrigger value="settings">Настройки</TabsTrigger></TabsList>
          <TabsContent value="feed" className="space-y-3">
            {items.some((i) => !i.is_read) && <Button variant="outline" size="sm" onClick={readAll}>Отметить всё прочитанным</Button>}
            {loading ? <p className="text-muted-foreground">Загрузка…</p> : items.map((it) => (
              <button key={it.id} type="button" onClick={() => open(it)} className="block w-full text-left">
                <Card className={it.is_read ? '' : 'border-primary'}>
                  <CardContent className="pt-4 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{it.title}</span>
                      {!it.is_read && <Badge>новое</Badge>}
                    </div>
                    {it.body && <p className="text-sm text-muted-foreground">{it.body}</p>}
                    <p className="text-xs text-muted-foreground">{fmtDateTime(it.created_at)}</p>
                  </CardContent>
                </Card>
              </button>
            ))}
            {!loading && !items.length && <p className="text-muted-foreground">Уведомлений пока нет.</p>}
          </TabsContent>
          <TabsContent value="settings" className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Куда присылать</CardTitle><CardDescription>В ленту системы уведомления приходят всегда. Дополнительно можно получать их вне системы.</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                <div><Label htmlFor="n-max">MAX (идентификатор диалога с ботом)</Label>
                  <Input id="n-max" value={maxId} onChange={(e) => setMaxId(e.target.value)} onBlur={() => saveContact('max', maxId)} placeholder="Напишите боту — менеджер подскажет номер" /></div>
                <div><Label htmlFor="n-sms">Телефон для SMS</Label>
                  <Input id="n-sms" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={() => saveContact('sms', phone)} placeholder="+7…" /></div>
                {pushSupported() ? (
                  <Button variant="outline" onClick={push} disabled={contacts.some((c) => c.channel === 'push')}>
                    {contacts.some((c) => c.channel === 'push') ? 'Уведомления в браузере включены' : 'Включить уведомления в браузере'}
                  </Button>
                ) : <p className="text-xs text-muted-foreground">Уведомления в браузере недоступны на этом устройстве.</p>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Какие события нужны</CardTitle><CardDescription>Важные (замены, табель, МВД) отключить нельзя.</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                {events.map((e) => (
                  <div key={e.code} className="flex items-center justify-between gap-3">
                    <div><div className="text-sm font-medium">{e.title}</div><div className="text-xs text-muted-foreground">{e.audience}</div></div>
                    {e.critical ? <Badge variant="secondary">всегда</Badge> : (
                      <Switch checked={prefs[e.code] ?? true} onCheckedChange={(v) => toggle(e.code, v)} aria-label={e.title} />
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
};

export default Notifications;
