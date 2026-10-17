import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { db, rpc } from '@/lib/db';
import { fmtDate, fmtMoney } from '@/lib/format';
import PageMeta from '@/components/PageMeta';

interface Row { month: string; accrued: number; paid: number }
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

// Справка о заработке (В-12): печатается в PDF средствами браузера.
const WorkerCertificate: React.FC = () => {
  const [params] = useSearchParams();
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const { user, profile } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [org, setOrg] = useState<{ name: string; inn: string | null } | null>(null);
  const [fullName, setFullName] = useState('');

  useEffect(() => {
    (async () => {
      const [r, w] = await Promise.all([rpc('worker_income_certificate', { _from: from, _to: to }), db('workers').select('full_name,org_id').eq('user_id', user?.id).maybeSingle()]);
      setRows(r.data ?? []);
      setFullName(w.data?.full_name ?? profile?.full_name ?? '');
      if (w.data?.org_id) { const o = await db('organizations').select('name,inn').eq('id', w.data.org_id).maybeSingle(); setOrg(o.data); }
    })();
  }, [from, to, user?.id, profile?.full_name]);

  const sum = (k: keyof Row) => rows.reduce((s, r) => s + Number(r[k]), 0);

  return (
    <div className="mx-auto max-w-2xl bg-white p-8 text-black print:p-0">
      <PageMeta title="Справка о заработке" description="Справка о заработке за период" />
      <button className="mb-4 rounded border px-3 py-1 text-sm print:hidden" onClick={() => window.print()}>Печать / сохранить в PDF</button>
      <h1 className="text-xl font-bold">Справка о заработке</h1>
      <p className="mb-4 text-sm">Выдана {fullName} в том, что за период с {fmtDate(from)} по {fmtDate(to)} в {org?.name}{org?.inn ? ` (ИНН ${org.inn})` : ''} ему начислено и выплачено:</p>
      <table className="w-full border-collapse text-sm">
        <thead><tr className="border-b"><th className="text-left">Месяц</th><th className="text-right">Начислено</th><th className="text-right">Выплачено</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.month} className="border-b"><td className="capitalize">{MONTHS[Number(r.month.slice(5, 7)) - 1]} {r.month.slice(0, 4)}</td><td className="text-right">{fmtMoney(r.accrued)}</td><td className="text-right">{fmtMoney(r.paid)}</td></tr>
          ))}
        </tbody>
        <tfoot><tr><td className="font-semibold">Итого</td><td className="text-right font-semibold">{fmtMoney(sum('accrued'))}</td><td className="text-right font-semibold">{fmtMoney(sum('paid'))}</td></tr></tfoot>
      </table>
      <div className="mt-12 text-sm">Руководитель ______________<br /><span className="text-gray-500">М.П.</span></div>
    </div>
  );
};

export default WorkerCertificate;
