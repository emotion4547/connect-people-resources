import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { usePermissions } from '@/hooks/usePermissions';
import { supabase } from '@/integrations/supabase/client';
import { db, rpc } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { DOC_STATUSES, docTitle, type ClientDocument, type DocumentLine } from '@/lib/documentsMeta';
import { DocumentView } from '@/components/documents/DocumentView';
import PageMeta from '@/components/PageMeta';
import { ArrowLeft, Printer } from 'lucide-react';

const DocumentDetail: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { can } = usePermissions();
  const [docs, setDocs] = useState<ClientDocument[]>([]);
  const [lines, setLines] = useState<Record<string, DocumentLine[]>>({});
  const [clientName, setClientName] = useState('');
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const file = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const d = await db('client_documents').select('*').or(`id.eq.${id},parent_document_id.eq.${id}`).order('kind');
    if (d.error || !d.data?.length) { toast({ title: 'Документ не найден', description: d.error?.message, variant: 'destructive' }); return; }
    const list: ClientDocument[] = d.data;
    setDocs(list);
    const l = await db('client_document_lines').select('*').in('document_id', list.map((x) => x.id)).order('sort_order');
    const by: Record<string, DocumentLine[]> = {};
    (l.data ?? []).forEach((x: DocumentLine & { document_id: string }) => { (by[x.document_id] ??= []).push(x); });
    setLines(by);
    const c = await db('clients').select('name').eq('id', list[0].client_id).maybeSingle();
    setClientName(c.data?.name ?? '');
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  const run = async (fn: string, args: Record<string, unknown>, ok: string) => {
    setBusy(true);
    const { error } = await rpc(fn, args);
    setBusy(false);
    if (error) { toast({ title: 'Не получилось', description: error.message, variant: 'destructive' }); return false; }
    toast({ title: ok });
    await load();
    return true;
  };

  const upload = async (f: File | undefined) => {
    const root = docs.find((d) => !d.parent_document_id) ?? docs[0];
    if (!f || !root) return;
    const path = `${root.org_id}/${root.id}/${Date.now()}-${f.name.replace(/[^\w.-]+/g, '_')}`;
    setBusy(true);
    const up = await supabase.storage.from('client-documents').upload(path, f);
    setBusy(false);
    if (up.error) { toast({ title: 'Файл не загружен', description: up.error.message, variant: 'destructive' }); return; }
    await run('register_document_signature', { _doc_id: root.id, _file_path: path }, 'Подпись зарегистрирована');
  };

  const root = docs.find((d) => !d.parent_document_id) ?? docs[0];
  if (!root) return <AppLayout><p className="text-muted-foreground">Загрузка…</p></AppLayout>;
  const canEdit = can('client_documents', 'update');

  return (
    <AppLayout>
      <PageMeta title="Документ" description="Акт и счёт заказчику" />
      <div className="max-w-4xl mx-auto space-y-6 animate-slide-up">
        <Link to="/documents" className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:underline"><ArrowLeft className="w-4 h-4" /> Все документы</Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{clientName}</h1>
            <p className="text-muted-foreground">{fmtDate(root.period_from)} — {fmtDate(root.period_to)}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={root.status === 'cancelled' ? 'destructive' : 'secondary'}>{DOC_STATUSES[root.status]}</Badge>
            {root.sent_at && <Badge variant="outline">отправлен заказчику</Badge>}
            {root.sign_method && <Badge variant="outline">{root.sign_method === 'simple_esign' ? 'принят в кабинете' : 'подписан, скан'}</Badge>}
          </div>
        </div>
        {root.has_open_timesheets && root.status === 'draft' && (
          <p className="rounded-md border border-destructive/40 p-3 text-sm">В периоде остались неподтверждённые или оспоренные табели. Их часы войдут в следующий документ.</p>
        )}
        {root.status === 'cancelled' && <p className="rounded-md border p-3 text-sm">Аннулирован: {root.cancel_reason}</p>}
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            {root.status === 'draft' && <>
              <Button disabled={busy} onClick={() => run('issue_client_documents', { _doc_id: root.id }, 'Документы выставлены')}>Выставить акт и счёт</Button>
              <Button variant="outline" disabled={busy} onClick={async () => { if (await run('discard_client_document_draft', { _doc_id: root.id }, 'Черновик удалён')) navigate('/documents'); }}>Удалить черновик</Button>
            </>}
            {['issued', 'signed'].includes(root.status) && !root.sent_at && <Button disabled={busy} onClick={() => run('send_client_document', { _doc_id: root.id }, 'Отправлено заказчику')}>Отправить заказчику</Button>}
            {root.status === 'issued' && <>
              <Button variant="outline" disabled={busy} onClick={() => file.current?.click()}>Загрузить подписанный скан</Button>
              <input ref={file} type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
              <Button variant="outline" disabled={busy} onClick={() => { setReason(''); setCancelling(true); }}>Аннулировать</Button>
            </>}
          </div>
        )}
        {docs.map((d) => (
          <Card key={d.id}>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-lg">{docTitle(d)}</CardTitle>
              {d.status !== 'draft' && (
                <Button asChild variant="outline" size="sm" className="gap-2"><Link to={`/documents/${d.id}/print`}><Printer className="w-4 h-4" /> Печатная форма</Link></Button>
              )}
            </CardHeader>
            <CardContent><DocumentView doc={d} lines={lines[d.id] ?? []} /></CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={cancelling} onOpenChange={setCancelling}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Аннулировать акт и счёт</DialogTitle>
            <DialogDescription>Номера остаются за аннулированными документами, начисления вернутся и войдут в новый документ.</DialogDescription>
          </DialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelling(false)}>Назад</Button>
            <Button disabled={busy || !reason.trim()} onClick={async () => { if (await run('cancel_client_documents', { _doc_id: root.id, _reason: reason }, 'Документы аннулированы')) setCancelling(false); }}>Аннулировать</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default DocumentDetail;
