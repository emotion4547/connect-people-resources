import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { usePermissions } from '@/hooks/usePermissions';
import { db, rpc } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { WORKER_STATUSES, DOC_STATUSES } from '@/lib/hiringMeta';
import { ASSIGNMENT_STATUSES } from '@/lib/planningMeta';
import PageMeta from '@/components/PageMeta';
import { ArrowLeft } from 'lucide-react';

interface Worker {
  user_id: string; org_id: string; full_name: string; phone: string | null; city: string | null; citizenship: string | null;
  birth_date: string | null; status: string; status_until: string | null; tax_status: string | null; contract_valid_until: string | null;
  rating: number | null; address_actual: string | null; address_registered: string | null; notes: string | null; referral_code: string;
}
interface Option { id: string; name: string }
const TAX: Record<string, string> = { ip: 'ИП', self_employed: 'Самозанятый', gph: 'ГПХ', employment: 'Трудовой договор' };
const NONE = '__none__';

const WorkerDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { can, scope, loading: permsLoading } = usePermissions();
  const [w, setW] = useState<Worker | null>(null);
  const [form, setForm] = useState<Worker | null>(null);
  const [positions, setPositions] = useState<Option[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [docs, setDocs] = useState<{ id: string; document_type_id: string; number_masked: string | null; valid_until: string | null; status: string }[]>([]);
  const [types, setTypes] = useState<Option[]>([]);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [masks, setMasks] = useState<{ field: string; masked: string }[]>([]);
  const [history, setHistory] = useState<{ id: string; shift_start: string; status: string; late_cancel: boolean }[]>([]);
  const [blocks, setBlocks] = useState<{ id: string; reason: string; client_id: string | null; site_id: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const r = await db('workers').select('*').eq('user_id', id).maybeSingle();
    setLoading(false);
    if (r.error || !r.data) { if (r.error) toast({ title: 'Не удалось загрузить исполнителя', description: r.error.message, variant: 'destructive' }); return; }
    const row: Worker = r.data;
    setW(row); setForm(row);
    const [p, wp, d, t, h, b, m] = await Promise.all([
      db('positions').select('id,name').eq('org_id', row.org_id).eq('is_active', true).order('sort_order'),
      db('worker_positions').select('position_id').eq('worker_id', id),
      db('worker_documents').select('id,document_type_id,number_masked,valid_until,status').eq('worker_id', id).order('created_at'),
      db('directories').select('id,name').eq('org_id', row.org_id).eq('kind', 'document_type'),
      db('assignments').select('id,shift_start,status,late_cancel').eq('worker_id', id).order('shift_start', { ascending: false }).limit(50),
      db('worker_blocks').select('id,reason,client_id,site_id').eq('worker_id', id),
      rpc('person_secret_masks', { _subject_type: 'worker', _subject_id: id }),
    ]);
    setPositions(p.data ?? []); setDocs(d.data ?? []); setTypes(t.data ?? []); setHistory(h.data ?? []); setBlocks(b.data ?? []); setMasks(m.data ?? []);
    setChosen(new Set((wp.data ?? []).map((x: { position_id: string }) => x.position_id)));
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  const set = <K extends keyof Worker>(k: K, v: Worker[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const canEdit = can('workers', 'update');
  const typeName = (tid: string) => types.find((t) => t.id === tid)?.name ?? '—';

  const save = async () => {
    if (!form || !w) return;
    setSaving(true);
    const { error } = await db('workers').update({
      full_name: form.full_name.trim(), phone: form.phone || null, city: form.city || null, citizenship: form.citizenship || null,
      birth_date: form.birth_date || null, status: form.status, status_until: ['sick', 'vacation'].includes(form.status) ? form.status_until : null,
      tax_status: form.tax_status, contract_valid_until: form.contract_valid_until || null,
    }).eq('user_id', w.user_id);
    setSaving(false);
    if (error) { toast({ title: 'Не удалось сохранить', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Сохранено' }); load();
  };

  const togglePosition = async (positionId: string, on: boolean) => {
    if (!w) return;
    const { error } = on
      ? await db('worker_positions').insert({ org_id: w.org_id, worker_id: w.user_id, position_id: positionId })
      : await db('worker_positions').delete().eq('worker_id', w.user_id).eq('position_id', positionId);
    if (error) toast({ title: 'Не удалось изменить', description: error.message, variant: 'destructive' }); else load();
  };

  const reveal = async (docId: string) => {
    const { data, error } = await rpc('reveal_document_number', { _table: 'worker_documents', _id: docId });
    if (error) { toast({ title: 'Не удалось открыть номер', description: error.message, variant: 'destructive' }); return; }
    setRevealed((r) => ({ ...r, [docId]: data ?? '—' }));
    setTimeout(() => setRevealed((r) => { const n = { ...r }; delete n[docId]; return n; }), 15000);
  };

  const removeBlock = async (blockId: string) => {
    const { error } = await db('worker_blocks').delete().eq('id', blockId);
    if (error) toast({ title: 'Не удалось убрать из стоп-листа', description: error.message, variant: 'destructive' }); else load();
  };

  return (
    <AppLayout>
      <PageMeta title={w?.full_name ?? 'Исполнитель'} description="Карточка исполнителя" />
      <div className="max-w-5xl mx-auto space-y-6 animate-slide-up">
        <Link to="/workers" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="w-4 h-4" /> Все исполнители</Link>
        {loading || permsLoading ? <p className="text-muted-foreground">Загрузка…</p> : !w || !form ? <p className="text-muted-foreground">Исполнитель не найден или нет доступа.</p> : (<>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold">{w.full_name}</h1>
            <Badge>{WORKER_STATUSES[w.status]}</Badge>
            {w.rating && <Badge variant="outline">рейтинг {w.rating}</Badge>}
          </div>
          <Tabs defaultValue="profile">
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="profile">Анкета</TabsTrigger>
              {scope('worker_documents', 'view') !== 'none' && <TabsTrigger value="docs">Документы</TabsTrigger>}
              <TabsTrigger value="shifts">Смены и неявки</TabsTrigger>
              <TabsTrigger value="blocks">Стоп-листы</TabsTrigger>
            </TabsList>

            <TabsContent value="profile">
              <Card><CardHeader><CardTitle className="text-lg">Анкета</CardTitle></CardHeader><CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2 sm:col-span-2"><Label htmlFor="w-name">ФИО</Label><Input id="w-name" value={form.full_name} disabled={!canEdit} onChange={(e) => set('full_name', e.target.value)} /></div>
                  <div className="space-y-2"><Label htmlFor="w-phone">Телефон</Label><Input id="w-phone" value={form.phone ?? ''} disabled={!canEdit} onChange={(e) => set('phone', e.target.value || null)} /></div>
                  <div className="space-y-2"><Label htmlFor="w-city">Город</Label><Input id="w-city" value={form.city ?? ''} disabled={!canEdit} onChange={(e) => set('city', e.target.value || null)} /></div>
                  <div className="space-y-2"><Label htmlFor="w-cit">Гражданство</Label><Input id="w-cit" value={form.citizenship ?? ''} disabled={!canEdit} onChange={(e) => set('citizenship', e.target.value || null)} /></div>
                  <div className="space-y-2"><Label htmlFor="w-birth">Дата рождения</Label><Input id="w-birth" type="date" value={form.birth_date ?? ''} disabled={!canEdit} onChange={(e) => set('birth_date', e.target.value || null)} /></div>
                  <div className="space-y-2">
                    <Label>Статус</Label>
                    <Select value={form.status} onValueChange={(v) => set('status', v)} disabled={!canEdit}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{Object.entries(WORKER_STATUSES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  {['sick', 'vacation'].includes(form.status) && (
                    <div className="space-y-2"><Label htmlFor="w-until">До какой даты</Label><Input id="w-until" type="date" value={form.status_until ?? ''} disabled={!canEdit} onChange={(e) => set('status_until', e.target.value || null)} /><p className="text-xs text-muted-foreground">После этой даты статус перестаёт мешать работе сам.</p></div>
                  )}
                  <div className="space-y-2">
                    <Label>Налоговый статус</Label>
                    <Select value={form.tax_status ?? NONE} onValueChange={(v) => set('tax_status', v === NONE ? null : v)} disabled={!canEdit}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value={NONE}>Не указан</SelectItem>{Object.entries(TAX).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2"><Label htmlFor="w-contract">Договор действует до</Label><Input id="w-contract" type="date" value={form.contract_valid_until ?? ''} disabled={!canEdit} onChange={(e) => set('contract_valid_until', e.target.value || null)} /></div>
                </div>
                <div className="space-y-2">
                  <Label>Позиции</Label>
                  <div className="flex flex-wrap gap-4">{positions.map((p) => (<label key={p.id} className="flex items-center gap-2 text-sm"><Checkbox checked={chosen.has(p.id)} disabled={!canEdit} onCheckedChange={(on) => togglePosition(p.id, on === true)} />{p.name}</label>))}</div>
                </div>
                {masks.length > 0 && <p className="text-sm text-muted-foreground">Реквизиты: {masks.map((m) => `${{ inn: 'ИНН', snils: 'СНИЛС', payout: 'выплата' }[m.field] ?? m.field} ${m.masked}`).join(', ')}</p>}
                <p className="text-sm text-muted-foreground">Реферальный код: <span className="font-mono">{w.referral_code}</span></p>
                {canEdit && <Button onClick={save} disabled={saving || !form.full_name.trim()}>Сохранить</Button>}
              </CardContent></Card>
            </TabsContent>

            <TabsContent value="docs">
              <Card><CardHeader><CardTitle className="text-lg">Документы</CardTitle></CardHeader><CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>Документ</TableHead><TableHead>Номер</TableHead><TableHead>Срок</TableHead><TableHead>Статус</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {docs.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="font-medium">{typeName(d.document_type_id)}</TableCell>
                        <TableCell className="font-mono text-sm">{revealed[d.id] ?? d.number_masked ?? '—'}{d.number_masked && !revealed[d.id] && <Button variant="ghost" size="sm" onClick={() => reveal(d.id)}>Показать</Button>}</TableCell>
                        <TableCell>{d.valid_until ? `до ${fmtDate(d.valid_until)}` : '—'}</TableCell>
                        <TableCell><Badge variant={d.status === 'verified' ? 'default' : 'secondary'}>{DOC_STATUSES[d.status]}</Badge></TableCell>
                      </TableRow>
                    ))}
                    {!docs.length && <TableRow><TableCell colSpan={4} className="text-muted-foreground">Документов нет.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent></Card>
            </TabsContent>

            <TabsContent value="shifts">
              <Card><CardHeader><CardTitle className="text-lg">Смены и неявки</CardTitle></CardHeader><CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>Смена</TableHead><TableHead>Статус</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {history.map((h) => (<TableRow key={h.id}><TableCell>{fmtDate(h.shift_start.slice(0, 10))}</TableCell><TableCell>{ASSIGNMENT_STATUSES[h.status]}{h.late_cancel && <Badge variant="destructive" className="ml-2">поздняя отмена</Badge>}</TableCell></TableRow>))}
                    {!history.length && <TableRow><TableCell colSpan={2} className="text-muted-foreground">Смен пока не было.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent></Card>
            </TabsContent>

            <TabsContent value="blocks">
              <Card><CardHeader><CardTitle className="text-lg">Стоп-листы</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
                {blocks.map((b) => (<div key={b.id} className="flex items-center justify-between"><span>{b.site_id ? 'Объект' : 'Заказчик'}: {b.reason}</span>{can('assignments', 'update') && <Button variant="ghost" size="sm" onClick={() => removeBlock(b.id)}>Убрать</Button>}</div>))}
                {!blocks.length && <p className="text-muted-foreground">Исполнитель не в стоп-листах. Добавить в стоп-лист можно из панели смены в планировании.</p>}
              </CardContent></Card>
            </TabsContent>
          </Tabs>
        </>)}
      </div>
    </AppLayout>
  );
};

export default WorkerDetail;
