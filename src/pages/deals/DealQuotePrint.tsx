import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { db } from '@/lib/db';
import { fmtDate, fmtMoney } from '@/lib/format';
import type { Deal, Quote } from '@/lib/dealMeta';

// Печатная форма КП: ставки заказчику и условия. Ставки исполнителей сюда не попадают. Сохраняется в PDF средствами браузера.
const DealQuotePrint: React.FC = () => {
  const { id, version } = useParams();
  const [deal, setDeal] = useState<Deal | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [positions, setPositions] = useState<Record<string, string>>({});
  const [org, setOrg] = useState<{ name: string; inn: string | null } | null>(null);

  useEffect(() => {
    (async () => {
      const [d, q, p] = await Promise.all([
        db('deals').select('*').eq('id', id).maybeSingle(),
        db('deal_quotes').select('*').eq('deal_id', id).eq('version', Number(version)).maybeSingle(),
        db('positions').select('id,name'),
      ]);
      setDeal(d.data as Deal | null); setQuote(q.data as Quote | null);
      setPositions(Object.fromEntries(((p.data ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name])));
      if (d.data) { const o = await db('organizations').select('name, inn').eq('id', (d.data as Deal).org_id).maybeSingle(); setOrg(o.data as { name: string; inn: string | null } | null); }
    })();
  }, [id, version]);

  if (!deal || !quote) return <p className="p-6">Загрузка…</p>;
  const monthly = quote.lines.reduce((s, l) => s + l.client_rate * l.hours_per_month, 0);

  return (
    <div className="max-w-3xl mx-auto p-8 bg-white text-black print:p-0">
      <div className="print:hidden mb-4 flex gap-2"><Button onClick={() => window.print()}>Печать / сохранить в PDF</Button></div>
      <h1 className="text-2xl font-bold">Коммерческое предложение № {deal.id.slice(0, 6).toUpperCase()}-{quote.version}</h1>
      <p className="text-sm text-gray-600 mt-1">{org?.name}{org?.inn ? `, ИНН ${org.inn}` : ''} · от {fmtDate(quote.created_at.slice(0, 10))}{quote.valid_until ? ` · действует до ${fmtDate(quote.valid_until)}` : ''}</p>
      <p className="mt-6">Для: <b>{deal.company ?? deal.title}</b>{deal.contact_name ? `, ${deal.contact_name}` : ''}</p>
      <table className="w-full mt-6 text-sm border-collapse">
        <thead><tr className="border-b-2 border-black text-left"><th className="py-2">Позиция</th><th className="text-right">Ставка, ₽/час</th><th className="text-right">Человек</th><th className="text-right">Часов в месяц</th><th className="text-right">В месяц, ₽</th></tr></thead>
        <tbody>{quote.lines.map((l, i) => (
          <tr key={i} className="border-b"><td className="py-2">{positions[l.position_id] ?? '—'}</td><td className="text-right">{fmtMoney(l.client_rate)}</td><td className="text-right">{l.headcount}</td><td className="text-right">{l.hours_per_month}</td><td className="text-right">{fmtMoney(l.client_rate * l.hours_per_month)}</td></tr>
        ))}</tbody>
        <tfoot><tr><td colSpan={4} className="py-2 text-right font-semibold">Ориентировочно в месяц</td><td className="text-right font-semibold">{fmtMoney(monthly)}</td></tr></tfoot>
      </table>
      {quote.note && <p className="mt-6 text-sm whitespace-pre-line">{quote.note}</p>}
      <p className="mt-8 text-xs text-gray-500">Ставки указаны за час работы. Окончательная стоимость определяется по подтверждённым табелям.</p>
    </div>
  );
};

export default DealQuotePrint;
