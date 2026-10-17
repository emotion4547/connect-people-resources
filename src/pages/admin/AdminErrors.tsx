import React, { useCallback, useEffect, useState } from 'react';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/db';
import PageMeta from '@/components/PageMeta';

interface Row { id: string; role: string | null; message: string; stack: string | null; url: string | null; user_agent: string | null; created_at: string }

// Ошибки, которые браузеры пользователей сообщили сами: какая страница, какая роль, что сломалось.
const AdminErrors: React.FC = () => {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await db('client_errors').select('id, role, message, stack, url, user_agent, created_at').order('created_at', { ascending: false }).limit(200);
    if (error) { toast({ title: 'Не удалось загрузить журнал', description: error.message, variant: 'destructive' }); return; }
    setRows((data ?? []) as Row[]);
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  return (
    <AppLayout>
      <PageMeta title="Журнал ошибок" description="Ошибки интерфейса" />
      <div className="max-w-6xl mx-auto space-y-6 animate-slide-up">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold mb-2">Журнал ошибок интерфейса</h1>
            <p className="text-muted-foreground">Сюда попадают ошибки, которые браузер пользователя не смог обработать. Записи старше 60 дней удаляются сами.</p>
          </div>
          <Button variant="outline" onClick={load}>Обновить</Button>
        </div>
        <Card><CardContent className="pt-6 overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Когда</TableHead><TableHead>Роль</TableHead><TableHead>Страница</TableHead><TableHead>Ошибка</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => (
                <React.Fragment key={r.id}>
                  <TableRow className="cursor-pointer" onClick={() => setOpen(open === r.id ? null : r.id)}>
                    <TableCell className="whitespace-nowrap">{new Date(r.created_at).toLocaleString('ru-RU')}</TableCell>
                    <TableCell>{r.role ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{r.url ?? '—'}</TableCell>
                    <TableCell>{r.message}</TableCell>
                  </TableRow>
                  {open === r.id && (
                    <TableRow><TableCell colSpan={4}><pre className="text-xs whitespace-pre-wrap bg-muted p-3 rounded">{r.stack ?? 'нет трассировки'}{'\n\n'}{r.user_agent}</pre></TableCell></TableRow>
                  )}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
          {!rows.length && <p className="text-sm text-muted-foreground mt-3">Ошибок нет.</p>}
        </CardContent></Card>
      </div>
    </AppLayout>
  );
};

export default AdminErrors;
