import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { db, rpc } from '@/lib/db';
import { fmtDate, fmtMoney } from '@/lib/format';
import { DEAL_STAGES, LOST_REASONS, SOURCES, TOUCH_KINDS, stageLabel, type Deal, type Quote, type QuoteLine } from '@/lib/dealMeta';
import PageMeta from '@/components/PageMeta';
import { Plus, Trash2 } from 'lucide-react';

interface Touch { id: string; kind: string; title: string; note: string | null; due_at: string; done_at: string | null }
interface Need { id: string; position_id: string; headcount: number; hours_per_month: number }
interface Pos { id: string; name: string }
interface Margin { status: string; margin: number; margin_pct: number | null }

const TAX_NAMES: Record<string, string> = { ip: 'ИП', self_employed: 'Самозанятый', gph: 'ГПХ', employment: 'Трудовой' };

// С-1, С-3, С-4, С-6: карточка сделки — потребность, касания и задачи, версии КП, выигрыш и отказ.
const DealDetail: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { role } = useAuth();
  const { toast } = useToast();
  const [deal, setDeal] = useState<Deal | null>(null);
  const [touches, setTouches] = useState<Touch[]>([]);
  const [needs, setNeeds] = useState<Need[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [positions, setPositions] = useState<Pos[]>([]);
  const [owners, setOwners] = useState<{ user_id: string; full_name: string }[]>([]);
  const [edit, setEdit] = useState<Partial<Deal>>({});
  const [touch, setTouch] = useState({ kind: 'call', title: '', due: new Date().toISOString().slice(0, 16), done: false });
  const [needDraft, setNeedDraft] = useState({ position_id: '', headcount: '1', hours: '0' });
  const [lines, setLines] = useState<{ position_id: string; client_rate: string; worker_rate: string; headcount: string; hours: string }[] | null>(null);
  const [margins, setMargins] = useState<Record<number, Margin[]>>({});
  const [lostOpen, setLostOpen] = useState(params.get('lost') === '1');
  const [lostReason, setLostReason] = useState(LOST_REASONS[0]);
  const closed = deal ? ['won', 'lost'].includes(deal.stage) : false;

  const load = useCallback(async () => {
    if (!id) return;
    const [d, t, n, q, p, o] = await Promise.all([
      db('deals').select('*').eq('id', id).maybeSingle(),
      db('deal_touches').select('*').eq('deal_id', id).order('due_at', { ascending: false }),
      db('deal_needs').select('*').eq('deal_id', id),
      db('deal_quotes').select('*').eq('deal_id', id).order('version', { ascending: false }),
      db('positions').select('id,name').order('name'),
      db('staff_profiles').select('user_id, full_name'),
    ]);
    if (!d.data) { toast({ title: 'Сделка не найдена или недоступна', variant: 'destructive' }); navigate('/deals'); return; }
    setDeal({ ...(d.data as Deal), expected_revenue: Number(d.data.expected_revenue), expected_margin: Number(d.data.expected_margin) });
    setTouches((t.data ?? []) as Touch[]); setNeeds((n.data ?? []) as Need[]); setQuotes((q.data ?? []) as Quote[]);
    setPositions((p.data ?? []) as Pos[]); setOwners((o.data ?? []) as { user_id: string; full_name: string }[]);
    setEdit({});
  }, [id, navigate, toast]);

  useEffect(() => { load(); }, [load]);

  const posName = (pid: string) => positions.find((p) => p.id === pid)?.name ?? '—';
  const val = <K extends keyof Deal>(k: K): Deal[K] | '' => (k in edit ? (edit[k] as Deal[K]) : (deal?.[k] ?? ''));
  const run = async (fn: string, args: Record<string, unknown>, ok?: string) => {
    const { data, error } = await rpc(fn, args);
    if (error) { toast({ title: 'Не получилось', description: error.message, variant: 'destructive' }); return null; }
    if (ok) toast({ title: ok });
    await load();
    return data;
  };

  const save = async () => {
    if (!deal || !Object.keys(edit).length) return;
    const { error } = await db('deals').update(edit).eq('id', deal.id);
    if (error) { toast({ title: 'Не удалось сохранить', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Сохранено' }); load();
  };

  const addTouch = async () => {
    if (!deal || !touch.title.trim()) return;
    await run('add_deal_touch', { _deal_id: deal.id, _kind: touch.kind, _title: touch.title.trim(), _due_at: new Date(touch.due).toISOString(), _done: touch.done });
    setTouch({ ...touch, title: '' });
  };

  const addNeed = async () => {
    if (!deal || !needDraft.position_id) return;
    const { error } = await db('deal_needs').upsert({ org_id: deal.org_id, deal_id: deal.id, position_id: needDraft.position_id, headcount: Number(needDraft.headcount), hours_per_month: Number(needDraft.hours) }, { onConflict: 'deal_id,position_id' });
    if (error) { toast({ title: 'Не удалось добавить', description: error.message, variant: 'destructive' }); return; }
    setNeedDraft({ position_id: '', headcount: '1', hours: '0' }); load();
  };

  const startQuote = () => setLines(needs.length
    ? needs.map((n) => ({ position_id: n.position_id, client_rate: '', worker_rate: '', headcount: String(n.headcount), hours: String(n.hours_per_month) }))
    : [{ position_id: '', client_rate: '', worker_rate: '', headcount: '1', hours: '0' }]);

  // Маржа по ставкам для разных форм найма: считает сервер по актуальным налоговым ставкам.
  const loadMargin = async (i: number) => {
    const l = lines?.[i];
    if (!l || !deal || !Number(l.client_rate) || !Number(l.worker_rate)) return;
    const { data } = await rpc('calc_margins', { _org_id: deal.org_id, _client_rate: Number(l.client_rate), _worker_rate: Number(l.worker_rate) });
    setMargins((m) => ({ ...m, [i]: (data ?? []) as Margin[] }));
  };

  const saveQuote = async () => {
    if (!deal || !lines) return;
    const payload = lines.filter((l) => l.position_id).map((l) => ({ position_id: l.position_id, unit: 'hour', client_rate: Number(l.client_rate), worker_rate: Number(l.worker_rate), headcount: Number(l.headcount || 1), hours_per_month: Number(l.hours || 0) }));
    const r = await run('create_deal_quote', { _deal_id: deal.id, _lines: payload, _valid_until: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10) }, 'КП создано');
    if (r) setLines(null);
  };

  const sendQuote = async (q: Quote) => {
    const to = deal?.contact_email ?? '';
    const email = window.prompt('Адрес получателя КП', to);
    if (!email) return;
    await run('mark_quote_sent', { _quote_id: q.id, _sent_to: email }, 'Отмечено как отправленное');
    window.location.href = `mailto:${email}?subject=${encodeURIComponent(`Коммерческое предложение, версия ${q.version}`)}&body=${encodeURIComponent('Добрый день! Направляем коммерческое предложение во вложении.')}`;
  };

  const win = async (q?: Quote) => {
    const n = await run('win_deal', { _deal_id: deal!.id, _quote_id: q?.id ?? null });
    if (n !== null) toast({ title: 'Сделка выиграна', description: `Создано черновиков тарифов: ${n}. Согласуйте их на странице заказчика.` });
  };

  const total = useMemo(() => quotes[0]?.lines.reduce((s, l) => s + l.client_rate * l.hours_per_month, 0) ?? 0, [quotes]);
  if (!deal) return <AppLayout><p className="p-6">Загрузка…</p></AppLayout>;

  return (
    <AppLayout>
      <PageMeta title={deal.title} description="Карточка сделки" />
      <div className="max-w-5xl mx-auto space-y-6 animate-slide-up">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Button asChild variant="link" className="px-0"><Link to="/deals">← Все сделки</Link></Button>
            <h1 className="text-3xl font-bold">{deal.title}</h1>
            <div className="flex flex-wrap gap-2 mt-2"><Badge>{stageLabel(deal.stage)}</Badge><Badge variant="outline">{SOURCES[deal.source]}</Badge>
              {deal.client_id && <Badge variant="secondary"><Link to={`/clients/${deal.client_id}`}>Заказчик в системе</Link></Badge>}</div>
            {deal.lost_reason && <p className="text-sm text-destructive mt-2">Причина отказа: {deal.lost_reason}</p>}
          </div>
          {!closed && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => win(quotes[0])}>Выиграна</Button>
              <Button variant="outline" onClick={() => setLostOpen(true)}>Проиграна</Button>
            </div>
          )}
        </div>

        <Card><CardHeader><CardTitle className="text-lg">Сделка</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2">
          <div><Label htmlFor="f-company">Компания</Label><Input id="f-company" disabled={closed} value={val('company') as string} onChange={(e) => setEdit({ ...edit, company: e.target.value })} /></div>
          <div><Label htmlFor="f-name">Контакт</Label><Input id="f-name" disabled={closed} value={val('contact_name') as string} onChange={(e) => setEdit({ ...edit, contact_name: e.target.value })} /></div>
          <div><Label htmlFor="f-phone">Телефон</Label><Input id="f-phone" disabled={closed} value={val('contact_phone') as string} onChange={(e) => setEdit({ ...edit, contact_phone: e.target.value })} /></div>
          <div><Label htmlFor="f-email">Почта</Label><Input id="f-email" type="email" disabled={closed} value={val('contact_email') as string} onChange={(e) => setEdit({ ...edit, contact_email: e.target.value })} /></div>
          <div><Label htmlFor="f-rev">Выручка в месяц, ₽</Label><Input id="f-rev" inputMode="decimal" disabled={closed} value={String(val('expected_revenue'))} onChange={(e) => setEdit({ ...edit, expected_revenue: Number(e.target.value) })} /></div>
          <div><Label htmlFor="f-mar">Маржа в месяц, ₽</Label><Input id="f-mar" inputMode="decimal" disabled={closed} value={String(val('expected_margin'))} onChange={(e) => setEdit({ ...edit, expected_margin: Number(e.target.value) })} /></div>
          <div><Label htmlFor="f-step">Следующий шаг</Label><Input id="f-step" disabled={closed} value={val('next_step') as string} onChange={(e) => setEdit({ ...edit, next_step: e.target.value })} /></div>
          <div><Label htmlFor="f-date">Дата шага</Label><Input id="f-date" type="date" disabled={closed} value={val('next_step_date') as string} onChange={(e) => setEdit({ ...edit, next_step_date: e.target.value || null })} /></div>
          <div className="sm:col-span-2"><Label htmlFor="f-note">Заметка</Label><Textarea id="f-note" disabled={closed} value={val('note') as string} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></div>
          <div className="flex flex-wrap items-end gap-3 sm:col-span-2">
            {!closed && (
              <div><Label>Этап</Label>
                <Select value={deal.stage} onValueChange={(v) => run('set_deal_stage', { _deal_id: deal.id, _stage: v })}>
                  <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                  <SelectContent>{DEAL_STAGES.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent>
                </Select></div>
            )}
            {role === 'director' && (
              <div><Label>Ответственный</Label>
                <Select value={deal.owner_id ?? 'none'} onValueChange={(v) => run('assign_deal', { _deal_id: deal.id, _owner_id: v === 'none' ? null : v })}>
                  <SelectTrigger className="w-60"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="none">Не назначен</SelectItem>{owners.map((o) => <SelectItem key={o.user_id} value={o.user_id}>{o.full_name}</SelectItem>)}</SelectContent>
                </Select></div>
            )}
            {!closed && <Button onClick={save} disabled={!Object.keys(edit).length}>Сохранить</Button>}
          </div>
        </CardContent></Card>

        <Card><CardHeader><CardTitle className="text-lg">Потребность</CardTitle></CardHeader><CardContent className="space-y-3">
          <Table><TableHeader><TableRow><TableHead>Позиция</TableHead><TableHead className="text-right">Человек</TableHead><TableHead className="text-right">Часов в месяц</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>{needs.map((n) => (
              <TableRow key={n.id}><TableCell>{posName(n.position_id)}</TableCell><TableCell className="text-right">{n.headcount}</TableCell><TableCell className="text-right">{n.hours_per_month}</TableCell>
                <TableCell className="text-right">{!closed && <Button variant="ghost" size="icon" aria-label="Убрать позицию" onClick={async () => { await db('deal_needs').delete().eq('id', n.id); load(); }}><Trash2 className="w-4 h-4" /></Button>}</TableCell></TableRow>
            ))}</TableBody></Table>
          {!closed && (
            <div className="flex flex-wrap items-end gap-2">
              <Select value={needDraft.position_id} onValueChange={(v) => setNeedDraft({ ...needDraft, position_id: v })}><SelectTrigger className="w-56" aria-label="Позиция"><SelectValue placeholder="Позиция" /></SelectTrigger>
                <SelectContent>{positions.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select>
              <Input aria-label="Человек" className="w-24" inputMode="numeric" value={needDraft.headcount} onChange={(e) => setNeedDraft({ ...needDraft, headcount: e.target.value })} />
              <Input aria-label="Часов в месяц" className="w-28" inputMode="decimal" value={needDraft.hours} onChange={(e) => setNeedDraft({ ...needDraft, hours: e.target.value })} />
              <Button variant="outline" onClick={addNeed}>Добавить</Button>
            </div>
          )}
        </CardContent></Card>

        <Card><CardHeader><CardTitle className="text-lg">Касания и задачи</CardTitle></CardHeader><CardContent className="space-y-3">
          {!closed && (
            <div className="flex flex-wrap items-end gap-2">
              <Select value={touch.kind} onValueChange={(v) => setTouch({ ...touch, kind: v })}><SelectTrigger className="w-36" aria-label="Тип"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(TOUCH_KINDS).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select>
              <Input aria-label="Что сделать или что было" className="w-64" placeholder="Что сделать или что было" value={touch.title} onChange={(e) => setTouch({ ...touch, title: e.target.value })} />
              <Input aria-label="Срок" type="datetime-local" className="w-56" value={touch.due} onChange={(e) => setTouch({ ...touch, due: e.target.value })} />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={touch.done} onChange={(e) => setTouch({ ...touch, done: e.target.checked })} /> уже было</label>
              <Button variant="outline" className="gap-1" onClick={addTouch}><Plus className="w-4 h-4" /> Добавить</Button>
            </div>
          )}
          {touches.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 border-b last:border-0 text-sm">
              <span><Badge variant="outline" className="mr-2">{TOUCH_KINDS[t.kind]}</Badge>{t.title}</span>
              <span className="flex items-center gap-2 text-muted-foreground">
                {fmtDate(t.due_at.slice(0, 10))}
                {t.done_at ? <Badge variant="secondary">сделано</Badge> : !closed && <Button size="sm" variant="outline" onClick={() => run('complete_deal_touch', { _touch_id: t.id })}>Выполнено</Button>}
              </span>
            </div>
          ))}
          {!touches.length && <p className="text-sm text-muted-foreground">Пока ничего нет.</p>}
        </CardContent></Card>

        <Card><CardHeader className="flex-row items-center justify-between space-y-0"><CardTitle className="text-lg">Коммерческие предложения</CardTitle>
          {!closed && !lines && <Button variant="outline" onClick={startQuote}>Новое КП</Button>}</CardHeader><CardContent className="space-y-4">
          {lines && (
            <div className="space-y-3 border rounded p-3">
              {lines.map((l, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex flex-wrap items-end gap-2">
                    <Select value={l.position_id} onValueChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, position_id: v } : x)))}><SelectTrigger className="w-52" aria-label="Позиция"><SelectValue placeholder="Позиция" /></SelectTrigger>
                      <SelectContent>{positions.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select>
                    <div><Label className="text-xs">Ставка заказчику, ₽/ч</Label><Input className="w-32" inputMode="decimal" value={l.client_rate} onBlur={() => loadMargin(i)} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, client_rate: e.target.value } : x)))} /></div>
                    <div><Label className="text-xs">На руки исполнителю, ₽/ч</Label><Input className="w-32" inputMode="decimal" value={l.worker_rate} onBlur={() => loadMargin(i)} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, worker_rate: e.target.value } : x)))} /></div>
                    <div><Label className="text-xs">Человек</Label><Input className="w-20" inputMode="numeric" value={l.headcount} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, headcount: e.target.value } : x)))} /></div>
                    <div><Label className="text-xs">Часов в месяц</Label><Input className="w-24" inputMode="decimal" value={l.hours} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, hours: e.target.value } : x)))} /></div>
                    <Button variant="ghost" size="icon" aria-label="Убрать строку" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="w-4 h-4" /></Button>
                  </div>
                  {margins[i] && <p className="text-xs text-muted-foreground">Маржа за час: {margins[i].map((m) => `${TAX_NAMES[m.status]} ${fmtMoney(m.margin)} (${m.margin_pct ?? '—'}%)`).join(' · ')}</p>}
                </div>
              ))}
              <div className="flex gap-2"><Button variant="outline" onClick={() => setLines([...lines, { position_id: '', client_rate: '', worker_rate: '', headcount: '1', hours: '0' }])}>Ещё позиция</Button>
                <Button onClick={saveQuote}>Сохранить КП</Button><Button variant="ghost" onClick={() => setLines(null)}>Отмена</Button></div>
            </div>
          )}
          {quotes.map((q) => (
            <div key={q.id} className="border rounded p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">Версия {q.version} <span className="text-sm text-muted-foreground">от {fmtDate(q.created_at.slice(0, 10))}</span></span>
                <span className="flex flex-wrap gap-2">
                  {q.sent_at && <Badge variant="secondary">отправлено {q.sent_to}</Badge>}
                  <Button asChild size="sm" variant="outline"><Link to={`/deals/${deal.id}/quote/${q.version}`} target="_blank">PDF</Link></Button>
                  {!closed && <Button size="sm" variant="outline" onClick={() => sendQuote(q)}>Отправить</Button>}
                  {!closed && <Button size="sm" onClick={() => win(q)}>Выиграна по этой версии</Button>}
                </span>
              </div>
              <Table><TableHeader><TableRow><TableHead>Позиция</TableHead><TableHead className="text-right">Заказчику</TableHead><TableHead className="text-right">Исполнителю</TableHead><TableHead className="text-right">Человек</TableHead><TableHead className="text-right">Часов</TableHead></TableRow></TableHeader>
                <TableBody>{(q.lines as QuoteLine[]).map((l, i) => (
                  <TableRow key={i}><TableCell>{posName(l.position_id)}</TableCell><TableCell className="text-right">{fmtMoney(l.client_rate)}</TableCell><TableCell className="text-right">{fmtMoney(l.worker_rate)}</TableCell><TableCell className="text-right">{l.headcount}</TableCell><TableCell className="text-right">{l.hours_per_month}</TableCell></TableRow>
                ))}</TableBody></Table>
            </div>
          ))}
          {quotes.length > 0 && <p className="text-sm text-muted-foreground">Оценка месячной выручки по последнему КП: {fmtMoney(total)}</p>}
          {!quotes.length && !lines && <p className="text-sm text-muted-foreground">КП ещё нет. Ставки заказчику попадают в PDF, ставки исполнителю остаются внутри.</p>}
        </CardContent></Card>
      </div>

      <Dialog open={lostOpen} onOpenChange={setLostOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Сделка проиграна</DialogTitle><DialogDescription>Причина попадёт в отчёт по отказам.</DialogDescription></DialogHeader>
          <Select value={LOST_REASONS.includes(lostReason) ? lostReason : 'other'} onValueChange={(v) => setLostReason(v === 'other' ? '' : v)}>
            <SelectTrigger aria-label="Причина"><SelectValue /></SelectTrigger>
            <SelectContent>{LOST_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}<SelectItem value="other">Другая причина…</SelectItem></SelectContent>
          </Select>
          {!LOST_REASONS.includes(lostReason) && <Input aria-label="Своя причина" placeholder="Своя причина" value={lostReason} onChange={(e) => setLostReason(e.target.value)} />}
          <DialogFooter><Button variant="outline" onClick={() => setLostOpen(false)}>Отмена</Button>
            <Button onClick={async () => { const r = await run('set_deal_stage', { _deal_id: deal.id, _stage: 'lost', _lost_reason: lostReason }); if (r !== null) setLostOpen(false); }}>Закрыть сделку</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default DealDetail;
