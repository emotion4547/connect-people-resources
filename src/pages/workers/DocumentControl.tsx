import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useOrg } from '@/contexts/OrgContext';
import { useToast } from '@/hooks/use-toast';
import { db, rpc } from '@/lib/db';
import { downloadExcel } from '@/lib/csv';
import { addDays, fmtDate, today } from '@/lib/format';
import PageMeta from '@/components/PageMeta';
import { Download } from 'lucide-react';

interface Row { kind: string; doc_id: string; worker_id: string; worker_name: string; phone: string | null; type_id: string | null; type_name: string; number_masked: string | null; valid_until: string | null; days_left: number | null; status: string; next_site: string | null; total: number }
interface Option { id: string; name: string }
interface Conflict { assignment_id: string; shift_id: string; worker_id: string; worker_name: string; shift_date: string; site_name: string; problem: string }

const ALL = 'all';
const PAGE = 100;
const BUCKETS: Record<string, string> = { all: 'Любой срок', expired: 'Просрочены', d3: 'До 3 дней', d14: 'До 14 дней', d30: 'До 30 дней', none: 'Бессрочные' };

// ДК-1…ДК-3: реестр сроков документов и договоров исполнителей, массовые напоминания и смены с недействующим документом.
const DocumentControl: React.FC = () => {
  const { toast } = useToast();
  const { orgId } = useOrg();
  const [type, setType] = useState(ALL);
  const [bucket, setBucket] = useState('d30');
  const [site, setSite] = useState(ALL);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [types, setTypes] = useState<Option[]>([]);
  const [sites, setSites] = useState<Option[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    const [r, t, s, c] = await Promise.all([
      rpc('document_registry', { _org_id: orgId, _type: type === ALL ? null : type, _bucket: bucket === ALL ? null : bucket, _site: site === ALL ? null : site, _search: search || null, _limit: PAGE, _offset: page * PAGE }),
      db('directories').select('id,name').eq('org_id', orgId).eq('kind', 'document_type').order('name'),
      db('sites').select('id,name').eq('org_id', orgId).order('name'),
      rpc('document_conflicts', { _org_id: orgId, _from: today(), _to: addDays(today(), 30) }),
    ]);
    if (r.error) { toast({ title: 'Не удалось загрузить реестр', description: r.error.message, variant: 'destructive' }); return; }
    setRows(((r.data ?? []) as Row[]).map((x) => ({ ...x, total: Number(x.total) })));
    setTypes((t.data ?? []) as Option[]); setSites((s.data ?? []) as Option[]);
    setConflicts(c.error ? [] : ((c.data ?? []) as Conflict[]));
    setChosen(new Set());
  }, [orgId, type, bucket, site, search, page, toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [type, bucket, site, search]);

  const total = rows[0]?.total ?? 0;
  const key = (r: Row) => `${r.kind}:${r.doc_id}`;
  const toggle = (k: string) => setChosen((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const remind = async () => {
    if (!orgId || !chosen.size) return;
    setBusy(true);
    const picked = rows.filter((r) => chosen.has(key(r)));
    const { data, error } = await rpc('remind_documents', { _org_id: orgId, _doc_ids: picked.filter((r) => r.kind === 'document').map((r) => r.doc_id), _contract_worker_ids: picked.filter((r) => r.kind === 'contract').map((r) => r.worker_id) });
    setBusy(false);
    if (error) { toast({ title: 'Не удалось отправить напоминания', description: error.message, variant: 'destructive' }); return; }
    toast({ title: `Напоминаний отправлено: ${data}`, description: Number(data) < picked.length ? 'Остальным уже напоминали сегодня' : undefined });
    setChosen(new Set());
  };

  const dateCell = (r: Row) => {
    if (!r.valid_until) return <span className="text-muted-foreground">бессрочно</span>;
    const cls = r.days_left! < 0 ? 'text-destructive font-medium' : r.days_left! <= 14 ? 'text-amber-600 font-medium' : '';
    return <span className={cls}>{fmtDate(r.valid_until)} <span className="text-xs">({r.days_left! < 0 ? `просрочен на ${-r.days_left!} дн.` : `${r.days_left} дн.`})</span></span>;
  };

  const exportCsv = () => downloadExcel(`documents-${today()}.xlsx`, ['Исполнитель', 'Телефон', 'Документ', 'Номер', 'Действует до', 'Дней', 'Статус', 'Ближайший объект'],
    rows.map((r) => [r.worker_name, r.phone, r.type_name, r.number_masked, r.valid_until ? fmtDate(r.valid_until) : 'бессрочно', r.days_left ?? '', r.status === 'verified' ? 'проверен' : 'не проверен', r.next_site]));

  return (
    <AppLayout>
      <PageMeta title="Контроль документов" description="Сроки документов и договоров исполнителей" />
      <div className="max-w-7xl mx-auto space-y-6 animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold mb-2">Контроль документов</h1>
          <p className="text-muted-foreground">Просроченный обязательный документ или договор закрывает новые назначения на объекты с таким требованием, а уже назначенные смены попадают во вкладку «Смены под угрозой» и подсвечиваются в планировании.</p>
        </div>
        <Tabs defaultValue="registry">
          <TabsList><TabsTrigger value="registry">Реестр</TabsTrigger><TabsTrigger value="conflicts">Смены под угрозой{conflicts.length ? ` (${conflicts.length})` : ''}</TabsTrigger></TabsList>

          <TabsContent value="registry" className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Select value={bucket} onValueChange={setBucket}><SelectTrigger className="w-44" aria-label="Срок"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(BUCKETS).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select>
              <Select value={type} onValueChange={setType}><SelectTrigger className="w-56" aria-label="Тип документа"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value={ALL}>Все документы и договоры</SelectItem>{types.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent></Select>
              <Select value={site} onValueChange={setSite}><SelectTrigger className="w-52" aria-label="Объект"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value={ALL}>Все объекты</SelectItem>{sites.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select>
              <Input aria-label="Поиск" className="w-56" placeholder="Имя или телефон" value={search} onChange={(e) => setSearch(e.target.value)} />
              <div className="ml-auto flex gap-2">
                <Button variant="outline" className="gap-2" onClick={exportCsv} disabled={!rows.length}><Download className="w-4 h-4" /> Excel</Button>
                <Button onClick={remind} disabled={!chosen.size || busy}>Напомнить выбранным ({chosen.size})</Button>
              </div>
            </div>
            <Card><CardContent className="pt-6 overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="w-10"><Checkbox aria-label="Выбрать все" checked={rows.length > 0 && chosen.size === rows.length} onCheckedChange={(v) => setChosen(v ? new Set(rows.map(key)) : new Set())} /></TableHead>
                  <TableHead>Исполнитель</TableHead><TableHead>Документ</TableHead><TableHead>Действует до</TableHead><TableHead>Статус</TableHead><TableHead>Ближайший объект</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={key(r)}>
                      <TableCell><Checkbox aria-label={`Выбрать ${r.worker_name}`} checked={chosen.has(key(r))} onCheckedChange={() => toggle(key(r))} /></TableCell>
                      <TableCell><Link className="hover:underline font-medium" to={`/workers/${r.worker_id}`}>{r.worker_name}</Link><div className="text-xs text-muted-foreground">{r.phone ?? 'телефон не указан'}</div></TableCell>
                      <TableCell>{r.type_name}{r.number_masked && <span className="text-xs text-muted-foreground"> {r.number_masked}</span>}</TableCell>
                      <TableCell>{dateCell(r)}</TableCell>
                      <TableCell>{r.kind === 'contract' ? <Badge variant="outline">договор</Badge> : r.status === 'verified' ? <Badge variant="secondary">проверен</Badge> : <Badge variant="outline">не проверен</Badge>}</TableCell>
                      <TableCell>{r.next_site ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!rows.length && <p className="text-sm text-muted-foreground mt-3">По выбранным условиям документов нет.</p>}
              {total > PAGE && (
                <div className="flex items-center justify-between mt-4 text-sm">
                  <span>{page * PAGE + 1}–{Math.min((page + 1) * PAGE, total)} из {total}</span>
                  <span className="flex gap-2"><Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Назад</Button><Button size="sm" variant="outline" disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}>Вперёд</Button></span>
                </div>
              )}
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="conflicts">
            <Card><CardContent className="pt-6 space-y-2">
              {conflicts.map((c) => (
                <div key={`${c.assignment_id}-${c.problem}`} className="flex flex-wrap justify-between gap-2 py-2 border-b last:border-0 text-sm">
                  <span><Link className="hover:underline font-medium" to={`/workers/${c.worker_id}`}>{c.worker_name}</Link> · {c.site_name}, смена {fmtDate(c.shift_date)}</span>
                  <span className="text-destructive">{c.problem}</span>
                </div>
              ))}
              {!conflicts.length && <p className="text-sm text-muted-foreground">В ближайшие 30 дней назначенных с недействующими документами нет.</p>}
              {conflicts.length > 0 && <Button asChild variant="outline"><Link to="/planning">Открыть планирование</Link></Button>}
            </CardContent></Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
};

export default DocumentControl;
