import React, { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { db, rpc } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import type { Site } from '@/lib/sitesMeta';

export const SiteQrPanel: React.FC<{ site: Site; canEdit: boolean; onChanged: () => void }> = ({ site, canEdit, onChanged }) => {
  const { toast } = useToast();
  const [payload, setPayload] = useState('');

  useEffect(() => {
    if (!canEdit) return;
    rpc('site_qr_payload', { _site_id: site.id, _rotating: false }).then(({ data, error }: { data: string | null; error: { message: string } | null }) => {
      if (error) toast({ title: 'Не удалось получить код', description: error.message, variant: 'destructive' });
      else setPayload(data ?? '');
    });
  }, [site.id, site.qr_printed_at, canEdit, toast]);

  const markPrinted = async () => {
    const { error } = await db('sites').update({ qr_printed_at: new Date().toISOString() }).eq('id', site.id);
    if (error) toast({ title: 'Не удалось отметить', description: error.message, variant: 'destructive' });
    else onChanged();
  };

  const reissue = async () => {
    const { error } = await rpc('reissue_site_qr', { _site_id: site.id });
    if (error) { toast({ title: 'Не удалось перевыпустить', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'QR перевыпущен', description: 'Старый код больше не принимается. Напечатайте новый.' });
    onChanged();
  };

  if (!canEdit) return <p className="text-muted-foreground">QR объекта доступен менеджеру объекта и руководителю.</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">QR объекта</CardTitle>
        <CardDescription>
          Постоянный код для печатной формы и режим «планшет на объекте», где код меняется каждую минуту: фото кода не поможет отметиться из дома.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-6 items-center">
          {payload ? <div className="bg-white p-3 rounded-md border"><QRCodeSVG value={payload} size={176} /></div> : <p className="text-muted-foreground">Загрузка…</p>}
          <div className="space-y-2 text-sm">
            <p>{site.qr_printed_at ? `Напечатан: ${fmtDate(site.qr_printed_at.slice(0, 10))}` : 'Не напечатан'}</p>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline"><a href={`/sites/${site.id}/qr-print`} target="_blank" rel="noreferrer">Печатная форма A4</a></Button>
              <Button asChild variant="outline"><a href={`/sites/${site.id}/tablet`} target="_blank" rel="noreferrer">Режим планшета</a></Button>
              <Button variant="outline" onClick={markPrinted}>Отметить: напечатан</Button>
              <AlertDialog>
                <AlertDialogTrigger asChild><Button variant="outline">Перевыпустить</Button></AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Перевыпустить QR?</AlertDialogTitle>
                    <AlertDialogDescription>Старый код перестанет работать, а напечатанные листы придётся заменить.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Отмена</AlertDialogCancel>
                    <AlertDialogAction onClick={reissue}>Перевыпустить</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
