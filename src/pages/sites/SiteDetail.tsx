import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { db, rpc } from '@/lib/db';
import { SITE_STATUSES, type Site } from '@/lib/sitesMeta';
import type { StaffOption } from '@/lib/clientsMeta';
import { SiteForm } from '@/components/sites/SiteForm';
import { SiteLaunch } from '@/components/sites/SiteLaunch';
import { SiteQrPanel } from '@/components/sites/SiteQrPanel';
import { SiteDocuments } from '@/components/sites/SiteDocuments';
import PageMeta from '@/components/PageMeta';
import { ArrowLeft } from 'lucide-react';

const SiteDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { role } = useAuth();
  const { can, loading: permsLoading } = usePermissions();
  const [site, setSite] = useState<Site | null>(null);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [canEditThis, setCanEditThis] = useState(false);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  const load = useCallback(async () => {
    if (!id) return;
    const [s, c, st] = await Promise.all([
      db('sites').select('*').eq('id', id).maybeSingle(),
      db('clients').select('id,name').order('name'),
      db('staff_profiles').select('user_id,full_name,department').eq('is_active', true),
    ]);
    setLoading(false);
    if (s.error) { toast({ title: 'Не удалось загрузить объект', description: s.error.message, variant: 'destructive' }); return; }
    setSite(s.data);
    setClients(c.data ?? []);
    setStaff(st.data ?? []);
    setVersion((v) => v + 1);
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  // Права на конкретный объект зависят от ответственных; проверяем у базы, а не гадаем по роли:
  // получение QR разрешено только тем, кто вправе править объект.
  useEffect(() => {
    if (!site) return;
    rpc('site_qr_payload', { _site_id: site.id, _rotating: false }).then(({ error }: { error: unknown }) => setCanEditThis(!error));
  }, [site]);

  const canEdit = canEditThis || role === 'admin' || (can('sites', 'update') && can('sites', 'create'));

  return (
    <AppLayout>
      <PageMeta title={site?.name ?? 'Объект'} description="Карточка объекта" />
      <div className="max-w-5xl mx-auto space-y-6 animate-slide-up">
        <Link to="/sites" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Все объекты
        </Link>
        {loading || permsLoading ? <p className="text-muted-foreground">Загрузка…</p> : !site ? (
          <p className="text-muted-foreground">Объект не найден или у вас нет к нему доступа.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-bold">{site.name}</h1>
              <Badge variant={site.status === 'active' ? 'default' : 'secondary'}>{SITE_STATUSES[site.status]}</Badge>
            </div>
            <Tabs defaultValue={site.status === 'launch' ? 'launch' : 'data'}>
              <TabsList className="flex-wrap h-auto">
                <TabsTrigger value="launch">Запуск</TabsTrigger>
                <TabsTrigger value="data">Данные</TabsTrigger>
                <TabsTrigger value="qr">QR</TabsTrigger>
                <TabsTrigger value="docs">Документы</TabsTrigger>
              </TabsList>
              <TabsContent value="launch"><SiteLaunch site={site} canEdit={canEdit} refreshKey={version} onChanged={load} /></TabsContent>
              <TabsContent value="data"><SiteForm key={version} site={site} clients={clients} staff={staff} canEdit={canEdit} onSaved={load} /></TabsContent>
              <TabsContent value="qr"><SiteQrPanel site={site} canEdit={canEdit} onChanged={load} /></TabsContent>
              <TabsContent value="docs"><SiteDocuments site={site} canEdit={canEdit} onChanged={load} /></TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </AppLayout>
  );
};

export default SiteDetail;
