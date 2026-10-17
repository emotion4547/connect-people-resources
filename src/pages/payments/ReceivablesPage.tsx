import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { rpc } from '@/lib/db';
import { downloadCsv } from '@/lib/csv';
import { fmtMoney, monthStart, today } from '@/lib/format';
import PageMeta from '@/components/PageMeta';
import { Download } from 'lucide-react';

interface Row {
  client_id: string; client_name: string; invoiced: number; paid: number; debt: number; not_due: number; overdue_30: number;
  overdue_60: number; overdue_60p: number; unallocated: number; max_overdue_days: number | null; credit_limit: number | null; blocked: boolean;
}

const sum = (rows: Row[], k: keyof Row) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);

const ReceivablesPage: React.FC = () => {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await rpc('client_receivables', {});
    setLoading(false);
    if (error) { toast({ title: 'Не удалось загрузить дебиторку', description: error.message, variant: 'destructive' }); return; }
    setRows(data ?? []);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const exportCsv = () => downloadCsv(`debitorka-${today()}.csv`,
    ['Заказчик', 'Выставлено', 'Оплачено', 'Долг', 'Не просрочено', 'Просрочка 0–30', '31–60', 'Больше 60', 'Не разнесено'],
    rows.map((r) => [r.client_name, Number(r.invoiced), Number(r.paid), Number(r.debt), Number(r.not_due), Number(r.overdue_30), Number(r.overdue_60), Number(r.overdue_60p), Number(r.unallocated)]));

  return (
    <AppLayout>
      <PageMeta title="Дебиторка" description="Долги и просрочка заказчиков" />
      <div className="max-w-6xl mx-auto space-y-6 animate-slide-up">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">Дебиторка</h1>
            <p className="text-muted-foreground">Просрочка считается от срока оплаты по договору. Заказчик на контроле: долг больше лимита или просрочка дольше допустимой — заказы принимает только руководитель.</p>
          </div>
          <Button variant="outline" className="gap-2" onClick={exportCsv} disabled={!rows.length}><Download className="w-4 h-4" /> В Excel (CSV)</Button>
        </div>
        <Card>
          <CardContent className="pt-6">
            {loading ? <p className="text-muted-foreground">Загрузка…</p> : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Заказчик</TableHead><TableHead className="text-right">Выставлено</TableHead><TableHead className="text-right">Оплачено</TableHead>
                    <TableHead className="text-right">Долг</TableHead><TableHead className="text-right">0–30</TableHead><TableHead className="text-right">31–60</TableHead>
                    <TableHead className="text-right">60+</TableHead><TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.client_id}>
                      <TableCell>
                        <Link to={`/clients/${r.client_id}`} className="font-medium hover:underline">{r.client_name}</Link>
                        <div className="space-x-1">
                          {r.blocked && <Badge variant="destructive">на контроле</Badge>}
                          {Number(r.unallocated) > 0 && <Badge variant="outline">аванс {fmtMoney(r.unallocated)}</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{fmtMoney(r.invoiced)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(r.paid)}</TableCell>
                      <TableCell className="text-right font-medium">{fmtMoney(r.debt)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(r.overdue_30)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(r.overdue_60)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(r.overdue_60p)}</TableCell>
                      <TableCell className="text-right"><Button asChild size="sm" variant="outline"><Link to={`/documents/reconciliation/${r.client_id}?from=${monthStart()}&to=${today()}`}>Акт сверки</Link></Button></TableCell>
                    </TableRow>
                  ))}
                  {!rows.length && <TableRow><TableCell colSpan={8} className="text-muted-foreground">Выставленных счетов пока нет.</TableCell></TableRow>}
                </TableBody>
                {rows.length > 0 && (
                  <TableFooter>
                    <TableRow>
                      <TableCell>Итого</TableCell><TableCell className="text-right">{fmtMoney(sum(rows, 'invoiced'))}</TableCell><TableCell className="text-right">{fmtMoney(sum(rows, 'paid'))}</TableCell>
                      <TableCell className="text-right">{fmtMoney(sum(rows, 'debt'))}</TableCell><TableCell className="text-right">{fmtMoney(sum(rows, 'overdue_30'))}</TableCell>
                      <TableCell className="text-right">{fmtMoney(sum(rows, 'overdue_60'))}</TableCell><TableCell className="text-right">{fmtMoney(sum(rows, 'overdue_60p'))}</TableCell><TableCell />
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default ReceivablesPage;
