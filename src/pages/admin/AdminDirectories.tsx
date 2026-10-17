import React, { useCallback, useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useOrg } from '@/contexts/OrgContext';
import { db } from '@/lib/db';
import PageMeta from '@/components/PageMeta';

interface Item { id: string; kind: string; name: string; item_date: string | null; sort_order: number; is_active: boolean }

const KINDS: Record<string, { label: string; hint: string }> = {
  worker_group: { label: 'Группы исполнителей', hint: 'Бригады и категории, по которым делаются рассылки и отчёты' },
  candidate_source: { label: 'Источники кандидатов', hint: 'Откуда пришёл кандидат' },
  client_source: { label: 'Источники заказчиков', hint: 'Откуда пришёл заказчик' },
  no_show_reason: { label: 'Причины неявки', hint: 'Выбираются при отметке «Не вышел»' },
  cancel_reason: { label: 'Причины отмены', hint: 'Выбираются при отмене смены исполнителем или заказчиком' },
  candidate_reject_reason: { label: 'Причины отказа кандидату', hint: 'Выбираются при отказе' },
  holiday: { label: 'Праздничные дни', hint: 'Нужны для праздничных коэффициентов тарифа. Переносы выходных добавьте по производственному календарю' },
};

const fmtDate = (d: string) => d.split('-').reverse().join('.');

const AdminDirectories: React.FC = () => {
  const { toast } = useToast();
  const { orgId } = useOrg();
  const [kind, setKind] = useState('worker_group');
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [date, setDate] = useState('');

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const { data, error } = await db('directories').select('id,kind,name,item_date,sort_order,is_active')
      .eq('org_id', orgId).eq('kind', kind).order('item_date', { ascending: true }).order('sort_order').order('name');
    setLoading(false);
    if (error) {
      toast({ title: 'Не удалось загрузить справочник', description: error.message, variant: 'destructive' });
      return;
    }
    setItems(data ?? []);
  }, [orgId, kind, toast]);

  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!orgId || !name.trim() || (kind === 'holiday' && !date)) return;
    const { error } = await db('directories').insert({
      org_id: orgId, kind, name: name.trim(), item_date: kind === 'holiday' ? date : null,
      sort_order: items.length ? Math.max(...items.map((i) => i.sort_order)) + 1 : 1,
    });
    if (error) {
      toast({
        title: error.code === '23505' ? 'Такая запись уже есть' : 'Не удалось добавить',
        description: error.code === '23505' ? undefined : error.message,
        variant: 'destructive',
      });
      return;
    }
    setName('');
    setDate('');
    load();
  };

  // Записи справочника не удаляются: уже использованную нельзя потерять, её скрывают из выбора.
  const toggle = async (item: Item, active: boolean) => {
    setItems((list) => list.map((i) => (i.id === item.id ? { ...i, is_active: active } : i)));
    const { error } = await db('directories').update({ is_active: active }).eq('id', item.id);
    if (error) {
      toast({ title: 'Не удалось изменить', description: error.message, variant: 'destructive' });
      load();
    }
  };

  return (
    <DashboardLayout role="admin">
      <PageMeta title="Справочники" description="Справочники организации" />
      <div className="max-w-4xl mx-auto space-y-6 animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold mb-2">Справочники</h1>
          <p className="text-muted-foreground">
            Записи не удаляются, а скрываются: так история остаётся целой. Позиции и типы документов появятся на следующих шагах.
          </p>
        </div>

        <Tabs value={kind} onValueChange={setKind}>
          <TabsList className="flex-wrap h-auto">
            {Object.entries(KINDS).map(([k, v]) => <TabsTrigger key={k} value={k}>{v.label}</TabsTrigger>)}
          </TabsList>
        </Tabs>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{KINDS[kind].label}</CardTitle>
            <CardDescription>{KINDS[kind].hint}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
              <Input className="flex-1 min-w-48" value={name} onChange={(e) => setName(e.target.value)} placeholder="Название" aria-label="Название" />
              {kind === 'holiday' && <Input className="w-44" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Дата" />}
              <Button type="submit" disabled={!name.trim() || (kind === 'holiday' && !date)}>Добавить</Button>
            </form>

            {loading ? <p className="text-muted-foreground">Загрузка…</p> : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Название</TableHead>
                    {kind === 'holiday' && <TableHead>Дата</TableHead>}
                    <TableHead className="w-32">В выборе</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((i) => (
                    <TableRow key={i.id} className={i.is_active ? '' : 'opacity-50'}>
                      <TableCell>{i.name}</TableCell>
                      {kind === 'holiday' && <TableCell>{i.item_date ? fmtDate(i.item_date) : ''}</TableCell>}
                      <TableCell>
                        <Switch checked={i.is_active} onCheckedChange={(on) => toggle(i, on)} aria-label={`${i.name}: показывать в выборе`} />
                      </TableCell>
                    </TableRow>
                  ))}
                  {!items.length && (
                    <TableRow><TableCell colSpan={3} className="text-muted-foreground">Записей пока нет.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default AdminDirectories;
