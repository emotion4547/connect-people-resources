import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useOrg } from '@/contexts/OrgContext';
import { db } from '@/lib/db';
import { fmtDate, today } from '@/lib/format';
import { STAGE_LABELS, daysSince } from '@/lib/hiringMeta';
import PageMeta from '@/components/PageMeta';

interface Cand { id: string; full_name: string; phone: string | null; stage: string; next_contact_at: string | null; next_contact_note: string | null; stage_changed_at: string }
interface Task { id: string; title: string; due_date: string; kind: string }

// «Мой день» рекрутера (Н-4): кому позвонить сегодня, просроченные касания, застрявшие кандидаты, задачи.
const HiringToday: React.FC = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const { orgId } = useOrg();
  const [cands, setCands] = useState<Cand[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);

  const load = useCallback(async () => {
    if (!orgId) return;
    const [c, t] = await Promise.all([
      db('candidates').select('id,full_name,phone,stage,next_contact_at,next_contact_note,stage_changed_at')
        .eq('org_id', orgId).not('stage', 'in', '(admitted,rejected,reserve)').limit(1000),
      db('staff_tasks').select('id,title,due_date,kind').eq('org_id', orgId).is('done_at', null).order('due_date').limit(200),
    ]);
    if (c.error) { toast({ title: 'Не удалось загрузить данные', description: c.error.message, variant: 'destructive' }); return; }
    setCands(c.data ?? []); setTasks(t.data ?? []);
  }, [orgId, toast]);

  useEffect(() => { load(); }, [load]);

  const done = async (id: string) => {
    const { error } = await db('staff_tasks').update({ done_at: new Date().toISOString(), done_by: user?.id }).eq('id', id);
    if (error) toast({ title: 'Не удалось отметить', description: error.message, variant: 'destructive' }); else load();
  };

  const now = Date.now();
  const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999);
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const overdue = cands.filter((c) => c.next_contact_at && new Date(c.next_contact_at).getTime() < startOfToday.getTime());
  const todayList = cands.filter((c) => c.next_contact_at && new Date(c.next_contact_at).getTime() >= startOfToday.getTime() && new Date(c.next_contact_at).getTime() <= endOfToday.getTime());
  const stuck = cands.filter((c) => daysSince(c.stage_changed_at) > 3 && !(c.next_contact_at && new Date(c.next_contact_at).getTime() > now));

  const list = (items: Cand[], empty: string) => items.length ? (
    <ul className="space-y-2 text-sm">
      {items.map((c) => (
        <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <Link to={`/candidates/${c.id}`} className="font-medium hover:underline">{c.full_name}</Link>
            <span className="text-muted-foreground"> · {STAGE_LABELS[c.stage]} · {c.phone ?? 'без телефона'}</span>
            {c.next_contact_note && <div className="text-muted-foreground">{c.next_contact_note}</div>}
          </div>
          {c.next_contact_at && <Badge variant="outline">{fmtDate(c.next_contact_at.slice(0, 10))}</Badge>}
        </li>
      ))}
    </ul>
  ) : <p className="text-sm text-muted-foreground">{empty}</p>;

  return (
    <AppLayout>
      <PageMeta title="Мой день" description="Что сделать сегодня в найме" />
      <div className="max-w-4xl mx-auto space-y-6 animate-slide-up">
        <div><h1 className="text-3xl font-bold mb-2">Мой день</h1><p className="text-muted-foreground">Кому позвонить, что просрочено и какие задачи ждут.</p></div>
        <Card><CardHeader><CardTitle className="text-lg">Позвонить сегодня ({todayList.length})</CardTitle></CardHeader><CardContent>{list(todayList, 'На сегодня касаний не запланировано.')}</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-lg text-destructive">Просроченные касания ({overdue.length})</CardTitle></CardHeader><CardContent>{list(overdue, 'Просрочек нет.')}</CardContent></Card>
        <Card>
          <CardHeader><CardTitle className="text-lg">Без движения больше 3 дней ({stuck.length})</CardTitle><CardDescription>Нет запланированного следующего шага.</CardDescription></CardHeader>
          <CardContent>{list(stuck, 'Все кандидаты в движении.')}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-lg">Задачи ({tasks.length})</CardTitle><CardDescription>Уведомления МВД, сроки документов и налога по патенту.</CardDescription></CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {tasks.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{t.title}</span>
                  <span className="flex items-center gap-2">
                    <Badge variant={t.due_date < today() ? 'destructive' : 'outline'}>до {fmtDate(t.due_date)}</Badge>
                    <Button size="sm" variant="outline" onClick={() => done(t.id)}>Выполнено</Button>
                  </span>
                </li>
              ))}
              {!tasks.length && <li className="text-muted-foreground">Открытых задач нет.</li>}
            </ul>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default HiringToday;
