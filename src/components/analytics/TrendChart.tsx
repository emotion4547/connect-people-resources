import React, { useEffect, useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { rpc } from '@/lib/db';
import { addDays, today } from '@/lib/format';

interface SeriesRow { bucket: string; needed: number | null; confirmed: number | null; revenue: number | null; margin: number | null }
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

interface Props { orgIds: string[]; clientId?: string | null; title?: string }

// 12 месяцев: выручка и маржа столбцами, укомплектованность линией. Данные берутся из готовых агрегатов по дням (Ан-3).
export const TrendChart: React.FC<Props> = ({ orgIds, clientId = null, title = 'Динамика за 12 месяцев' }) => {
  const [rows, setRows] = useState<{ label: string; revenue: number; margin: number; staffing: number | null }[] | null>(null);

  useEffect(() => {
    if (!orgIds.length) return;
    const from = `${addDays(today(), -365).slice(0, 7)}-01`;
    rpc('analytics_series', { _org_ids: orgIds, _from: from, _to: today(), _bucket: 'month', _client_id: clientId }).then(({ data, error }: { data: SeriesRow[] | null; error: unknown }) => {
      if (error || !data) { setRows([]); return; }
      setRows(data.map((r) => {
        const needed = num(r.needed) ?? 0;
        return {
          label: `${MONTHS[Number(r.bucket.slice(5, 7)) - 1]} ${r.bucket.slice(2, 4)}`,
          revenue: num(r.revenue) ?? 0,
          margin: num(r.margin) ?? 0,
          staffing: needed > 0 ? Math.round(((num(r.confirmed) ?? 0) / needed) * 1000) / 10 : null,
        };
      }));
    });
  }, [orgIds, clientId]);

  if (!rows || !rows.length) return null;
  return (
    <Card>
      <CardHeader><CardTitle className="text-lg">{title}</CardTitle></CardHeader>
      <CardContent>
        <div style={{ width: '100%', height: 280 }} role="img" aria-label="График выручки, маржи и укомплектованности по месяцам">
          <ResponsiveContainer>
            <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" fontSize={12} />
              <YAxis yAxisId="money" fontSize={12} tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)} т` : String(v))} />
              <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} fontSize={12} unit="%" />
              <Tooltip formatter={(v: number, name: string) => (name === 'Укомплектованность' ? `${v}%` : `${Number(v).toLocaleString('ru-RU')} ₽`)} />
              <Legend />
              <Bar yAxisId="money" dataKey="revenue" name="Выручка" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
              <Bar yAxisId="money" dataKey="margin" name="Маржа" fill="hsl(var(--secondary-foreground))" radius={[3, 3, 0, 0]} />
              <Line yAxisId="pct" type="monotone" dataKey="staffing" name="Укомплектованность" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
};
