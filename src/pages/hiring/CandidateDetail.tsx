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
import { useToast } from '@/hooks/use-toast';
import { usePermissions } from '@/hooks/usePermissions';
import { db } from '@/lib/db';
import { ACTIVITY_KINDS, STAGE_LABELS, type Candidate } from '@/lib/hiringMeta';
import { fmtDate } from '@/lib/format';
import { CandidateDocuments } from '@/components/hiring/CandidateDocuments';
import { CandidateAdmission } from '@/components/hiring/CandidateAdmission';
import PageMeta from '@/components/PageMeta';
import { ArrowLeft } from 'lucide-react';

interface Option { id: string; name: string }
interface Activity { id: string; kind: string; result: string | null; next_step: string | null; next_at: string | null; created_at: string }
const TAX: Record<string, string> = { ip: 'ИП', self_employed: 'Самозанятый', gph: 'ГПХ', employment: 'Трудовой договор' };
const NONE = '__none__';

const CandidateDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { can, loading: permsLoading } = usePermissions();
  const [c, setC] = useState<Candidate | null>(null);
  const [form, setForm] = useState<Candidate | null>(null);
  const [positions, setPositions] = useState<Option[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [sources, setSources] = useState<Option[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [act, setAct] = useState({ kind: 'call', result: '', next_step: '', next_at: '' });
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const cand = await db('candidates').select('*').eq('id', id).maybeSingle();
    setLoading(false);
    if (cand.error || !cand.data) { if (cand.error) toast({ title: 'Не удалось загрузить кандидата', description: cand.error.message, variant: 'destructive' }); return; }
    const row: Candidate = cand.data;
    setC(row); setForm(row);
    const [p, cp, s, a] = await Promise.all([
      db('positions').select('id,name').eq('org_id', row.org_id).eq('is_active', true).order('sort_order'),
      db('candidate_positions').select('position_id').eq('candidate_id', id),
      db('directories').select('id,name').eq('org_id', row.org_id).eq('kind', 'candidate_source').order('sort_order'),
      db('candidate_activities').select('id,kind,result,next_step,next_at,created_at').eq('candidate_id', id).order('created_at', { ascending: false }),
    ]);
    setPositions(p.data ?? []); setSources(s.data ?? []); setActivities(a.data ?? []);
    setChosen(new Set((cp.data ?? []).map((x: { position_id: string }) => x.position_id)));
    setVersion((v) => v + 1);
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  const set = <K extends keyof Candidate>(k: K, v: Candidate[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const canEdit = can('candidates', 'update');
  const locked = c?.stage === 'admitted';

  const save = async () => {
    if (!form || !c) return;
    setSaving(true);
    const { error } = await db('candidates').update({
      full_name: form.full_name.trim(), phone: form.phone || null, city: form.city || null, district: form.district || null,
      citizenship: form.citizenship || null, experience: form.experience || null, birth_date: form.birth_date || null,
      tax_status: form.tax_status, source_id: form.source_id,
    }).eq('id', c.id);
    setSaving(false);
    if (error) { toast({ title: 'Не удалось сохранить', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Сохранено' }); load();
  };

  const togglePosition = async (positionId: string, on: boolean) => {
    if (!c) return;
    const { error } = on
      ? await db('candidate_positions').insert({ org_id: c.org_id, candidate_id: c.id, position_id: positionId })
      : await db('candidate_positions').delete().eq('candidate_id', c.id).eq('position_id', positionId);
    if (error) toast({ title: 'Не удалось изменить', description: error.message, variant: 'destructive' }); else load();
  };

  const addActivity = async () => {
    if (!c) return;
    const { error } = await db('candidate_activities').insert({
      org_id: c.org_id, candidate_id: c.id, kind: act.kind, result: act.result || null, next_step: act.next_step || null,
      next_at: act.next_at ? new Date(act.next_at).toISOString() : null,
    });
    if (error) { toast({ title: 'Не удалось записать касание', description: error.message, variant: 'destructive' }); return; }
    setAct({ kind: 'call', result: '', next_step: '', next_at: '' });
    load();
  };

  return (
    <AppLayout>
      <PageMeta title={c?.full_name ?? 'Кандидат'} description="Карточка кандидата" />
      <div className="max-w-5xl mx-auto space-y-6 animate-slide-up">
        <Link to="/candidates" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="w-4 h-4" /> Все кандидаты</Link>
        {loading || permsLoading ? <p className="text-muted-foreground">Загрузка…</p> : !c || !form ? <p className="text-muted-foreground">Кандидат не найден или нет доступа.</p> : (<>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold">{c.full_name}</h1>
            <Badge>{STAGE_LABELS[c.stage]}</Badge>
            {c.admitted_worker_id && <Link to={`/workers/${c.admitted_worker_id}`} className="text-sm underline">карточка исполнителя</Link>}
          </div>

          <Tabs defaultValue="profile">
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="profile">Анкета</TabsTrigger>
              <TabsTrigger value="activities">Касания</TabsTrigger>
              <TabsTrigger value="documents">Документы</TabsTrigger>
              <TabsTrigger value="admission">Допуск</TabsTrigger>
            </TabsList>

            <TabsContent value="profile">
              <Card>
                <CardHeader><CardTitle className="text-lg">Анкета</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2 sm:col-span-2"><Label htmlFor="k-name">ФИО</Label><Input id="k-name" value={form.full_name} disabled={!canEdit || locked} onChange={(e) => set('full_name', e.target.value)} /></div>
                    <div className="space-y-2"><Label htmlFor="k-phone">Телефон</Label><Input id="k-phone" inputMode="tel" value={form.phone ?? ''} disabled={!canEdit || locked} onChange={(e) => set('phone', e.target.value || null)} /></div>
                    <div className="space-y-2"><Label htmlFor="k-city">Город</Label><Input id="k-city" value={form.city ?? ''} disabled={!canEdit || locked} onChange={(e) => set('city', e.target.value || null)} /></div>
                    <div className="space-y-2"><Label htmlFor="k-district">Район</Label><Input id="k-district" value={form.district ?? ''} disabled={!canEdit || locked} onChange={(e) => set('district', e.target.value || null)} /></div>
                    <div className="space-y-2"><Label htmlFor="k-cit">Гражданство</Label><Input id="k-cit" value={form.citizenship ?? ''} disabled={!canEdit || locked} onChange={(e) => set('citizenship', e.target.value || null)} /></div>
                    <div className="space-y-2"><Label htmlFor="k-birth">Дата рождения</Label><Input id="k-birth" type="date" value={form.birth_date ?? ''} disabled={!canEdit || locked} onChange={(e) => set('birth_date', e.target.value || null)} /></div>
                    <div className="space-y-2">
                      <Label>Налоговый статус</Label>
                      <Select value={form.tax_status ?? NONE} onValueChange={(v) => set('tax_status', v === NONE ? null : v)} disabled={!canEdit || locked}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value={NONE}>Не выбран</SelectItem>{Object.entries(TAX).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Источник</Label>
                      <Select value={form.source_id ?? NONE} onValueChange={(v) => set('source_id', v === NONE ? null : v)} disabled={!canEdit || locked}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value={NONE}>Не указан</SelectItem>{sources.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2 sm:col-span-2"><Label htmlFor="k-exp">Опыт</Label><Textarea id="k-exp" rows={3} value={form.experience ?? ''} disabled={!canEdit || locked} onChange={(e) => set('experience', e.target.value || null)} /></div>
                  </div>
                  <div className="space-y-2">
                    <Label>Желаемые позиции</Label>
                    <div className="flex flex-wrap gap-4">
                      {positions.map((p) => (
                        <label key={p.id} className="flex items-center gap-2 text-sm">
                          <Checkbox checked={chosen.has(p.id)} disabled={!canEdit || locked} onCheckedChange={(on) => togglePosition(p.id, on === true)} />{p.name}
                        </label>
                      ))}
                    </div>
                  </div>
                  {canEdit && !locked && <Button onClick={save} disabled={saving || !form.full_name.trim()}>Сохранить</Button>}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="activities">
              <Card>
                <CardHeader><CardTitle className="text-lg">История касаний</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  {canEdit && !locked && (
                    <form className="grid gap-3 sm:grid-cols-5 items-end" onSubmit={(e) => { e.preventDefault(); addActivity(); }}>
                      <Select value={act.kind} onValueChange={(v) => setAct({ ...act, kind: v })}>
                        <SelectTrigger aria-label="Вид касания"><SelectValue /></SelectTrigger>
                        <SelectContent>{Object.entries(ACTIVITY_KINDS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                      </Select>
                      <Input placeholder="Результат" aria-label="Результат" value={act.result} onChange={(e) => setAct({ ...act, result: e.target.value })} />
                      <Input placeholder="Следующий шаг" aria-label="Следующий шаг" value={act.next_step} onChange={(e) => setAct({ ...act, next_step: e.target.value })} />
                      <Input type="datetime-local" aria-label="Когда" value={act.next_at} onChange={(e) => setAct({ ...act, next_at: e.target.value })} />
                      <Button type="submit">Записать</Button>
                    </form>
                  )}
                  <ul className="space-y-3 text-sm">
                    {activities.map((a) => (
                      <li key={a.id} className="border-l-2 pl-3">
                        <div className="font-medium">{ACTIVITY_KINDS[a.kind]} · {fmtDate(a.created_at.slice(0, 10))}</div>
                        {a.result && <div>{a.result}</div>}
                        {a.next_step && <div className="text-muted-foreground">Дальше: {a.next_step}{a.next_at ? `, ${fmtDate(a.next_at.slice(0, 10))}` : ''}</div>}
                      </li>
                    ))}
                    {!activities.length && <li className="text-muted-foreground">Касаний пока нет.</li>}
                  </ul>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="documents">
              <CandidateDocuments candidateId={c.id} orgId={c.org_id} canEdit={canEdit && !locked} onChanged={() => setVersion((v) => v + 1)} />
            </TabsContent>
            <TabsContent value="admission">
              <CandidateAdmission candidateId={c.id} admitted={locked} canEdit={canEdit} refreshKey={version} onChanged={load} />
            </TabsContent>
          </Tabs>
        </>)}
      </div>
    </AppLayout>
  );
};

export default CandidateDetail;
