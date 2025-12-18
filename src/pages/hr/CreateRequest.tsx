import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Send, X, Info, FileText, PenLine } from 'lucide-react';
import PageMeta from '@/components/PageMeta';

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

const positions = [
  'Сортировщик',
  'Упаковщик',
  'Грузчик',
  'Комплектовщик',
  'Кладовщик',
  'Разнорабочий',
];

const CUSTOM_POSITION = '__custom__';

const CreateRequest: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [loading, setLoading] = useState(false);
  const [showModeDialog, setShowModeDialog] = useState(true);
  const [showTemplateSelect, setShowTemplateSelect] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedPosition, setSelectedPosition] = useState('');
  const [customPosition, setCustomPosition] = useState('');
  const [formData, setFormData] = useState({
    startDate: '',
    endDate: '',
    startTime: '09:00',
    endTime: '18:00',
    address: '',
    quantity: 1,
    requirements: '',
    comments: '',
    pay: '',
  });

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    const { data } = await supabase
      .from('request_templates')
      .select('*')
      .order('name');
    setTemplates(data || []);
  };

  const handleSelectTemplate = (template: Template) => {
    const isCustom = !positions.includes(template.position);
    setSelectedPosition(isCustom ? CUSTOM_POSITION : template.position);
    setCustomPosition(isCustom ? template.position : '');
    setFormData({
      ...formData,
      address: template.address || '',
      quantity: template.quantity,
      requirements: template.requirements || '',
      comments: template.comments || '',
      pay: template.pay || '',
      startTime: template.start_time?.slice(0, 5) || '09:00',
      endTime: template.end_time?.slice(0, 5) || '18:00',
    });
    setShowTemplateSelect(false);
    setShowModeDialog(false);
  };

  const handleManualCreate = () => {
    setShowModeDialog(false);
    setShowTemplateSelect(false);
  };

  const getPosition = () => {
    if (selectedPosition === CUSTOM_POSITION) {
      return customPosition.trim();
    }
    return selectedPosition;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const position = getPosition();
    
    if (!user) {
      toast({
        title: 'Ошибка',
        description: 'Необходимо авторизоваться',
        variant: 'destructive',
      });
      return;
    }

    if (!position || !formData.startDate || !formData.endDate || !formData.address) {
      toast({
        title: 'Ошибка',
        description: 'Заполните все обязательные поля',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase
        .from('requests')
        .insert({
          hr_id: user.id,
          position: position,
          start_date: formData.startDate,
          end_date: formData.endDate,
          start_time: formData.startTime,
          end_time: formData.endTime,
          address: formData.address,
          quantity: formData.quantity,
          requirements: formData.requirements || null,
          comments: formData.comments || null,
          pay: formData.pay || null,
          status: 'new',
        })
        .select()
        .single();

      if (error) throw error;

      let webhookSuccess = false;
      try {
        const { data: webhookResult } = await supabase.functions.invoke('send-webhook', {
          body: { request_id: data.id, test_mode: false }
        });
        webhookSuccess = webhookResult?.success === true;
      } catch (webhookError) {
        console.error('Webhook error:', webhookError);
      }

      toast({
        title: 'Заявка создана!',
        description: webhookSuccess 
          ? 'Опубликовано в Telegram и VK!' 
          : 'Заявка создана. Публикация в соцсетях недоступна.',
      });

      navigate('/hr/requests');
    } catch (error: any) {
      console.error('Error creating request:', error);
      toast({
        title: 'Ошибка',
        description: 'Не удалось создать заявку',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <DashboardLayout role="hr">
      <PageMeta title="Создать заявку" description="Создание новой заявки на персонал" />
      {/* Mode Selection Dialog */}
      <Dialog open={showModeDialog} onOpenChange={(open) => !open && navigate('/hr/requests')}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Создание заявки</DialogTitle>
            <DialogDescription>Выберите способ создания заявки</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <Button
              variant="outline"
              className="h-auto py-6 flex flex-col gap-2"
              onClick={() => {
                setShowModeDialog(false);
                setShowTemplateSelect(true);
              }}
              disabled={templates.length === 0}
            >
              <FileText className="w-8 h-8 text-primary" />
              <span className="font-medium">Из шаблона</span>
              <span className="text-xs text-muted-foreground">
                {templates.length > 0 ? `${templates.length} шаблонов` : 'Нет сохраненных шаблонов'}
              </span>
            </Button>
            <Button
              variant="outline"
              className="h-auto py-6 flex flex-col gap-2"
              onClick={handleManualCreate}
            >
              <PenLine className="w-8 h-8 text-secondary" />
              <span className="font-medium">Создать вручную</span>
              <span className="text-xs text-muted-foreground">Заполнить все поля с нуля</span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Template Selection Dialog */}
      <Dialog open={showTemplateSelect} onOpenChange={setShowTemplateSelect}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Выберите шаблон</DialogTitle>
            <DialogDescription>Данные из шаблона заполнят форму</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-4">
            {templates.map(template => (
              <Button
                key={template.id}
                variant="outline"
                className="w-full justify-start h-auto py-3"
                onClick={() => handleSelectTemplate(template)}
              >
                <div className="text-left">
                  <p className="font-medium">{template.name}</p>
                  <p className="text-xs text-muted-foreground">{template.position}</p>
                </div>
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Request Form */}
      {!showModeDialog && !showTemplateSelect && (
        <div className="max-w-2xl mx-auto animate-slide-up">
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-2xl">Новая заявка на персонал</CardTitle>
              <CardDescription>
                Заполните форму для создания заявки на подбор персонала
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-3">
                  <Label htmlFor="position">Должность *</Label>
                  <Select
                    value={selectedPosition}
                    onValueChange={(value) => {
                      setSelectedPosition(value);
                      if (value !== CUSTOM_POSITION) {
                        setCustomPosition('');
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите должность" />
                    </SelectTrigger>
                    <SelectContent>
                      {positions.map((pos) => (
                        <SelectItem key={pos} value={pos}>{pos}</SelectItem>
                      ))}
                      <SelectItem value={CUSTOM_POSITION}>Другая (указать)</SelectItem>
                    </SelectContent>
                  </Select>
                  
                  {selectedPosition === CUSTOM_POSITION && (
                    <Input
                      placeholder="Введите название должности"
                      value={customPosition}
                      onChange={(e) => setCustomPosition(e.target.value)}
                    />
                  )}
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="startDate">Дата начала *</Label>
                    <Input
                      id="startDate"
                      type="date"
                      value={formData.startDate}
                      onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="endDate">Дата окончания *</Label>
                    <Input
                      id="endDate"
                      type="date"
                      value={formData.endDate}
                      onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="startTime">Время начала</Label>
                    <Input
                      id="startTime"
                      type="time"
                      value={formData.startTime}
                      onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="endTime">Время окончания</Label>
                    <Input
                      id="endTime"
                      type="time"
                      value={formData.endTime}
                      onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="address">Адрес объекта *</Label>
                  <Input
                    id="address"
                    placeholder="Москва, ул. Ленина, 10"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  />
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="quantity">Количество сотрудников</Label>
                    <Input
                      id="quantity"
                      type="number"
                      min={1}
                      value={formData.quantity}
                      onChange={(e) => setFormData({ ...formData, quantity: parseInt(e.target.value) || 1 })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="pay">Оплата за смену</Label>
                    <Input
                      id="pay"
                      placeholder="3500 ₽"
                      value={formData.pay}
                      onChange={(e) => setFormData({ ...formData, pay: e.target.value })}
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="requirements">Требования к кандидату</Label>
                  <Textarea
                    id="requirements"
                    placeholder="Опыт работы, физическая подготовка и т.д."
                    value={formData.requirements}
                    onChange={(e) => setFormData({ ...formData, requirements: e.target.value })}
                    rows={3}
                  />
                </div>

                <div>
                  <Label htmlFor="comments">Внутренние комментарии</Label>
                  <Textarea
                    id="comments"
                    placeholder="Комментарии для менеджера (не публикуются)"
                    value={formData.comments}
                    onChange={(e) => setFormData({ ...formData, comments: e.target.value })}
                    rows={2}
                  />
                </div>

                <div className="flex items-start gap-3 p-4 bg-secondary/10 rounded-xl">
                  <Info className="w-5 h-5 text-secondary flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-muted-foreground">
                    Заявка автоматически опубликуется в Telegram и VK после создания
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                  <Button type="submit" className="btn-hover gap-2 flex-1 order-1 sm:order-none" disabled={loading}>
                    {loading ? (
                      <span className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                    Создать заявку
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => navigate('/hr/requests')}
                    className="gap-2 order-2 sm:order-none"
                  >
                    <X className="w-4 h-4" />
                    Отмена
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </DashboardLayout>
  );
};

export default CreateRequest;
