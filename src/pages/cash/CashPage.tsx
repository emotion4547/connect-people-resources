import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useOrg } from '@/contexts/OrgContext';
import { usePermissions } from '@/hooks/usePermissions';
import { supabase } from '@/integrations/supabase/client';
import { db, rpc } from '@/lib/db';
import { fmtDate, fmtMoney, monthStart, today } from '@/lib/format';
import { decodeStatement, parseStatement, statementRows } from '@/lib/kl1c';
import { ACCOUNT_KINDS, type CashAccount, type CashCategory, type CashEntry } from '@/lib/cashMeta';
import PageMeta from '@/components/PageMeta';
import { ArrowLeftRight, Plus, Upload } from 'lucide-react';

const ALL = 'all';

const CashPage: React.FC = () => {
  const { toast } = useToast();
  const { orgId } = useOrg();
  const { can } = usePermissions();
  const [accounts, setAccounts] = useState<CashAccount[]>([]);
  const [cats, setCats] = useState<CashCategory[]>([]);
  const [balances, setBalances] = useState<{ account_id: string; balance: number }[]>([]);
  const [rows, setRows] = useState<CashEntry[]>([]);
  const [asOf, setAsOf] = useState(today());
  const [params] = useSearchParams();
  const [from, setFrom] = useState(params.get('from') ?? monthStart());
  const [to, setTo] = useState(params.get('to') ?? today());
  const [accFilter, setAccFilter] = useState(ALL);
  const [catFilter, setCatFilter] = useState(params.get('category') ?? ALL);
  const [dirFilter, setDirFilter] = useState(params.get('direction') ?? ALL);
  const [makeRule, setMakeRule] = useState(true);
  const stmt = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ account: '', date: today(), direction: 'out', amount: '', category: '', counterparty: '', comment: '' });
  const [moving, setMoving] = useState(false);
  const [m, setM] = useState({ from: '', to: '', date: today(), amount: '', comment: '' });

  const load = useCallback(async () => {
    if (!orgId) return;
    let q = db('cashflow_entries').select('*').eq('org_id', orgId).gte('entry_date', from).lte('entry_date', to).order('entry_date', { ascending: false }).order('created_at', { ascending: false }).limit(500);
    if (accFilter !== ALL) q = q.eq('account_id', accFilter);
    if (catFilter === 'none') q = q.is('category_id', null); else if (catFilter !== ALL) q = q.eq('category_id', catFilter);
    if (dirFilter !== ALL) q = q.eq('direction', dirFilter);
    const [a, c, b, e] = await Promise.all([
      db('cash_accounts').select('*').eq('org_id', orgId).order('sort_order'),
      db('cashflow_categories').select('*').eq('org_id', orgId).eq('is_active', true).order('sort_order'),
      rpc('cash_balances', { _org_id: orgId, _date: asOf }),
      q,
    ]);
    if (e.error) toast({ title: 'Не удалось загрузить операции', description: e.error.message, variant: 'destructive' });
    setAccounts(a.data ?? []); setCats(c.data ?? []); setBalances(b.data ?? []); setRows(e.data ?? []);
  }, [orgId, asOf, from, to, accFilter, catFilter, dirFilter, toast]);

  useEffect(() => { load(); }, [load]);

  const accName = (id: string) => accounts.find((x) => x.id === id)?.name ?? '—';
  const catName = (id: string | null) => cats.find((x) => x.id === id)?.name;
  const total = balances.reduce((s, b) => s + Number(b.balance), 0);

  const uploadStatement = async (f: File | undefined) => {
    if (!f || !orgId) return;
    const account = accFilter !== ALL ? accFilter : accounts.find((a) => a.kind === 'bank')?.id;
    if (!account) { toast({ title: 'Выберите счёт, по которому выписка', variant: 'destructive' }); return; }
    const rowsParsed = statementRows(parseStatement(decodeStatement(await f.arrayBuffer())));
    if (!rowsParsed.length) { toast({ title: 'В файле нет операций', variant: 'destructive' }); return; }
    setBusy(true);
    const { data, error } = await rpc('import_cashflow_statement', { _org_id: orgId, _account_id: account, _filename: f.name, _rows: rowsParsed });
    setBusy(false);
    if (stmt.current) stmt.current.value = '';
    if (error) { toast({ title: 'Выписка не загружена', description: error.message, variant: 'destructive' }); return; }
    toast({ title: `Новых: ${data.new}, подтверждено: ${data.confirmed}, разнесено по правилам: ${data.sorted}, в очередь: ${data.queue}`, description: data.duplicates ? `Повторов пропущено: ${data.duplicates}` : undefined });
    load();
  };

  const addEntry = async () => {
    if (!orgId) return;
    setBusy(true);
    let path: string | null = null;
    const picked = file.current?.files?.[0];
    if (picked) {
      path = `${orgId}/${crypto.randomUUID()}/${picked.name.replace(/[^\w.-]+/g, '_')}`;
      const up = await supabase.storage.from('cashflow-files').upload(path, picked);
      if (up.error) { setBusy(false); toast({ title: 'Файл не загружен', description: up.error.message, variant: 'destructive' }); return; }
    }
    const { error } = await rpc('add_cashflow_entry', {
      _org_id: orgId, _account_id: f.account, _date: f.date, _direction: f.direction, _amount: Number(f.amount.replace(',', '.')),
      _category_id: f.category || null, _counterparty: f.counterparty || null, _comment: f.comment || null, _file_path: path,
    });
    setBusy(false);
    if (error) { toast({ title: 'Не сохранено', description: error.message, variant: 'destructive' }); return; }
    setAdding(false); setF({ ...f, amount: '', counterparty: '', comment: '' });
    load();
  };

  const transfer = async () => {
    if (!orgId) return;
    setBusy(true);
    const { error } = await rpc('transfer_cash', { _org_id: orgId, _from: m.from, _to: m.to, _date: m.date, _amount: Number(m.amount.replace(',', '.')), _comment: m.comment || null });
    setBusy(false);
    if (error) { toast({ title: 'Не сохранено', description: error.message, variant: 'destructive' }); return; }
    setMoving(false); setM({ ...m, amount: '', comment: '' });
    load();
  };

  const remove = async (e: CashEntry) => {
    if (!window.confirm('Удалить операцию?')) return;
    const { error } = await rpc('delete_cashflow_entry', { _entry_id: e.id });
    if (error) { toast({ title: 'Не удалено', description: error.message, variant: 'destructive' }); return; }
    load();
  };

  const recat = async (e: CashEntry, category: string) => {
    const { error } = await rpc('set_entry_category', { _entry_id: e.id, _category_id: category, _make_rule: makeRule && !e.category_id });
    if (error) { toast({ title: 'Не сохранено', description: error.message, variant: 'destructive' }); return; }
    load();
  };

  const catsFor = (dir: string) => cats.filter((c) => !c.is_transfer && (c.direction === 'both' || c.direction === dir));

  return (
    <AppLayout>
      <PageMeta title="Деньги (ДДС)" description="Счета, остатки и операции" />
      <div className="max-w-6xl mx-auto space-y-6 animate-slide-up">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">Деньги</h1>
            <p className="text-muted-foreground">Оплаты заказчиков и проведённые выплаты попадают сюда сами. Прочие расходы и перемещения вносятся вручную.</p>
          </div>
          {can('cashflow', 'create') && (
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline"><Link to="/cash/calendar">Календарь</Link></Button>
              <Button asChild variant="outline"><Link to="/cash/report">Отчёт ДДС</Link></Button>
              <Button asChild variant="outline"><Link to="/cash/bdr">БДР</Link></Button>
              <Button asChild variant="outline"><Link to="/cash/rules">Правила</Link></Button>
              <Button variant="outline" className="gap-2" disabled={busy} onClick={() => stmt.current?.click()}><Upload className="w-4 h-4" /> Выписка</Button>
              <input ref={stmt} type="file" accept=".txt" className="hidden" onChange={(e) => uploadStatement(e.target.files?.[0])} />
              <Button variant="outline" className="gap-2" onClick={() => setMoving(true)}><ArrowLeftRight className="w-4 h-4" /> Перемещение</Button>
              <Button className="gap-2" onClick={() => setAdding(true)}><Plus className="w-4 h-4" /> Операция</Button>
            </div>
          )}
        </div>

        <div className="flex items-end gap-3">
          <div><Label htmlFor="asof">Остатки на дату</Label><Input id="asof" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></div>
          <div className="text-sm text-muted-foreground pb-2">Всего: <span className="font-semibold text-foreground">{fmtMoney(total)}</span></div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {balances.map((b) => {
            const a = accounts.find((x) => x.id === b.account_id);
            return (
              <Card key={b.account_id}>
                <CardHeader className="pb-2"><CardTitle className="text-base">{a?.name}</CardTitle><CardDescription>{a ? ACCOUNT_KINDS[a.kind] : ''}</CardDescription></CardHeader>
                <CardContent><div className={`text-2xl font-bold ${Number(b.balance) < 0 ? 'text-destructive' : ''}`}>{fmtMoney(b.balance)}</div></CardContent>
              </Card>
            );
          })}
        </div>

        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div><Label htmlFor="c-from">С</Label><Input id="c-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div><Label htmlFor="c-to">По</Label><Input id="c-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
              <Select value={accFilter} onValueChange={setAccFilter}>
                <SelectTrigger className="w-52" aria-label="Счёт"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value={ALL}>Все счета</SelectItem>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={catFilter} onValueChange={setCatFilter}>
                <SelectTrigger className="w-56" aria-label="Статья"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value={ALL}>Все статьи</SelectItem><SelectItem value="none">Не разнесено</SelectItem>{cats.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={dirFilter} onValueChange={setDirFilter}>
                <SelectTrigger className="w-40" aria-label="Направление"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value={ALL}>Приход и расход</SelectItem><SelectItem value="in">Приход</SelectItem><SelectItem value="out">Расход</SelectItem></SelectContent>
              </Select>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={makeRule} onChange={(e) => setMakeRule(e.target.checked)} /> запоминать правило при разнесении</label>
            </div>
            <Table>
              <TableHeader><TableRow><TableHead>Дата</TableHead><TableHead>Счёт</TableHead><TableHead>Статья</TableHead><TableHead>Контрагент</TableHead><TableHead className="text-right">Сумма</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{fmtDate(r.entry_date)}</TableCell>
                    <TableCell>{accName(r.account_id)}</TableCell>
                    <TableCell>
                      {r.transfer_group || r.source === 'auto' ? (catName(r.category_id) ?? '—') : (
                        <Select value={r.category_id ?? ''} onValueChange={(v) => recat(r, v)} disabled={!can('cashflow', 'update')}>
                          <SelectTrigger className="h-8 w-48" aria-label="Статья"><SelectValue placeholder="Не разнесено" /></SelectTrigger>
                          <SelectContent>{catsFor(r.direction).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                        </Select>
                      )}
                      {r.is_advance && <Badge variant="outline" className="ml-2">аванс</Badge>}
                    </TableCell>
                    <TableCell className="text-sm">{r.counterparty}{r.comment && <div className="text-xs text-muted-foreground">{r.comment}</div>}</TableCell>
                    <TableCell className={`text-right whitespace-nowrap ${r.direction === 'out' ? 'text-destructive' : ''}`}>{r.direction === 'out' ? '−' : '+'}{fmtMoney(r.amount)}</TableCell>
                    <TableCell className="text-right">{r.source !== 'auto' && can('cashflow', 'delete') && <Button size="sm" variant="ghost" onClick={() => remove(r)}>Удалить</Button>}</TableCell>
                  </TableRow>
                ))}
                {!rows.length && <TableRow><TableCell colSpan={6} className="text-muted-foreground">Операций за период нет.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader><DialogTitle>Новая операция</DialogTitle><DialogDescription>Прочие расходы и поступления. Оплаты заказчиков и выплаты исполнителям вносить не нужно.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Select value={f.direction} onValueChange={(v) => setF({ ...f, direction: v, category: '' })}>
                <SelectTrigger aria-label="Направление"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="out">Расход</SelectItem><SelectItem value="in">Поступление</SelectItem></SelectContent>
              </Select>
              <Select value={f.account} onValueChange={(v) => setF({ ...f, account: v })}>
                <SelectTrigger aria-label="Счёт"><SelectValue placeholder="Счёт" /></SelectTrigger>
                <SelectContent>{accounts.filter((a) => a.is_active).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Select value={f.category} onValueChange={(v) => setF({ ...f, category: v })}>
              <SelectTrigger aria-label="Статья"><SelectValue placeholder="Статья" /></SelectTrigger>
              <SelectContent>{catsFor(f.direction).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="e-date">Дата</Label><Input id="e-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
              <div><Label htmlFor="e-sum">Сумма, ₽</Label><Input id="e-sum" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
            </div>
            <div><Label htmlFor="e-cp">Контрагент</Label><Input id="e-cp" value={f.counterparty} onChange={(e) => setF({ ...f, counterparty: e.target.value })} /></div>
            <Textarea value={f.comment} onChange={(e) => setF({ ...f, comment: e.target.value })} placeholder="Комментарий" />
            <div><Label htmlFor="e-file">Файл (счёт, акт)</Label><input id="e-file" ref={file} type="file" className="block text-sm" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setAdding(false)}>Отмена</Button><Button disabled={busy || !f.account || !f.amount} onClick={addEntry}>Сохранить</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={moving} onOpenChange={setMoving}>
        <DialogContent>
          <DialogHeader><DialogTitle>Перемещение между счетами</DialogTitle><DialogDescription>Например, пополнение баланса на платформе выплат. В отчёты ДДС не входит.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <Select value={m.from} onValueChange={(v) => setM({ ...m, from: v })}><SelectTrigger aria-label="Откуда"><SelectValue placeholder="Откуда" /></SelectTrigger>
              <SelectContent>{accounts.filter((a) => a.is_active).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select>
            <Select value={m.to} onValueChange={(v) => setM({ ...m, to: v })}><SelectTrigger aria-label="Куда"><SelectValue placeholder="Куда" /></SelectTrigger>
              <SelectContent>{accounts.filter((a) => a.is_active).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select>
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="m-date">Дата</Label><Input id="m-date" type="date" value={m.date} onChange={(e) => setM({ ...m, date: e.target.value })} /></div>
              <div><Label htmlFor="m-sum">Сумма, ₽</Label><Input id="m-sum" inputMode="decimal" value={m.amount} onChange={(e) => setM({ ...m, amount: e.target.value })} /></div>
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setMoving(false)}>Отмена</Button><Button disabled={busy || !m.from || !m.to || !m.amount} onClick={transfer}>Переместить</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default CashPage;
