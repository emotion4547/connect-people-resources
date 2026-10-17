import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { db, rpc } from '@/lib/db';
import type { ChecklistItem, Site } from '@/lib/sitesMeta';
import { SITE_STATUSES } from '@/lib/sitesMeta';
import { CheckCircle2, Circle } from 'lucide-react';

export const SiteLaunch: React.FC<{ site: Site; canEdit: boolean; refreshKey: number; onChanged: () => void }> = ({ site, canEdit, refreshKey, onChanged }) => {
  const { toast } = useToast();
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await rpc('site_launch_checklist', { _site_id: site.id });
    if (error) toast({ title: 'Не удалось загрузить чек-лист', description: error.message, variant: 'destructive' });
    else setItems(data ?? []);
  }, [site.id, toast]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const allDone = items.length > 0 && items.every((i) => i.done);

  const launch = async () => {
    setBusy(true);
    const { error } = await db('sites').update({ status: 'active' }).eq('id', site.id);
    setBusy(false);
    if (error) {
      toast({ title: 'Объект не запущен', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Объект запущен', description: 'Смены на нём теперь могут публиковаться исполнителям.' });
    onChanged();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Запуск объекта</CardTitle>
        <CardDescription>Статус: {SITE_STATUSES[site.status]}. Пока все пункты не закрыты, смены на объекте исполнителям не публикуются.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-2">
          {items.map((i) => (
            <li key={i.item} className="flex items-center gap-3 text-sm">
              {i.done ? <CheckCircle2 className="w-5 h-5 text-primary" aria-label="выполнено" /> : <Circle className="w-5 h-5 text-muted-foreground" aria-label="не выполнено" />}
              <span className={i.done ? '' : 'font-medium'}>{i.label}</span>
            </li>
          ))}
        </ul>
        {site.status === 'launch' && canEdit && (
          <Button onClick={launch} disabled={!allDone || busy}>Запустить объект</Button>
        )}
        {site.status === 'launch' && !allDone && (
          <p className="text-xs text-muted-foreground">Незакрытые пункты: заполните данные и QR, подтвердите документы; тариф и приглашение менеджеров заказчика оформляются в карточке заказчика.</p>
        )}
      </CardContent>
    </Card>
  );
};
