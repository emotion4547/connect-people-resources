import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { db, rpc } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { DOC_STATUSES } from '@/lib/hiringMeta';

interface DocType { id: string; name: string; code: string | null }
interface Doc {
  id: string; document_type_id: string; number_masked: string | null; valid_until: string | null; paid_until: string | null;
  file_path: string | null; status: string;
}

// Документы кандидата: загрузка скана, номер (хранится зашифрованным), проверка рекрутером (Н-6…Н-8).
export const CandidateDocuments: React.FC<{ candidateId: string; orgId: string; canEdit: boolean; onChanged: () => void }> = ({ candidateId, orgId, canEdit, onChanged }) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [types, setTypes] = useState<DocType[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [typeId, setTypeId] = useState('');
  const [number, setNumber] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [verify, setVerify] = useState<Doc | null>(null);
  const [validUntil, setValidUntil] = useState('');
  const [paidUntil, setPaidUntil] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [t, d] = await Promise.all([
      db('directories').select('id,name,code').eq('org_id', orgId).eq('kind', 'document_type').eq('is_active', true).order('sort_order'),
      db('candidate_documents').select('id,document_type_id,number_masked,valid_until,paid_until,file_path,status').eq('candidate_id', candidateId).order('created_at'),
    ]);
    if (d.error) { toast({ title: 'Не удалось загрузить документы', description: d.error.message, variant: 'destructive' }); return; }
    setTypes(t.data ?? []); setDocs(d.data ?? []);
  }, [candidateId, orgId, toast]);

  useEffect(() => { load(); }, [load]);

  const typeName = (id: string) => types.find((t) => t.id === id)?.name ?? '—';
  const typeCode = (id: string) => types.find((t) => t.id === id)?.code;

  const add = async () => {
    setBusy(true);
    try {
      let path: string | null = null;
      if (file) {
        path = `${orgId}/candidate/${candidateId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, '_')}`;
        const { error: upError } = await supabase.storage.from('person-documents').upload(path, file);
        if (upError) throw upError;
      }
      const { data, error } = await db('candidate_documents').insert({ org_id: orgId, candidate_id: candidateId, document_type_id: typeId, file_path: path }).select('id').single();
      if (error) throw error;
      if (number.trim()) {
        const { error: numError } = await rpc('set_document_number', { _table: 'candidate_documents', _id: data.id, _number: number });
        if (numError) throw numError;
      }
      setAdding(false); setTypeId(''); setNumber(''); setFile(null);
      toast({ title: 'Документ добавлен' });
      load(); onChanged();
    } catch (e) {
      toast({ title: 'Не удалось добавить документ', description: e instanceof Error ? e.message : String((e as { message?: string }).message ?? e), variant: 'destructive' });
    } finally { setBusy(false); }
  };

  const reveal = async (d: Doc) => {
    const { data, error } = await rpc('reveal_document_number', { _table: 'candidate_documents', _id: d.id });
    if (error) { toast({ title: 'Не удалось открыть номер', description: error.message, variant: 'destructive' }); return; }
    setRevealed((r) => ({ ...r, [d.id]: data ?? '—' }));
    // Номер показывается недолго: после просмотра он снова скрывается.
    setTimeout(() => setRevealed((r) => { const n = { ...r }; delete n[d.id]; return n; }), 15000);
  };

  const openFile = async (d: Doc) => {
    if (!d.file_path) return;
    const { data, error } = await supabase.storage.from('person-documents').createSignedUrl(d.file_path, 60);
    if (error || !data) { toast({ title: 'Не удалось открыть файл', description: error?.message, variant: 'destructive' }); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  const markVerified = async () => {
    if (!verify) return;
    setBusy(true);
    const { error } = await db('candidate_documents').update({
      status: 'verified', valid_until: validUntil || null, paid_until: paidUntil || null, verified_by: user?.id, verified_at: new Date().toISOString(),
    }).eq('id', verify.id);
    setBusy(false);
    if (error) { toast({ title: 'Не удалось сохранить', description: error.message, variant: 'destructive' }); return; }
    setVerify(null); load(); onChanged();
  };

  const reject = async (d: Doc) => {
    const { error } = await db('candidate_documents').update({ status: 'rejected' }).eq('id', d.id);
    if (error) toast({ title: 'Не удалось отклонить', description: error.message, variant: 'destructive' }); else { load(); onChanged(); }
  };

  const remove = async (d: Doc) => {
    const { error } = await db('candidate_documents').delete().eq('id', d.id);
    if (error) toast({ title: 'Не удалось удалить', description: error.message, variant: 'destructive' }); else { load(); onChanged(); }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0 gap-4">
        <div>
          <CardTitle className="text-lg">Документы</CardTitle>
          <CardDescription>Номера показаны маской; полный номер открывается кнопкой и записывается в журнал доступа. Допуск считает только проверенные документы с действующим сроком.</CardDescription>
        </div>
        {canEdit && <Button size="sm" onClick={() => setAdding(true)}>Добавить документ</Button>}
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>Документ</TableHead><TableHead>Номер</TableHead><TableHead>Срок</TableHead><TableHead>Статус</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {docs.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-medium">{typeName(d.document_type_id)}</TableCell>
                <TableCell className="font-mono text-sm">
                  {revealed[d.id] ?? d.number_masked ?? '—'}
                  {d.number_masked && !revealed[d.id] && <Button variant="ghost" size="sm" onClick={() => reveal(d)}>Показать</Button>}
                </TableCell>
                <TableCell className="text-sm">
                  {d.valid_until ? `до ${fmtDate(d.valid_until)}` : '—'}
                  {typeCode(d.document_type_id) === 'patent' && <div className="text-xs text-muted-foreground">налог оплачен до {d.paid_until ? fmtDate(d.paid_until) : '—'}</div>}
                </TableCell>
                <TableCell><Badge variant={d.status === 'verified' ? 'default' : d.status === 'rejected' ? 'destructive' : 'secondary'}>{DOC_STATUSES[d.status]}</Badge></TableCell>
                <TableCell className="text-right space-x-1 whitespace-nowrap">
                  {d.file_path && <Button variant="ghost" size="sm" onClick={() => openFile(d)}>Файл</Button>}
                  {canEdit && d.status !== 'verified' && (<>
                    <Button size="sm" onClick={() => { setVerify(d); setValidUntil(d.valid_until ?? ''); setPaidUntil(d.paid_until ?? ''); }}>Проверен</Button>
                    <Button variant="outline" size="sm" onClick={() => reject(d)}>Отклонить</Button>
                    <Button variant="ghost" size="sm" onClick={() => remove(d)}>Удалить</Button>
                  </>)}
                </TableCell>
              </TableRow>
            ))}
            {!docs.length && <TableRow><TableCell colSpan={5} className="text-muted-foreground">Документов пока нет.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader><DialogTitle>Новый документ</DialogTitle><DialogDescription>Скан или фото сохраняются в закрытом хранилище; номер — в зашифрованном виде.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Тип</Label>
              <Select value={typeId} onValueChange={setTypeId}>
                <SelectTrigger><SelectValue placeholder="Выберите" /></SelectTrigger>
                <SelectContent>{types.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label htmlFor="doc-number">Серия и номер</Label><Input id="doc-number" value={number} onChange={(e) => setNumber(e.target.value)} autoComplete="off" /></div>
            <div className="space-y-2"><Label htmlFor="doc-file">Файл</Label><Input id="doc-file" type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdding(false)}>Отмена</Button>
            <Button onClick={add} disabled={busy || !typeId}>Добавить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!verify} onOpenChange={(open) => !open && setVerify(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Документ проверен</DialogTitle><DialogDescription>Сверьте файл с данными и укажите срок действия.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label htmlFor="v-until">Действует до</Label><Input id="v-until" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></div>
            {verify && typeCode(verify.document_type_id) === 'patent' && (
              <div className="space-y-2"><Label htmlFor="v-paid">Налог оплачен до</Label><Input id="v-paid" type="date" value={paidUntil} onChange={(e) => setPaidUntil(e.target.value)} /></div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVerify(null)}>Отмена</Button>
            <Button onClick={markVerified} disabled={busy}>Поставить «Проверен»</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};
