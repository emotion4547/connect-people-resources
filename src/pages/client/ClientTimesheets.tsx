import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { TIMESHEET_STATUSES, fmtDateTime, type Timesheet } from '@/lib/timesheetsMeta';
import PageMeta from '@/components/PageMeta';

const ClientTimesheets: React.FC = () => {
  const { toast } = useToast();
  const [rows, setRows] = useState<Timesheet[]>([]);
  const [sites, setSites] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      const [t, s] = await Promise.all([
        db('timesheets').select('*').neq('status', 'draft').order('period_from', { ascending: false }),
        db('sites').select('id,name'),
      ]);
      if (t.error) { toast({ title: 'Не удалось загрузить табели', description: t.error.message, variant: 'destructive' }); return; }
      setRows(t.data ?? []);
      setSites(Object.fromEntries((s.data ?? []).map((x: { id: string; name: string }) => [x.id, x.name])));
    })();
  }, [toast]);

  return (
    <DashboardLayout role="hr">
      <PageMeta title="Табели" description="Табели на подтверждение" />
      <div className="max-w-3xl mx-auto space-y-4 animate-slide-up">
        <h1 className="text-2xl font-bold">Табели</h1>
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader><TableRow><TableHead>Объект</TableHead><TableHead>Период</TableHead><TableHead>Статус</TableHead><TableHead>Ответить до</TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell><Link className="font-medium hover:underline" to={`/client/timesheets/${t.id}`}>{sites[t.site_id] ?? '—'}</Link></TableCell>
                    <TableCell>{fmtDate(t.period_from)} — {fmtDate(t.period_to)}</TableCell>
                    <TableCell><Badge variant={t.status === 'pending' ? 'default' : 'secondary'}>{TIMESHEET_STATUSES[t.status]}</Badge></TableCell>
                    <TableCell>{t.status === 'pending' || t.status === 'disputed' ? fmtDateTime(t.confirm_deadline) : '—'}</TableCell>
                  </TableRow>
                ))}
                {!rows.length && <TableRow><TableCell colSpan={4} className="text-muted-foreground">Табелей нет.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default ClientTimesheets;
