import React, { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { PlusCircle, Edit, Trash2, FileText, Save } from 'lucide-react';
import PageMeta from '@/components/PageMeta';
import { TimeInput } from '@/components/TimeInput';
import { POSITIONS as positions, CUSTOM_POSITION } from '@/lib/constants';

interface Template {
  id: string;
  name: string;
  position: string;
  address: string | null;
  quantity: number;
  requirements: string | null;
  comments: string | null;
  pay: string | null;
  start_time: string | null;
  end_time: string | null;
}

const HRTemplates: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedPosition, setSelectedPosition] = useState('');
  const [customPosition, setCustomPosition] = useState('');

  const [formData, setFormData] = useState({
    name: '',
    address: '',
    quantity: 1,
    requirements: '',
    comments: '',
    pay: '',
    startTime: '09:00',
    endTime: '18:00',
  });

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    try {
      const { data, error } = await supabase
        .from('request_templates')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTemplates(data || []);
    } catch (error) {
      console.error('Error fetching templates:', error);
    } finally {
      setLoading(false);
    }
  };

  const openCreateDialog = () => {
    setEditingTemplate(null);
    setSelectedPosition('');
    setCustomPosition('');
    setFormData({
      name: '',
      address: '',
      quantity: 1,
      requirements: '',
      comments: '',
      pay: '',
      startTime: '09:00',
      endTime: '18:00',
    });
    setDialogOpen(true);
  };

  const openEditDialog = (template: Template) => {
    setEditingTemplate(template);
    const isCustom = !positions.includes(template.position);
    setSelectedPosition(isCustom ? CUSTOM_POSITION : template.position);
    setCustomPosition(isCustom ? template.position : '');
    setFormData({
      name: template.name,
      address: template.address || '',
      quantity: template.quantity,
      requirements: template.requirements || '',
      comments: template.comments || '',
      pay: template.pay || '',
      startTime: template.start_time?.slice(0, 5) || '09:00',
      endTime: template.end_time?.slice(0, 5) || '18:00',
    });
    setDialogOpen(true);
  };

  const getPosition = () => {
    if (selectedPosition === CUSTOM_POSITION) {
      return customPosition.trim();
    }
    return selectedPosition;
  };

  const handleSave = async () => {
    const position = getPosition();

    if (!formData.name.trim() || !position) {
      toast({
        title: 'Ошибка',
        description: 'Заполните название и должность',
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);
    try {
      const templateData = {
        hr_id: user!.id,
        name: formData.name.trim(),
        position,
        address: formData.address || null,
        quantity: formData.quantity,
        requirements: formData.requirements || null,
        comments: formData.comments || null,
        pay: formData.pay || null,
        start_time: formData.startTime,
        end_time: formData.endTime,
      };

      if (editingTemplate) {
        const { error } = await supabase
          .from('request_templates')
          .update(templateData)
          .eq('id', editingTemplate.id);
        if (error) throw error;
        toast({ title: 'Шаблон обновлен' });
      } else {
        const { error } = await supabase
          .from('request_templates')
          .insert(templateData);
        if (error) throw error;
        toast({ title: 'Шаблон создан' });
      }

      setDialogOpen(false);
      fetchTemplates();
    } catch (error) {
      console.error('Error saving template:', error);
      toast({
        title: 'Ошибка',
        description: 'Не удалось сохранить шаблон',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Удалить этот шаблон?')) return;

    try {
      const { error } = await supabase
        .from('request_templates')
        .delete()
        .eq('id', id);
      if (error) throw error;
      toast({ title: 'Шаблон удален' });
      fetchTemplates();
    } catch (error) {
      console.error('Error deleting template:', error);
      toast({
        title: 'Ошибка',
        description: 'Не удалось удалить шаблон',
        variant: 'destructive',
      });
    }
  };

  return (
    <DashboardLayout role="hr">
      <PageMeta title="Шаблоны заявок" description="Управление шаблонами заявок на персонал" />
      <div className="space-y-6 animate-slide-up">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold">Шаблоны заявок</h1>
          <Button onClick={openCreateDialog} className="gap-2">
            <PlusCircle className="w-4 h-4" />
            Новый шаблон
          </Button>
        </div>

        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-40 bg-muted animate-shimmer rounded-xl" />
            ))}
          </div>
        ) : templates.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {templates.map(template => (
              <Card key={template.id} className="card-hover">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">{template.name}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-sm text-muted-foreground">{template.position}</p>
                  {template.address && (
                    <p className="text-sm text-muted-foreground">{template.address}</p>
                  )}
                  {template.pay && (
                    <p className="text-sm font-medium text-secondary">{template.pay}</p>
                  )}
                  <div className="flex gap-2 pt-2">
                    <Button variant="outline" size="sm" onClick={() => openEditDialog(template)} className="gap-1">
                      <Edit className="w-3 h-3" />
                      Редактировать
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(template.id)} className="text-destructive hover:text-destructive">
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="py-12">
            <CardContent className="text-center">
              <FileText className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
              <p className="text-muted-foreground mb-2">Шаблонов пока нет</p>
              <Button variant="link" onClick={openCreateDialog}>
                Создать первый шаблон
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingTemplate ? 'Редактировать шаблон' : 'Новый шаблон'}</DialogTitle>
            <DialogDescription>
              Шаблоны помогают быстро создавать типовые заявки
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>Название шаблона *</Label>
              <Input
                placeholder="Например: Склад Восток"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Должность *</Label>
              <Select
                value={selectedPosition}
                onValueChange={(value) => {
                  setSelectedPosition(value);
                  if (value !== CUSTOM_POSITION) setCustomPosition('');
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Выберите должность" />
                </SelectTrigger>
                <SelectContent>
                  {positions.map(pos => (
                    <SelectItem key={pos} value={pos}>{pos}</SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_POSITION}>Другая (указать)</SelectItem>
                </SelectContent>
              </Select>
              {selectedPosition === CUSTOM_POSITION && (
                <Input
                  placeholder="Введите должность"
                  value={customPosition}
                  onChange={(e) => setCustomPosition(e.target.value)}
                />
              )}
            </div>

            <div>
              <Label>Адрес</Label>
              <Input
                placeholder="Москва, ул. Ленина, 10"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Количество</Label>
                <Input
                  type="number"
                  min={1}
                  value={formData.quantity}
                  onChange={(e) => setFormData({ ...formData, quantity: parseInt(e.target.value) || 1 })}
                />
              </div>
              <div>
                <Label>Оплата</Label>
                <Input
                  placeholder="3500 ₽"
                  value={formData.pay}
                  onChange={(e) => setFormData({ ...formData, pay: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Время начала</Label>
                <TimeInput value={formData.startTime} onChange={(v) => setFormData({ ...formData, startTime: v })} />
              </div>
              <div>
                <Label>Время окончания</Label>
                <TimeInput value={formData.endTime} onChange={(v) => setFormData({ ...formData, endTime: v })} />
              </div>
            </div>

            <div>
              <Label>Требования</Label>
              <Textarea
                placeholder="Опыт работы, физическая подготовка и т.д."
                value={formData.requirements}
                onChange={(e) => setFormData({ ...formData, requirements: e.target.value })}
                rows={2}
              />
            </div>

            <div>
              <Label>Комментарии</Label>
              <Textarea
                placeholder="Внутренние комментарии"
                value={formData.comments}
                onChange={(e) => setFormData({ ...formData, comments: e.target.value })}
                rows={2}
              />
            </div>

            <Button onClick={handleSave} disabled={saving} className="w-full gap-2">
              <Save className="w-4 h-4" />
              {saving ? 'Сохранение...' : 'Сохранить'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default HRTemplates;
