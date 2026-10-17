import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useOrg } from '@/contexts/OrgContext';
import { db, rpc } from '@/lib/db';
import type { CashCategory } from '@/lib/cashMeta';
import PageMeta from '@/components/PageMeta';

interface Rule { id: string; priority: number; direction: string | null; match_inn: string | null; match_words: string[] | null; category_id: string; note: string | null; is_active: boolean }

// Правила разнесения операций выписки по статьям (Ф-3).
const CashRules: React.FC = () => {
  const { toast } = useToast();
  const { orgId } = useOrg();
  const [rules, setRules] = useState<Rule[]>([]);
  const [cats, setCats] = useState<CashCategory[]>([]);
  const [inn, setInn] = useState('');
  const [words, setWords] = useState('');
  const [dir, setDir] = useState('any');
  const [cat, setCat] = useState('');

  const load = useCallback(async () => {
    if (!orgId) return;
    const [r, c] = await Promise.all([
      db('cashflow_rules').select('*').eq('org_id', orgId).order('priority'),
      db('cashflow_categories').select('*').eq('org_id', orgId).eq('is_active', true).eq('is_transfer', false).order('sort_order'),
    ]);
    setRules(r.data ?? []); setCats(c.data ?? []);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!orgId) return;
    const list = words.split(',').map((w) => w.trim()).filter(Boolean);
    const { error } = await db('cashflow_rules').insert({ org_id: orgId, direction: dir === 'any' ? null : dir, match_inn: inn.trim() || null, match_words: list.length ? list : null, category_id: cat });
    if (error) { toast({ title: 'Правило не сохранено', description: error.code === '23514' ? 'Укажите ИНН или слова из назначения платежа' : error.message, variant: 'destructive' }); return; }
    setInn(''); setWords('');
    await rpc('apply_cashflow_rules', { _org_id: orgId });
    load();
  };

  const toggle = async (r: Rule) => { await db('cashflow_rules').update({ is_active: !r.is_active }).eq('id', r.id); load(); };
  const remove = async (r: Rule) => { await db('cashflow_rules').delete().eq('id', r.id); load(); };
  const cname = (id: string) => cats.find((c) => c.id === id)?.name ?? '—';

  return (
    <AppLayout>
      <PageMeta title="Правила разнесения" description="Правила статей ДДС" />
      <div className="max-w-4xl mx-auto space-y-6 animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold mb-2">Правила разнесения</h1>
          <p className="text-muted-foreground">Операции выписки получают статью по ИНН контрагента и словам в назначении платежа. Первое подходящее правило по порядку. <Link to="/cash" className="underline">К операциям</Link></p>
        </div>
        <Card><CardContent className="pt-6 grid gap-3 sm:grid-cols-5 items-end">
          <div><Label htmlFor="rl-inn">ИНН</Label><Input id="rl-inn" value={inn} onChange={(e) => setInn(e.target.value)} /></div>
          <div className="sm:col-span-2"><Label htmlFor="rl-words">Слова (через запятую)</Label><Input id="rl-words" value={words} onChange={(e) => setWords(e.target.value)} placeholder="аренда, офис" /></div>
          <Select value={dir} onValueChange={setDir}><SelectTrigger aria-label="Направление"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="any">Любое</SelectItem><SelectItem value="in">Приход</SelectItem><SelectItem value="out">Расход</SelectItem></SelectContent></Select>
          <Select value={cat} onValueChange={setCat}><SelectTrigger aria-label="Статья"><SelectValue placeholder="Статья" /></SelectTrigger>
            <SelectContent>{cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select>
          <Button className="sm:col-span-5" onClick={add} disabled={!cat || (!inn.trim() && !words.trim())}>Добавить правило</Button>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <Table>
            <TableHeader><TableRow><TableHead>Условие</TableHead><TableHead>Статья</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {rules.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{[r.direction === 'in' ? 'приход' : r.direction === 'out' ? 'расход' : null, r.match_inn ? `ИНН ${r.match_inn}` : null, r.match_words?.length ? `слова: ${r.match_words.join(', ')}` : null].filter(Boolean).join(' · ')}</TableCell>
                  <TableCell>{cname(r.category_id)} {!r.is_active && <Badge variant="outline">выключено</Badge>}</TableCell>
                  <TableCell className="text-right space-x-2"><Button size="sm" variant="outline" onClick={() => toggle(r)}>{r.is_active ? 'Выключить' : 'Включить'}</Button><Button size="sm" variant="ghost" onClick={() => remove(r)}>Удалить</Button></TableCell>
                </TableRow>
              ))}
              {!rules.length && <TableRow><TableCell colSpan={3} className="text-muted-foreground">Правил пока нет: они появятся, когда вы будете разносить операции с галочкой «запоминать правило».</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent></Card>
      </div>
    </AppLayout>
  );
};

export default CashRules;
