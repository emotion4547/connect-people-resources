import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useOrg } from '@/contexts/OrgContext';
import { db, rpc } from '@/lib/db';

export const ADJUSTMENT_KINDS: Record<string, string> = {
  bonus: 'Бонус исполнителю',
  deduction: 'Удержание с исполнителя',
  client_penalty: 'Штраф заказчику',
};

interface Reason { id: string; kind: string; name: string }

// Бонус, удержание или штраф по назначению (Д-3). Причина — из справочника; большое удержание уйдёт на согласование.
export const AdjustmentDialog: React.FC<{ assignmentId: string | null; workerName?: string; onClose: () => void; onDone: () => void }> = ({
  assignmentId, workerName, onClose, onDone,
}) => {
  const { toast } = useToast();
  const { orgId } = useOrg();
  const [reasons, setReasons] = useState<Reason[]>([]);
  const [kind, setKind] = useState('bonus');
  const [amount, setAmount] = useState('');
  const [reasonId, setReasonId] = useState('');
  const [note, setNote] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!orgId || !assignmentId) return;
    db('directories').select('id,kind,name').eq('org_id', orgId).eq('is_active', true).in('kind', ['bonus_reason', 'deduction_reason']).order('sort_order')
      .then(({ data }: { data: Reason[] | null }) => setReasons(data ?? []));
    setKind('bonus'); setAmount(''); setReasonId(''); setNote(''); setVisible(false);
  }, [orgId, assignmentId]);

  const list = reasons.filter((r) => r.kind === (kind === 'bonus' ? 'bonus_reason' : 'deduction_reason'));

  const save = async () => {
    setBusy(true);
    const { data, error } = await rpc('add_adjustment', {
      _assignment_id: assignmentId, _kind: kind, _amount: Number(amount.replace(',', '.')), _reason_id: reasonId, _note: note || null, _visible_to_client: visible,
    });
    setBusy(false);
    if (error) { toast({ title: 'Не сохранено', description: error.message, variant: 'destructive' }); return; }
    void data;
    toast({ title: kind === 'deduction' ? 'Удержание добавлено (если оно больше порога, его согласует руководитель)' : 'Сохранено' });
    onDone();
    onClose();
  };

  return (
    <Dialog open={!!assignmentId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Бонус, удержание, штраф</DialogTitle>
          <DialogDescription>{workerName}. Основное начисление по смене уже создано при подтверждении табеля.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Select value={kind} onValueChange={(v) => { setKind(v); setReasonId(''); }}>
            <SelectTrigger aria-label="Вид"><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(ADJUSTMENT_KINDS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
          </Select>
          <div><Label htmlFor="adj-amount">Сумма, ₽</Label><Input id="adj-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <Select value={reasonId} onValueChange={setReasonId}>
            <SelectTrigger aria-label="Причина"><SelectValue placeholder="Причина" /></SelectTrigger>
            <SelectContent>{list.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
          </Select>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Пояснение (необязательно)" />
          {kind !== 'client_penalty' && (
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={visible} onCheckedChange={(v) => setVisible(v === true)} /> Показывать заказчику</label>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={save} disabled={busy || !amount || !reasonId}>Сохранить</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
