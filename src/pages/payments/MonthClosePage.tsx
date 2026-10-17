import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useOrg } from '@/contexts/OrgContext';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { db, rpc } from '@/lib/db';
import PageMeta from '@/components/PageMeta';
import { CheckCircle2, Lock } from 'lucide-react';

interface Blocker { severity: 'block' | 'warn'; code: string; title: string; cnt: number; link: string }
interface Lock { month: string; is_closed: boolean; closed_at: string | null; reopen_reason: string | null }

const prevMonth = () => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
};

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const label = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

const MonthClosePage: React.FC = () => {
  const { toast } = useToast();
  const { orgId } = useOrg();
  const { role } = useAuth();
  const { can } = usePermissions();
  const [month, setMonth] = useState(prevMonth());
  const [blockers, setBlockers] = useState<Blocker[]>([]);
  const [locks, setLocks] = useState<Lock[]>([]);
  const [busy, setBusy] = useState(false);
  const [reopen, setReopen] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    if (!orgId) return;
    const [b, l] = await Promise.all([
      rpc('month_close_blockers', { _org_id: orgId, _month: `${month}-01` }),
      db('period_locks').select('month,is_closed,closed_at,reopen_reason').eq('org_id', orgId).order('month', { ascending: false }),
    ]);
    if (b.error) toast({ title: 'Не удалось проверить месяц', description: b.error.message, variant: 'destructive' });
    setBlockers(b.data ?? []); setLocks(l.data ?? []);
  }, [orgId, month, toast]);

  useEffect(() => { load(); }, [load]);

  const run = async (fn: string, args: Record<string, unknown>, ok: string) => {
    setBusy(true);
    const { error } = await rpc(fn, args);
    setBusy(false);
    if (error) { toast({ title: 'Не получилось', description: error.message, variant: 'destructive' }); return false; }
    toast({ title: ok });
    await load();
    return true;
  };

  const closed = locks.find((l) => l.month.startsWith(month) && l.is_closed);
  const hard = blockers.filter((b) => b.severity === 'block');

  return (
    <AppLayout>
      <PageMeta title="Закрытие месяца" description="Проверка и закрытие периода" />
      <div className="max-w-3xl mx-auto space-y-6 animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold mb-2">Закрытие месяца</h1>
          <p className="text-muted-foreground">Закрытый месяц только читается: табель, часы и начисления в нём не меняются, поправки идут корректировкой в текущем периоде.</p>
        </div>
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="text-lg capitalize">{label(month)}</CardTitle>
              <Input type="month" className="w-44" max={prevMonth()} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Месяц" />
            </div>
            <CardDescription>Система показывает, что мешает закрыть месяц.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {closed ? (
              <p className="flex items-center gap-2"><Lock className="w-4 h-4" /> Месяц закрыт.</p>
            ) : blockers.length === 0 ? (
              <p className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-600" /> Мешающих дел нет, месяц можно закрывать.</p>
            ) : blockers.map((b) => (
              <div key={b.code} className="flex items-center justify-between gap-3 rounded-md border p-3">
                <div>
                  <Badge variant={b.severity === 'block' ? 'destructive' : 'secondary'}>{b.severity === 'block' ? 'мешает' : 'внимание'}</Badge>
                  <span className="ml-2">{b.title}: {b.cnt}</span>
                </div>
                <Button asChild size="sm" variant="outline"><Link to={b.link}>Открыть</Link></Button>
              </div>
            ))}
            {!closed && can('client_documents', 'update') && (
              <Button disabled={busy || hard.length > 0} onClick={() => orgId && run('close_month', { _org_id: orgId, _month: `${month}-01` }, 'Месяц закрыт')}>Закрыть месяц</Button>
            )}
          </CardContent>
        </Card>
        {locks.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">Закрытые месяцы</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {locks.map((l) => (
                <div key={l.month} className="flex items-center justify-between gap-3">
                  <span className="capitalize">{label(l.month.slice(0, 7))}</span>
                  {l.is_closed ? (
                    role === 'director' ? <Button size="sm" variant="outline" onClick={() => { setReopen(l.month); setReason(''); }}>Открыть</Button> : <Badge variant="secondary">закрыт</Badge>
                  ) : <span className="text-sm text-muted-foreground">открыт: {l.reopen_reason}</span>}
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={!!reopen} onOpenChange={(o) => !o && setReopen(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Открыть закрытый месяц</DialogTitle><DialogDescription>Действие попадёт в журнал с причиной. После правок месяц закрывают заново.</DialogDescription></DialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReopen(null)}>Отмена</Button>
            <Button disabled={busy || !reason.trim()} onClick={async () => { if (orgId && reopen && await run('reopen_month', { _org_id: orgId, _month: reopen, _reason: reason }, 'Месяц открыт')) setReopen(null); }}>Открыть</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default MonthClosePage;
