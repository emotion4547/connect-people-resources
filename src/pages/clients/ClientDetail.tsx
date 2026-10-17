import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { usePermissions } from '@/hooks/usePermissions';
import { db } from '@/lib/db';
import { CLIENT_STATUSES, type StaffOption } from '@/lib/clientsMeta';
import { ClientRequisites, type Client } from '@/components/clients/ClientRequisites';
import { ClientContacts } from '@/components/clients/ClientContacts';
import { ClientContracts } from '@/components/clients/ClientContracts';
import { ClientTariffs } from '@/components/clients/ClientTariffs';
import PageMeta from '@/components/PageMeta';
import { ArrowLeft } from 'lucide-react';

const ClientDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { can, loading: permsLoading } = usePermissions();
  const [client, setClient] = useState<Client | null>(null);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  const load = useCallback(async () => {
    if (!id) return;
    const [c, s] = await Promise.all([
      db('clients').select('*').eq('id', id).maybeSingle(),
      db('staff_profiles').select('user_id,full_name,department').eq('is_active', true),
    ]);
    setLoading(false);
    if (c.error) { toast({ title: 'Не удалось загрузить заказчика', description: c.error.message, variant: 'destructive' }); return; }
    setClient(c.data);
    setStaff(s.data ?? []);
    setVersion((v) => v + 1);
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  const canEditClient = can('clients', 'update');
  const canEditTariffs = can('tariffs', 'update') || can('tariffs', 'create');

  return (
    <AppLayout>
      <PageMeta title={client?.name ?? 'Заказчик'} description="Карточка заказчика" />
      <div className="max-w-6xl mx-auto space-y-6 animate-slide-up">
        <Link to="/clients" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Все заказчики
        </Link>

        {loading || permsLoading ? <p className="text-muted-foreground">Загрузка…</p> : !client ? (
          <p className="text-muted-foreground">Заказчик не найден или у вас нет к нему доступа.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-bold">{client.name}</h1>
              <Badge variant={client.status === 'active' ? 'default' : 'secondary'}>{CLIENT_STATUSES[client.status]}</Badge>
            </div>

            <Tabs defaultValue="requisites">
              <TabsList className="flex-wrap h-auto">
                <TabsTrigger value="requisites">Реквизиты</TabsTrigger>
                <TabsTrigger value="contacts">Контакты</TabsTrigger>
                <TabsTrigger value="contracts">Договоры</TabsTrigger>
                {can('tariffs', 'view') && <TabsTrigger value="tariffs">Тарифы</TabsTrigger>}
              </TabsList>
              <TabsContent value="requisites">
                <ClientRequisites key={version} client={client} staff={staff} canEdit={canEditClient} onSaved={load} />
              </TabsContent>
              <TabsContent value="contacts">
                <ClientContacts clientId={client.id} orgId={client.org_id} canEdit={canEditClient} />
              </TabsContent>
              <TabsContent value="contracts">
                <ClientContracts clientId={client.id} orgId={client.org_id} canEdit={canEditClient} />
              </TabsContent>
              <TabsContent value="tariffs">
                <ClientTariffs clientId={client.id} orgId={client.org_id} canEdit={canEditTariffs} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </AppLayout>
  );
};

export default ClientDetail;
