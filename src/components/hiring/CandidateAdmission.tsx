import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { db, invokeFunction, rpc } from '@/lib/db';
import { CheckCircle2, Circle } from 'lucide-react';

interface Item { code: string; label: string; done: boolean }

// Допуск (Н-9): кнопка активна, когда закрыты все обязательные пункты чек-листа.
export const CandidateAdmission: React.FC<{ candidateId: string; admitted: boolean; canEdit: boolean; refreshKey: number; onChanged: () => void }> = ({ candidateId, admitted, canEdit, refreshKey, onChanged }) => {
  const { toast } = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ login: string; link: string | null } | null>(null);
  const [secrets, setSecrets] = useState<{ field: string; masked: string }[]>([]);
  const [payout, setPayout] = useState('');

  const load = useCallback(async () => {
    const [c, m] = await Promise.all([
      rpc('candidate_checklist', { _candidate_id: candidateId }),
      rpc('person_secret_masks', { _subject_type: 'candidate', _subject_id: candidateId }),
    ]);
    if (c.error) { toast({ title: 'Не удалось загрузить чек-лист', description: c.error.message, variant: 'destructive' }); return; }
    setItems(c.data ?? []);
    setSecrets(m.data ?? []);
  }, [candidateId, toast]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const savePayout = async () => {
    const { error } = await rpc('set_person_secret', { _subject_type: 'candidate', _subject_id: candidateId, _field: 'payout', _value: payout });
    if (error) { toast({ title: 'Не удалось сохранить реквизиты', description: error.message, variant: 'destructive' }); return; }
    setPayout(''); toast({ title: 'Реквизиты сохранены' }); load(); onChanged();
  };

  const admit = async () => {
    setBusy(true);
    const { data, error } = await invokeFunction('admit-candidate', { candidate_id: candidateId });
    setBusy(false);
    if (error || data?.error) { toast({ title: 'Допуск не выполнен', description: data?.error ?? error.message, variant: 'destructive' }); return; }
    setResult({ login: data.login, link: data.action_link });
    onChanged();
  };

  const ready = items.length > 0 && items.every((i) => i.done);
  const hasPayout = secrets.some((s) => s.field === 'payout');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Допуск к сменам</CardTitle>
        <CardDescription>Чек-лист строится по гражданству, налоговому статусу и желаемым позициям. Иностранцу нужен патент с оплаченным налогом или РВП/ВНЖ.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {admitted ? <p className="text-primary">Кандидат допущен: исполнитель создан.</p> : (<>
          <ul className="space-y-2">
            {items.map((i) => (
              <li key={i.code} className="flex items-center gap-3 text-sm">
                {i.done ? <CheckCircle2 className="w-5 h-5 text-primary" aria-label="выполнено" /> : <Circle className="w-5 h-5 text-muted-foreground" aria-label="не выполнено" />}
                <span className={i.done ? '' : 'font-medium'}>{i.label}</span>
              </li>
            ))}
          </ul>

          {canEdit && (
            <div className="space-y-2">
              <Label htmlFor="payout">Реквизиты выплаты {hasPayout && <span className="text-muted-foreground">— указаны: {secrets.find((s) => s.field === 'payout')?.masked}</span>}</Label>
              <div className="flex gap-2">
                <Input id="payout" value={payout} onChange={(e) => setPayout(e.target.value)} placeholder="Карта, счёт или идентификатор платформы" autoComplete="off" />
                <Button variant="outline" onClick={savePayout} disabled={!payout.trim()}>Сохранить</Button>
              </div>
            </div>
          )}

          {canEdit && <Button onClick={admit} disabled={!ready || busy}>Допустить</Button>}
        </>)}
      </CardContent>

      <Dialog open={!!result} onOpenChange={(open) => !open && setResult(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Исполнитель создан</DialogTitle>
            <DialogDescription>Передайте логин и ссылку для установки пароля. После закрытия окна ссылку повторно увидеть нельзя; отправка по SMS и MAX появится вместе с уведомлениями.</DialogDescription>
          </DialogHeader>
          {result && (
            <div className="space-y-3 text-sm">
              <div>Логин: <span className="font-mono">{result.login}</span></div>
              {result.link && <Input readOnly value={result.link} onFocus={(e) => e.currentTarget.select()} aria-label="Ссылка для установки пароля" />}
            </div>
          )}
          <DialogFooter>
            {result?.link && <Button variant="outline" onClick={() => navigator.clipboard.writeText(result.link!)}>Копировать ссылку</Button>}
            <Button onClick={() => setResult(null)}>Закрыть</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};
