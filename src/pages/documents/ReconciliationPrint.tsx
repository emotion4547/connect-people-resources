import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { db, rpc } from '@/lib/db';
import { fmtDate, fmtMoney } from '@/lib/format';
import PageMeta from '@/components/PageMeta';

interface Row { row_kind: string; row_date: string; title: string; debit: number | null; credit: number | null; balance: number | null }

// Акт сверки за период одной страницей; в PDF — через печать браузера (Б-9).
const ReconciliationPrint: React.FC = () => {
  const { clientId } = useParams();
  const [params] = useSearchParams();
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const [rows, setRows] = useState<Row[]>([]);
  const [client, setClient] = useState<{ name: string; legal_name: string | null; inn: string | null } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const [r, c] = await Promise.all([
        rpc('client_reconciliation', { _client_id: clientId, _from: from, _to: to }),
        db('clients').select('name,legal_name,inn').eq('id', clientId).maybeSingle(),
      ]);
      if (r.error) { setError(r.error.message); return; }
      setRows(r.data ?? []); setClient(c.data);
    })();
  }, [clientId, from, to]);

  if (error) return <p className="p-6 text-destructive">{error}</p>;
  const closing = rows.find((r) => r.row_kind === 'closing');

  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-black print:p-0">
      <PageMeta title="Акт сверки" description="Акт сверки взаиморасчётов" />
      <button className="mb-4 rounded border px-3 py-1 text-sm print:hidden" onClick={() => window.print()}>Печать / сохранить в PDF</button>
      <h1 className="text-xl font-bold">Акт сверки взаимных расчётов</h1>
      <p className="mb-4 text-sm">за период {fmtDate(from)} — {fmtDate(to)}<br />с {client?.legal_name ?? client?.name}{client?.inn ? `, ИНН ${client.inn}` : ''}</p>
      <table className="w-full border-collapse text-sm">
        <thead><tr className="border-b"><th className="text-left">Дата</th><th className="text-left">Операция</th><th className="text-right">Счета (долг +)</th><th className="text-right">Оплаты (долг −)</th><th className="text-right">Сальдо</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b">
              <td>{fmtDate(r.row_date)}</td><td>{r.title}</td>
              <td className="text-right">{r.debit ? fmtMoney(r.debit) : ''}</td><td className="text-right">{r.credit ? fmtMoney(r.credit) : ''}</td>
              <td className="text-right">{r.balance !== null ? fmtMoney(r.balance) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-4 text-sm">
        {closing && (Number(closing.balance) > 0 ? `Задолженность заказчика на ${fmtDate(to)}: ${fmtMoney(closing.balance)}.` : Number(closing.balance) < 0 ? `Переплата заказчика на ${fmtDate(to)}: ${fmtMoney(-Number(closing.balance))}.` : `Взаимных обязательств на ${fmtDate(to)} нет.`)}
      </p>
      <div className="mt-12 grid grid-cols-2 gap-6 text-sm"><div>От исполнителя ______________<br />М.П.</div><div>От заказчика ______________<br />М.П.</div></div>
    </div>
  );
};

export default ReconciliationPrint;
