import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { rpc } from '@/lib/db';
import { fmtMoney } from '@/lib/format';

interface Row {
  order_id: string;
  planned_client: number; planned_cost: number; planned_margin: number;
  actual_client: number; actual_cost: number; actual_margin: number;
}

const sum = (rows: Row[], key: keyof Row) => rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);

// Маржа заказа: плановая по плановым часам назначенных, фактическая по утверждённым начислениям (Д-6).
export const OrderMargin: React.FC<{ orderId: string; siteId: string; dateFrom: string; dateTo: string }> = ({ orderId, siteId, dateFrom, dateTo }) => {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    rpc('shift_money', { _from: dateFrom, _to: dateTo, _site_id: siteId }).then(({ data }: { data: Row[] | null }) =>
      setRows((data ?? []).filter((r) => r.order_id === orderId)));
  }, [orderId, siteId, dateFrom, dateTo]);

  if (!rows || rows.length === 0) return null;
  const pct = (m: number, c: number) => (c > 0 ? `${((m / c) * 100).toFixed(1)}%` : '—');
  const pc = sum(rows, 'planned_client'), pm = sum(rows, 'planned_margin');
  const ac = sum(rows, 'actual_client'), am = sum(rows, 'actual_margin');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Деньги по заказу</CardTitle>
        <CardDescription>Плановая считается до табеля по плановым часам назначенных. Фактическая — по утверждённым начислениям.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2 text-sm">
        <div className="space-y-1">
          <div className="font-medium">План</div>
          <div>К выставлению: {fmtMoney(pc)}</div>
          <div>Себестоимость: {fmtMoney(sum(rows, 'planned_cost'))}</div>
          <div>Маржа: <span className="font-medium">{fmtMoney(pm)}</span> ({pct(pm, pc)})</div>
        </div>
        <div className="space-y-1">
          <div className="font-medium">Факт</div>
          <div>К выставлению: {fmtMoney(ac)}</div>
          <div>Себестоимость: {fmtMoney(sum(rows, 'actual_cost'))}</div>
          <div>Маржа: <span className="font-medium">{fmtMoney(am)}</span> ({pct(am, ac)})</div>
        </div>
      </CardContent>
    </Card>
  );
};
