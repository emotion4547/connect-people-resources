import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db, rpc } from '@/lib/db';
import { fmtDate, fmtMoney } from '@/lib/format';
import { DOC_KINDS, DOC_STATUSES, docTitle, type ClientDocument, type DocumentLine } from '@/lib/documentsMeta';
import { DocumentView } from '@/components/documents/DocumentView';
import PageMeta from '@/components/PageMeta';

// К-5: документы заказчика — акты и счета, статус оплаты, печатная форма, кнопка «Принято».
const ClientDocuments: React.FC = () => {
  const { id } = useParams();
  const { toast } = useToast();
  const [docs, setDocs] = useState<ClientDocument[]>([]);
  const [lines, setLines] = useState<Record<string, DocumentLine[]>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const q = db('client_documents').select('*').order('issue_date', { ascending: false });
    const d = await (id ? q.or(`id.eq.${id},parent_document_id.eq.${id}`) : q.is('parent_document_id', null));
    if (d.error) { toast({ title: 'Не удалось загрузить документы', description: d.error.message, variant: 'destructive' }); return; }
    setDocs(d.data ?? []);
    if (id && d.data?.length) {
      const l = await db('client_document_lines').select('*').in('document_id', d.data.map((x: ClientDocument) => x.id)).order('sort_order');
      const by: Record<string, DocumentLine[]> = {};
      (l.data ?? []).forEach((x: DocumentLine & { document_id: string }) => { (by[x.document_id] ??= []).push(x); });
      setLines(by);
    }
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  const accept = async () => {
    setBusy(true);
    const { error } = await rpc('accept_client_document', { _doc_id: id });
    setBusy(false);
    if (error) { toast({ title: 'Не получилось', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Документы приняты' });
    load();
  };

  if (!id) {
    return (
      <DashboardLayout role="hr">
        <PageMeta title="Документы" description="Акты и счета" />
        <div className="max-w-3xl mx-auto space-y-4 animate-slide-up">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-2xl font-bold">Документы</h1>
            {docs[0] && <Button asChild variant="outline" size="sm"><Link to={`/documents/reconciliation/${docs[0].client_id}?from=${new Date().getFullYear()}-01-01&to=${new Date().toISOString().slice(0, 10)}`}>Акт сверки с начала года</Link></Button>}
          </div>
          <Card><CardContent className="pt-6">
            <Table>
              <TableHeader><TableRow><TableHead>Документ</TableHead><TableHead>Период</TableHead><TableHead className="text-right">Сумма</TableHead><TableHead>Статус</TableHead></TableRow></TableHeader>
              <TableBody>
                {docs.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell><Link className="font-medium hover:underline" to={`/client/documents/${d.id}`}>{DOC_KINDS[d.kind]} № {d.number}</Link></TableCell>
                    <TableCell>{fmtDate(d.period_from)} — {fmtDate(d.period_to)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(d.amount_total)}</TableCell>
                    <TableCell><Badge variant={d.status === 'issued' ? 'default' : 'secondary'}>{DOC_STATUSES[d.status]}</Badge></TableCell>
                  </TableRow>
                ))}
                {!docs.length && <TableRow><TableCell colSpan={4} className="text-muted-foreground">Документов пока нет.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </div>
      </DashboardLayout>
    );
  }

  const root = docs.find((d) => !d.parent_document_id) ?? docs[0];
  return (
    <DashboardLayout role="hr">
      <PageMeta title="Документ" description="Акт и счёт" />
      <div className="max-w-3xl mx-auto space-y-4 animate-slide-up">
        <Link to="/client/documents" className="text-sm text-muted-foreground hover:underline">← Все документы</Link>
        {root && root.status === 'issued' && (
          <Card className="border-primary"><CardContent className="pt-6 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">Проверьте строки и примите документы. Если договор допускает подписание кнопкой, они считаются подписанными.</p>
            <Button className="min-h-11" disabled={busy} onClick={accept}>Принято</Button>
          </CardContent></Card>
        )}
        {docs.map((d) => (
          <Card key={d.id}>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-lg">{docTitle(d)}</CardTitle>
              <Button asChild variant="outline" size="sm"><Link to={`/documents/${d.id}/print`}>Печатная форма</Link></Button>
            </CardHeader>
            <CardContent><DocumentView doc={d} lines={lines[d.id] ?? []} /></CardContent>
          </Card>
        ))}
      </div>
    </DashboardLayout>
  );
};

export default ClientDocuments;
