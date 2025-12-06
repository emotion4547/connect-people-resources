import React, { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { AvatarUpload } from '@/components/AvatarUpload';
import { Save } from 'lucide-react';

const WorkerProfile: React.FC = () => {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  
  const [loading, setLoading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    fullName: '',
    phone: '',
    city: '',
    experience: '',
    preferredSchedule: '',
    preferredPositions: '',
  });

  useEffect(() => {
    if (profile) {
      setFormData({
        fullName: profile.full_name || '',
        phone: profile.phone || '',
        city: profile.city || '',
        experience: profile.experience || '',
        preferredSchedule: profile.preferred_schedule || '',
        preferredPositions: profile.preferred_positions?.join(', ') || '',
      });
      setAvatarUrl(profile.avatar_url || null);
    }
  }, [profile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!user) {
      toast({
        title: 'Ошибка',
        description: 'Необходимо авторизоваться',
        variant: 'destructive',
      });
      return;
    }

    if (!formData.fullName || !formData.phone || !formData.city) {
      toast({
        title: 'Ошибка',
        description: 'Заполните обязательные поля',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: formData.fullName,
          phone: formData.phone,
          city: formData.city,
          experience: formData.experience || null,
          preferred_schedule: formData.preferredSchedule || null,
          preferred_positions: formData.preferredPositions
            ? formData.preferredPositions.split(',').map(s => s.trim())
            : null,
        })
        .eq('user_id', user.id);

      if (error) throw error;

      toast({
        title: 'Профиль сохранен!',
        description: 'Ваши данные успешно обновлены',
      });
    } catch (error: any) {
      console.error('Error updating profile:', error);
      toast({
        title: 'Ошибка',
        description: 'Не удалось сохранить профиль',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <DashboardLayout role="worker">
      <div className="max-w-2xl mx-auto animate-slide-up">
        <Card className="shadow-card">
          <CardHeader>
            <div className="flex items-center gap-4">
              {user && (
                <AvatarUpload
                  userId={user.id}
                  currentAvatarUrl={avatarUrl}
                  userName={formData.fullName}
                  onAvatarChange={setAvatarUrl}
                  size="lg"
                />
              )}
              <div>
                <CardTitle className="text-2xl">Моя анкета</CardTitle>
                <CardDescription>
                  Заполните профиль для получения предложений о работе
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Full Name */}
              <div>
                <Label htmlFor="fullName">ФИО *</Label>
                <Input
                  id="fullName"
                  placeholder="Иванов Иван Иванович"
                  value={formData.fullName}
                  onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                />
              </div>

              {/* Phone */}
              <div>
                <Label htmlFor="phone">Телефон *</Label>
                <Input
                  id="phone"
                  placeholder="+7 (999) 123-45-67"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                />
              </div>

              {/* City */}
              <div>
                <Label htmlFor="city">Город *</Label>
                <Input
                  id="city"
                  placeholder="Москва"
                  value={formData.city}
                  onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                />
              </div>

              {/* Experience */}
              <div>
                <Label htmlFor="experience">Опыт работы</Label>
                <Textarea
                  id="experience"
                  placeholder="Опишите ваш опыт работы"
                  value={formData.experience}
                  onChange={(e) => setFormData({ ...formData, experience: e.target.value })}
                  rows={3}
                />
              </div>

              {/* Preferred Schedule */}
              <div>
                <Label htmlFor="preferredSchedule">Предпочтительный график</Label>
                <Input
                  id="preferredSchedule"
                  placeholder="Полный день, 5/2, выходные"
                  value={formData.preferredSchedule}
                  onChange={(e) => setFormData({ ...formData, preferredSchedule: e.target.value })}
                />
              </div>

              {/* Preferred Positions */}
              <div>
                <Label htmlFor="preferredPositions">Предпочитаемые должности</Label>
                <Input
                  id="preferredPositions"
                  placeholder="Грузчик, Сортировщик, Упаковщик"
                  value={formData.preferredPositions}
                  onChange={(e) => setFormData({ ...formData, preferredPositions: e.target.value })}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Укажите через запятую
                </p>
              </div>

              {/* Submit */}
              <Button type="submit" className="w-full btn-hover gap-2" disabled={loading}>
                {loading ? (
                  <span className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                Сохранить профиль
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default WorkerProfile;
