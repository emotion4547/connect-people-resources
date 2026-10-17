import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { db, rpc } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { TIMESHEET_STATUSES, hm, type Timesheet, type TimesheetLine } from '@/lib/timesheetsMeta';

// Печатная форма табеля: шапка, строки по сменам, итог часов и места для подписей представителя заказчика и менеджера.
const TimesheetPrint: React.FC = () => {
  const { id } = useParams();
  const [ts, setTs] = useState<Timesheet | null>(null);
  const [lines, setLines] = useState<TimesheetLine[]>([]);
  const [names, setNames] = useState({ site: '', client: '', org: '' });

  useEffect(() => {
    (async () => {
      const t = await db('timesheets').select('*').eq('id', id).maybeSingle();
      if (!t.data) return;
      setTs(t.data as Timesheet);
      const [s, c, l, o] = await Promise.all([
        db('sites').select('name').eq('id', t.data.site_id).maybeSingle(),
        db('clients').select('name').eq('id', t.data.client_id).maybeSingle(),
        rpc('timesheet_lines', { _timesheet_id: id }),
        db('organizations').select('name').eq('id', t.data.org_id).maybeSingle(),
      ]);
      setNames({ site: s.data?.name ?? '', client: c.data?.name ?? '', org: o.data?.name ?? '' });
      setLines((l.data ?? []) as TimesheetLine[]);
    })();
  }, [id]);

  if (!ts) return <p className="p-6">Загрузка…</p>;
  const total = lines.reduce((s, l) => s + Number(l.approved_hours ?? 0), 0);
  const sorted = [...lines].sort((a, b) => a.shift_date.localeCompare(b.shift_date) || a.worker_name.localeCompare(b.worker_name, 'ru'));

  return (
    <div className="max-w-4xl mx-auto p-8 bg-white text-black print:p-0 text-sm">
      <div className="print:hidden mb-4"><Button onClick={() => window.print()}>Печать / сохранить в PDF</Button></div>
      <h1 className="text-xl font-bold text-center">Табель учёта отработанного времени</h1>
      <p className="text-center mt-1">{fmtDate(ts.period_from)} — {fmtDate(ts.period_to)} · {TIMESHEET_STATUSES[ts.status]}</p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div><span className="text-gray-600">Заказчик: </span>{names.client}</div>
        <div><span className="text-gray-600">Объект: </span>{names.site}</div>
        <div><span className="text-gray-600">Исполнитель услуг: </span>{names.org}</div>
      </div>
      <table className="w-full mt-4 border-collapse">
        <thead>
          <tr className="border-y-2 border-black text-left">
            <th className="py-1 pr-2">№</th><th className="pr-2">Дата</th><th className="pr-2">Исполнитель</th><th className="pr-2">Позиция</th>
            <th className="pr-2 text-center">Приход</th><th className="pr-2 text-center">Уход</th><th className="text-right">Часы</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((l, i) => (
            <tr key={l.assignment_id} className="border-b border-gray-300">
              <td className="py-1 pr-2">{i + 1}</td><td className="pr-2">{fmtDate(l.shift_date)}</td><td className="pr-2">{l.worker_name}</td><td className="pr-2">{l.position_name}</td>
              <td className="pr-2 text-center">{hm(l.check_in_at)}</td><td className="pr-2 text-center">{hm(l.check_out_at)}</td><td className="text-right">{Number(l.approved_hours ?? 0).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr className="border-t-2 border-black font-semibold"><td colSpan={6} className="py-1 text-right pr-2">Итого часов</td><td className="text-right">{total.toFixed(2)}</td></tr></tfoot>
      </table>
      <div className="mt-12 grid grid-cols-2 gap-12">
        <div><div className="border-b border-black h-8" /><p className="mt-1 text-gray-600">Представитель заказчика, подпись, ФИО</p></div>
        <div><div className="border-b border-black h-8" /><p className="mt-1 text-gray-600">Менеджер объекта, подпись, ФИО</p></div>
      </div>
    </div>
  );
};

export default TimesheetPrint;
