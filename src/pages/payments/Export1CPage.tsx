import React, { useState } from 'react';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useOrg } from '@/contexts/OrgContext';
import { rpc } from '@/lib/db';
import { downloadCsv } from '@/lib/csv';
import { monthEnd, monthStart } from '@/lib/format';
import PageMeta from '@/components/PageMeta';
import { Download } from 'lucide-react';

type Cell = string | number | null | undefined;

interface Export { fn: string; title: string; hint: string; period: boolean; header: string[]; keys: string[] }

const EXPORTS: Export[] = [
  { fn: 'export_1c_documents', title: 'Акты, УПД и счета', hint: 'Выставленные документы за период', period: true,
    header: ['Вид', 'Номер', 'Дата', 'ИНН заказчика', 'КПП', 'Заказчик', 'Договор', 'Период с', 'Период по', 'Сумма без НДС', 'Ставка НДС', 'НДС', 'Итого', 'Статус'],
    keys: ['doc_kind', 'doc_number', 'doc_date', 'client_inn', 'client_kpp', 'client_name', 'contract_number', 'period_from', 'period_to', 'amount_net', 'vat_rate', 'vat_amount', 'amount_total', 'status'] },
  { fn: 'export_1c_document_lines', title: 'Строки документов', hint: 'Номенклатура актов и счетов', period: true,
    header: ['Вид', 'Номер', '№ строки', 'Наименование', 'Количество', 'Ед.', 'Цена', 'Сумма', 'Ставка НДС', 'Примечание'],
    keys: ['doc_kind', 'doc_number', 'line_no', 'item_name', 'quantity', 'unit', 'price', 'amount', 'vat_rate', 'note'] },
  { fn: 'export_1c_payments', title: 'Оплаты', hint: 'Поступления с разнесением по счетам', period: true,
    header: ['Дата', '№ платёжки', 'Сумма', 'ИНН плательщика', 'Плательщик', 'Заказчик', 'Назначение', 'Счета', 'Не разнесено'],
    keys: ['payment_date', 'doc_number', 'amount', 'payer_inn', 'payer_name', 'client_name', 'purpose', 'invoices', 'unallocated'] },
  { fn: 'export_1c_clients', title: 'Справочник заказчиков', hint: 'Реквизиты всех заказчиков', period: false,
    header: ['Название', 'Юр. название', 'ИНН', 'КПП', 'ОГРН', 'Адрес', 'Банк', 'Расчётный счёт', 'БИК'],
    keys: ['client_name', 'legal_name', 'inn', 'kpp', 'ogrn', 'legal_address', 'bank_name', 'bank_account', 'bik'] },
];

const Export1CPage: React.FC = () => {
  const { toast } = useToast();
  const { orgId } = useOrg();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(monthEnd());
  const [busy, setBusy] = useState('');

  const run = async (x: Export) => {
    if (!orgId) return;
    setBusy(x.fn);
    const { data, error } = await rpc(x.fn, x.period ? { _org_id: orgId, _from: from, _to: to } : { _org_id: orgId });
    setBusy('');
    if (error) { toast({ title: 'Выгрузка не получилась', description: error.message, variant: 'destructive' }); return; }
    if (!data?.length) { toast({ title: 'За период нет данных' }); return; }
    downloadCsv(`${x.fn.replace('export_', '')}-${from}-${to}.csv`, x.header, data.map((r: Record<string, Cell>) => x.keys.map((k) => r[k])));
  };

  return (
    <AppLayout>
      <PageMeta title="Выгрузка в 1С" description="Таблицы для загрузки в 1С" />
      <div className="max-w-3xl mx-auto space-y-6 animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold mb-2">Выгрузка в 1С</h1>
          <p className="text-muted-foreground">Таблицы открываются в Excel и загружаются в 1С по шаблону бухгалтерии. Формат (EnterpriseData или таблица) согласуется отдельно.</p>
        </div>
        <div className="flex gap-4">
          <div><Label htmlFor="x-from">С</Label><Input id="x-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label htmlFor="x-to">По</Label><Input id="x-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
        {EXPORTS.map((x) => (
          <Card key={x.fn}>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div><CardTitle className="text-base">{x.title}</CardTitle><CardDescription>{x.hint}</CardDescription></div>
              <Button variant="outline" className="gap-2" disabled={busy === x.fn} onClick={() => run(x)}><Download className="w-4 h-4" /> Скачать</Button>
            </CardHeader>
            <CardContent />
          </Card>
        ))}
      </div>
    </AppLayout>
  );
};

export default Export1CPage;
