import React, { useCallback, useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useOrg } from '@/contexts/OrgContext';
import { db } from '@/lib/db';
import { UNITS } from '@/lib/clientsMeta';
import PageMeta from '@/components/PageMeta';

interface Position { id: string; name: string; description: string | null; requirements: string | null; default_unit: string; is_active: boolean; sort_order: number }
interface DocType { id: string; name: string }

const AdminPositions: React.FC = () => {
  const { toast } = useToast();
  const { orgId } = useOrg();
  const [positions, setPositions] = useState<Position[]>([]);
  const [types, setTypes] = useState<DocType[]>([]);
  const [required, setRequired] = useState<Map<string, Set<string>>>(new Map());
  const [name, setName] = useState('');
  const [edit, setEdit] = useState<Position | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    const [p, t, r] = await Promise.all([
      db('positions').select('*').eq('org_id', orgId).order('sort_order').order('name'),
      db('directories').select('id,name').eq('org_id', orgId).eq('kind', 'document_type').eq('is_active', true).order('sort_order'),
      db('position_required_documents').select('position_id,document_type_id').eq('org_id', orgId),
    ]);
    if (p.error) { toast({ title: 'Не удалось загрузить позиции', description: p.error.message, variant: 'destructive' }); return; }
    setPositions(p.data ?? []);
    setTypes(t.data ?? []);
    const map = new Map<string, Set<string>>();
    (r.data ?? []).forEach((x: { position_id: string; document_type_id: string }) => {
      if (!map.has(x.position_id)) map.set(x.position_id, new Set());
      map.get(x.position_id)!.add(x.document_type_id);
    });
    setRequired(map);
  }, [orgId, toast]);

  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!orgId || !name.trim()) return;
    const { error } = await db('positions').insert({ org_id: orgId, name: name.trim(), sort_order: positions.length + 1 });
    if (error) { toast({ title: error.code === '23505' ? 'Такая позиция уже есть' : 'Не удалось добавить', description: error.code === '23505' ? undefined : error.message, variant: 'destructive' }); return; }
    setName('');
    load();
  };

  const toggleActive = async (p: Position, on: boolean) => {
    const { error } = await db('positions').update({ is_active: on }).eq('id', p.id);
    if (error) toast({ title: 'Не удалось изменить', description: error.message, variant: 'destructive' }); else load();
  };

  const saveEdit = async () => {
    if (!edit) return;
    const { error } = await db('positions').update({
      name: edit.name.trim(), description: edit.description || null, requirements: edit.requirements || null, default_unit: edit.default_unit,
    }).eq('id', edit.id);
    if (error) { toast({ title: 'Не удалось сохранить', description: error.message, variant: 'destructive' }); return; }
    setEdit(null);
    load();
  };

  const toggleDoc = async (positionId: string, docId: string, on: boolean) => {
    if (!orgId) return;
    const { error } = on
      ? await db('position_required_documents').insert({ org_id: orgId, position_id: positionId, document_type_id: docId })
      : await db('position_required_documents').delete().eq('position_id', positionId).eq('document_type_id', docId);
    if (error) toast({ title: 'Не удалось изменить', description: error.message, variant: 'destructive' }); else load();
  };

  return (
    <DashboardLayout role="admin">
      <PageMeta title="Позиции" description="Виды работ и обязательные документы" />
      <div className="max-w-4xl mx-auto space-y-6 animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold mb-2">Позиции</h1>
          <p className="text-muted-foreground">Виды работ: по ним заводятся тарифы и заказы. Позиции не удаляются, а скрываются.</p>
        </div>
        <Card>
          <CardContent className="pt-6 space-y-4">
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
              <Input placeholder="Новая позиция" aria-label="Новая позиция" value={name} onChange={(e) => setName(e.target.value)} />
              <Button type="submit" disabled={!name.trim()}>Добавить</Button>
            </form>
            <Table>
              <TableHeader><TableRow><TableHead>Позиция</TableHead><TableHead>Единица</TableHead><TableHead>Документы</TableHead><TableHead className="w-28">В выборе</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {positions.map((p) => (
                  <TableRow key={p.id} className={p.is_active ? '' : 'opacity-50'}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>{UNITS[p.default_unit]}</TableCell>
                    <TableCell>{required.get(p.id)?.size ?? 0}</TableCell>
                    <TableCell><Switch checked={p.is_active} onCheckedChange={(on) => toggleActive(p, on)} aria-label={`${p.name}: в выборе`} /></TableCell>
                    <TableCell><Button variant="outline" size="sm" onClick={() => setEdit(p)}>Изменить</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!edit} onOpenChange={(open) => !open && setEdit(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Позиция</DialogTitle>
            <DialogDescription>Исполнителя без действующего документа из списка нельзя назначить на эту позицию.</DialogDescription>
          </DialogHeader>
          {edit && (
            <div className="space-y-4">
              <div className="space-y-2"><Label htmlFor="p-name">Название</Label><Input id="p-name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
              <div className="space-y-2"><Label htmlFor="p-desc">Описание работ</Label><Input id="p-desc" value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></div>
              <div className="space-y-2"><Label htmlFor="p-req">Требования</Label><Input id="p-req" value={edit.requirements ?? ''} onChange={(e) => setEdit({ ...edit, requirements: e.target.value })} /></div>
              <div className="space-y-2">
                <Label>Единица по умолчанию</Label>
                <Select value={edit.default_unit} onValueChange={(v) => setEdit({ ...edit, default_unit: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(UNITS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Обязательные документы</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {types.map((t) => (
                    <label key={t.id} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={required.get(edit.id)?.has(t.id) ?? false} onCheckedChange={(on) => toggleDoc(edit.id, t.id, on === true)} />
                      {t.name}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(null)}>Закрыть</Button>
            <Button onClick={saveEdit}>Сохранить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default AdminPositions;
