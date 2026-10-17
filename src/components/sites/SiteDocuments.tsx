import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/db';
import type { Site } from '@/lib/sitesMeta';

interface DocType { id: string; name: string }

export const SiteDocuments: React.FC<{ site: Site; canEdit: boolean; onChanged: () => void }> = ({ site, canEdit, onChanged }) => {
  const { toast } = useToast();
  const [types, setTypes] = useState<DocType[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const [t, r] = await Promise.all([
      db('directories').select('id,name').eq('org_id', site.org_id).eq('kind', 'document_type').eq('is_active', true).order('sort_order'),
      db('site_required_documents').select('document_type_id').eq('site_id', site.id),
    ]);
    if (t.error || r.error) { toast({ title: 'Не удалось загрузить документы', description: (t.error ?? r.error).message, variant: 'destructive' }); return; }
    setTypes(t.data ?? []);
    setChosen(new Set((r.data ?? []).map((x: { document_type_id: string }) => x.document_type_id)));
  }, [site.id, site.org_id, toast]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (id: string, on: boolean) => {
    const { error } = on
      ? await db('site_required_documents').insert({ org_id: site.org_id, site_id: site.id, document_type_id: id })
      : await db('site_required_documents').delete().eq('site_id', site.id).eq('document_type_id', id);
    if (error) { toast({ title: 'Не удалось изменить', description: error.message, variant: 'destructive' }); return; }
    load();
  };

  const confirm = async (on: boolean) => {
    const { error } = await db('sites').update({ required_docs_confirmed: on }).eq('id', site.id);
    if (error) toast({ title: 'Не удалось сохранить', description: error.message, variant: 'destructive' });
    else onChanged();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Обязательные документы</CardTitle>
        <CardDescription>
          Исполнителя без действующего документа из списка нельзя назначить на этот объект. Документы, обязательные для позиции, задаёт администратор.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2">
          {types.map((t) => (
            <label key={t.id} className="flex items-center gap-2 text-sm">
              <Checkbox checked={chosen.has(t.id)} disabled={!canEdit} onCheckedChange={(on) => toggle(t.id, on === true)} />
              {t.name}
            </label>
          ))}
        </div>
        <label className="flex items-center gap-3 text-sm">
          <Switch checked={site.required_docs_confirmed} disabled={!canEdit} onCheckedChange={confirm} />
          Список подтверждён (допустимо, если дополнительных документов не нужно)
        </label>
      </CardContent>
    </Card>
  );
};
