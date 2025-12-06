import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Send, X, Info } from 'lucide-react';

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

      // Trigger webhook
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
          ? '✅ Опубликовано в Telegram и VK!' 
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
              {/* Position */}
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

              {/* Dates */}
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

              {/* Time */}
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

              {/* Address */}
              <div>
                <Label htmlFor="address">Адрес объекта *</Label>
                <Input
                  id="address"
                  placeholder="Москва, ул. Ленина, 10"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                />
              </div>

              {/* Quantity and Pay */}
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

              {/* Requirements */}
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

              {/* Comments */}
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

              {/* Info */}
              <div className="flex items-start gap-3 p-4 bg-secondary/10 rounded-xl">
                <Info className="w-5 h-5 text-secondary flex-shrink-0 mt-0.5" />
                <p className="text-sm text-muted-foreground">
                  Заявка автоматически опубликуется в Telegram и VK после создания
                </p>
              </div>

              {/* Buttons */}
              <div className="flex gap-4">
                <Button type="submit" className="btn-hover gap-2 flex-1" disabled={loading}>
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
                  className="gap-2"
                >
                  <X className="w-4 h-4" />
                  Отмена
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default CreateRequest;
