import React, { useMemo, useState } from 'react';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useOrg } from '@/contexts/OrgContext';
import { addDays, monthEnd, monthStart, today } from '@/lib/format';
import PageMeta from '@/components/PageMeta';
import { MetricGrid } from '@/components/analytics/MetricGrid';
import { TrendChart } from '@/components/analytics/TrendChart';

// Все показатели, доступные пользователю, за выбранный период. Дашборды отделов собираются из тех же карточек.
const AnalyticsPage: React.FC = () => {
  const { orgId, orgs } = useOrg();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(monthEnd());
  const [scope, setScope] = useState<'one' | 'all'>('one');
  const ids = useMemo(() => (scope === 'all' ? orgs.map((o) => o.id) : orgId ? [orgId] : []), [scope, orgs, orgId]);
  const preset = (days: number) => { setTo(today()); setFrom(addDays(today(), -(days - 1))); };

  return (
    <AppLayout>
      <PageMeta title="Аналитика" description="Показатели работы компании" />
      <div className="max-w-6xl mx-auto space-y-6 animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold mb-2">Аналитика</h1>
          <p className="text-muted-foreground">Каждый показатель считается на сервере по единому определению. Нажмите на число, чтобы увидеть записи, из которых оно сложилось.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div><Label htmlFor="a-from">С</Label><Input id="a-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label htmlFor="a-to">По</Label><Input id="a-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <Button variant="outline" onClick={() => preset(7)}>7 дней</Button>
          <Button variant="outline" onClick={() => preset(30)}>30 дней</Button>
          <Button variant="outline" onClick={() => { setFrom(monthStart()); setTo(monthEnd()); }}>Месяц</Button>
          {orgs.length > 1 && (
            <Select value={scope} onValueChange={(v) => setScope(v as 'one' | 'all')}>
              <SelectTrigger className="w-60" aria-label="Организации"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="one">Текущая организация</SelectItem><SelectItem value="all">Все мои организации (суммарно)</SelectItem></SelectContent>
            </Select>
          )}
        </div>
        <MetricGrid orgIds={ids} from={from} to={to} />
        <TrendChart orgIds={ids} />
      </div>
    </AppLayout>
  );
};

export default AnalyticsPage;
