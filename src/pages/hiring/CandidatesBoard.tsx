import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useOrg } from '@/contexts/OrgContext';
import { usePermissions } from '@/hooks/usePermissions';
import { db, rpc } from '@/lib/db';
import { STAGES, daysSince, type Candidate } from '@/lib/hiringMeta';
import PageMeta from '@/components/PageMeta';
import { downloadExcel } from '@/lib/csv';
import { Download, Plus, Upload } from 'lucide-react';

interface Option { id: string; name: string }
interface Duplicate { kind: string; id: string; full_name: string; phone: string | null }

const CandidatesBoard: React.FC = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { orgId } = useOrg();
  const { can, loading: permsLoading } = usePermissions();
  const [rows, setRows] = useState<Candidate[]>([]);
  const [rejectReasons, setRejectReasons] = useState<Option[]>([]);
  const [sources, setSources] = useState<Option[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragId, setDragId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Candidate | null>(null);
  const [reasonId, setReasonId] = useState('');

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ full_name: '', phone: '', city: '', citizenship: 'Россия', source_id: '' });
  const [duplicates, setDuplicates] = useState<Duplicate[]>([]);
  const [importing, setImporting] = useState(false);
  const [csv, setCsv] = useState('');

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const [c, r, s] = await Promise.all([
      db('candidates').select('*').eq('org_id', orgId).order('stage_changed_at', { ascending: false }).limit(1000),
      db('directories').select('id,name').eq('org_id', orgId).eq('kind', 'candidate_reject_reason').eq('is_active', true).order('sort_order'),
      db('directories').select('id,name').eq('org_id', orgId).eq('kind', 'candidate_source').eq('is_active', true).order('sort_order'),
    ]);
    setLoading(false);
    if (c.error) { toast({ title: 'Не удалось загрузить кандидатов', description: c.error.message, variant: 'destructive' }); return; }
    setRows(c.data ?? []); setRejectReasons(r.data ?? []); setSources(s.data ?? []);
  }, [orgId, toast]);

  useEffect(() => { load(); }, [load]);

  // Дубли по телефону показываются, пока рекрутер вводит номер (Н-5).
  useEffect(() => {
    if (!creating || !orgId || form.phone.replace(/\D/g, '').length < 10) { setDuplicates([]); return; }
    const t = setTimeout(async () => {
      const { data } = await rpc('find_duplicates', { _org_id: orgId, _phone: form.phone });
      setDuplicates(data ?? []);
    }, 300);
    return () => clearTimeout(t);
  }, [form.phone, creating, orgId]);

  const byStage = useMemo(() => {
    const m = new Map<string, Candidate[]>();
    STAGES.forEach((s) => m.set(s.id, []));
    rows.forEach((r) => m.get(r.stage)?.push(r));
    return m;
  }, [rows]);

  const move = async (c: Candidate, stage: string, reject?: string) => {
    if (c.stage === stage) return;
    if (stage === 'admitted') { toast({ title: 'В «Допущен» переводит только допуск', description: 'Откройте карточку кандидата, вкладка «Допуск».', variant: 'destructive' }); return; }
    if (c.stage === 'admitted') { toast({ title: 'Допущенного кандидата вернуть нельзя', variant: 'destructive' }); return; }
    if (stage === 'rejected' && !reject) { setRejecting(c); setReasonId(''); return; }
    const { error } = await db('candidates').update({ stage, reject_reason_id: stage === 'rejected' ? reject : null }).eq('id', c.id);
    if (error) { toast({ title: 'Не удалось перенести', description: error.message, variant: 'destructive' }); return; }
    load();
  };

  const create = async () => {
    if (!orgId || !form.full_name.trim()) return;
    const { data, error } = await db('candidates').insert({
      org_id: orgId, full_name: form.full_name.trim(), phone: form.phone.trim() || null, city: form.city || null,
      citizenship: form.citizenship || null, source_id: form.source_id || null, recruiter_id: user?.id,
    }).select('id').single();
    if (error) { toast({ title: 'Не удалось создать кандидата', description: error.message, variant: 'destructive' }); return; }
    setCreating(false);
    setForm({ full_name: '', phone: '', city: '', citizenship: 'Россия', source_id: '' });
    navigate(`/candidates/${data.id}`);
  };

  // Импорт из Excel: вставьте строки «ФИО;телефон;город;гражданство» (из Excel копируется с табуляцией).
  const importRows = async () => {
    if (!orgId) return;
    const source = sources.find((s) => s.name === 'Импорт из Excel')?.id ?? null;
    const lines = csv.split('\n').map((l) => l.trim()).filter(Boolean);
    const records = lines.map((l) => l.split(/[;\t]/).map((x) => x.trim()));
    const valid = records.filter((r) => r[0]);
    const { error } = await db('candidates').insert(valid.map((r) => ({
      org_id: orgId, full_name: r[0], phone: r[1] || null, city: r[2] || null, citizenship: r[3] || null,
      source_id: source, recruiter_id: user?.id,
    })));
    if (error) { toast({ title: 'Импорт не выполнен', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Импорт выполнен', description: `Добавлено: ${valid.length}${valid.length < records.length ? `, пропущено без ФИО: ${records.length - valid.length}` : ''}` });
    setImporting(false); setCsv('');
    load();
  };

  return (
    <AppLayout>
      <PageMeta title="Кандидаты" description="Воронка найма" />
      <div className="max-w-full mx-auto space-y-4 animate-slide-up">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">Кандидаты</h1>
            <p className="text-muted-foreground">Перетащите карточку на другой этап. В «Допущен» кандидат попадает только через допуск с закрытым чек-листом документов.</p>
          </div>
          <Button variant="outline" className="gap-2" disabled={!rows.length} onClick={() => downloadExcel('kandidaty.xlsx', ['ФИО', 'Телефон', 'Город', 'Район', 'Гражданство', 'Этап', 'В этапе, дн.', 'Следующий контакт', 'Дата создания'],
            rows.map((c) => [c.full_name, c.phone, c.city, c.district, c.citizenship, STAGES.find((x) => x.id === c.stage)?.label ?? c.stage, daysSince(c.stage_changed_at), c.next_contact_at ? c.next_contact_at.slice(0, 10).split('-').reverse().join('.') : '', c.created_at.slice(0, 10).split('-').reverse().join('.')]))}><Download className="w-4 h-4" /> В Excel</Button>
          {can('candidates', 'create') && (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setImporting(true)} className="gap-2"><Upload className="w-4 h-4" /> Импорт</Button>
              <Button onClick={() => setCreating(true)} className="gap-2"><Plus className="w-4 h-4" /> Новый кандидат</Button>
            </div>
          )}
        </div>

        {permsLoading || loading ? <p className="text-muted-foreground">Загрузка…</p> : (
          <div className="overflow-x-auto pb-4">
            <div className="flex gap-3 min-w-max">
              {STAGES.map((stage) => {
                const items = byStage.get(stage.id) ?? [];
                return (
                  <div
                    key={stage.id}
                    className={`w-64 shrink-0 rounded-lg border p-2 ${stage.side ? 'bg-muted/40' : 'bg-card'}`}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => { const c = rows.find((r) => r.id === dragId); if (c) move(c, stage.id); setDragId(null); }}
                    aria-label={stage.label}
                  >
                    <div className="flex items-center justify-between px-1 pb-2 font-medium text-sm">
                      <span>{stage.label}</span><Badge variant="secondary">{items.length}</Badge>
                    </div>
                    <div className="space-y-2 min-h-24">
                      {items.map((c) => (
                        <Card key={c.id} draggable={stage.id !== 'admitted'} onDragStart={() => setDragId(c.id)} className="cursor-grab">
                          <CardContent className="p-3 text-sm space-y-1">
                            <Link to={`/candidates/${c.id}`} className="font-medium hover:underline">{c.full_name}</Link>
                            <div className="text-xs text-muted-foreground">{c.phone ?? 'без телефона'}{c.city ? ` · ${c.city}` : ''}</div>
                            <div className="text-xs text-muted-foreground">на этапе {daysSince(c.stage_changed_at)} дн.</div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новый кандидат</DialogTitle>
            <DialogDescription>Остальное — в карточке: позиции, документы, касания.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label htmlFor="cand-name">ФИО</Label><Input id="cand-name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
            <div className="space-y-2">
              <Label htmlFor="cand-phone">Телефон</Label>
              <Input id="cand-phone" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              {duplicates.length > 0 && (
                <div className="text-sm text-destructive space-y-1" role="alert">
                  Такой телефон уже есть:
                  {duplicates.map((d) => <div key={d.id}>{d.kind === 'worker' ? 'исполнитель' : 'кандидат'} {d.full_name}</div>)}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label htmlFor="cand-city">Город</Label><Input id="cand-city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
              <div className="space-y-2"><Label htmlFor="cand-cit">Гражданство</Label><Input id="cand-cit" value={form.citizenship} onChange={(e) => setForm({ ...form, citizenship: e.target.value })} /></div>
            </div>
            <div className="space-y-2">
              <Label>Источник</Label>
              <Select value={form.source_id} onValueChange={(v) => setForm({ ...form, source_id: v })}>
                <SelectTrigger><SelectValue placeholder="Выберите" /></SelectTrigger>
                <SelectContent>{sources.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>Отмена</Button>
            <Button onClick={create} disabled={!form.full_name.trim()}>Создать</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importing} onOpenChange={setImporting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Импорт из Excel</DialogTitle>
            <DialogDescription>Вставьте строки: ФИО; телефон; город; гражданство. Строки без ФИО пропускаются.</DialogDescription>
          </DialogHeader>
          <Textarea rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder="Иванов Иван; +7 900 000-00-00; Оренбург; Россия" aria-label="Строки для импорта" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setImporting(false)}>Отмена</Button>
            <Button onClick={importRows} disabled={!csv.trim()}>Импортировать</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejecting} onOpenChange={(open) => !open && setRejecting(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Отказ кандидату</DialogTitle><DialogDescription>Причина берётся из справочника: по ней строится аналитика.</DialogDescription></DialogHeader>
          <Select value={reasonId} onValueChange={setReasonId}>
            <SelectTrigger aria-label="Причина отказа"><SelectValue placeholder="Причина" /></SelectTrigger>
            <SelectContent>{rejectReasons.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>Отмена</Button>
            <Button variant="destructive" disabled={!reasonId} onClick={() => { if (rejecting) move(rejecting, 'rejected', reasonId); setRejecting(null); }}>Отказать</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default CandidatesBoard;
