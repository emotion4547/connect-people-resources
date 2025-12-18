import React, { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Settings, Send, CheckCircle, XCircle, Code } from 'lucide-react';
import PageMeta from '@/components/PageMeta';

interface WebhookSettings {
  id?: string;
  webhook_url: string;
  is_active: boolean;
}

const AdminSettings: React.FC = () => {
  const { toast } = useToast();
  const [settings, setSettings] = useState<WebhookSettings>({
    webhook_url: '',
    is_active: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('webhook_settings')
        .select('*')
        .maybeSingle();

      if (error) throw error;
      if (data) {
        setSettings(data);
      }
    } catch (error) {
      console.error('Error fetching settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (settings.id) {
        const { error } = await supabase
          .from('webhook_settings')
          .update({
            webhook_url: settings.webhook_url,
            is_active: settings.is_active,
          })
          .eq('id', settings.id);

        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('webhook_settings')
          .insert({
            webhook_url: settings.webhook_url,
            is_active: settings.is_active,
          })
          .select()
          .single();

        if (error) throw error;
        setSettings(data);
      }

      toast({
        title: 'Настройки сохранены',
        description: 'Webhook настройки успешно обновлены',
      });
    } catch (error) {
      console.error('Error saving settings:', error);
      toast({
        title: 'Ошибка',
        description: 'Не удалось сохранить настройки',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!settings.webhook_url) {
      toast({
        title: 'Ошибка',
        description: 'Укажите URL webhook',
        variant: 'destructive',
      });
      return;
    }

    // First save settings to ensure webhook URL is saved
    if (!settings.id || settings.webhook_url !== settings.webhook_url) {
      await handleSave();
    }

    setTesting(true);
    setTestResult(null);

    try {
      const { data: result, error } = await supabase.functions.invoke('send-webhook', {
        body: { request_id: null, test_mode: true }
      });

      if (error) throw error;

      if (result?.success) {
        setTestResult('success');
        toast({
          title: 'Тест успешен',
          description: 'Webhook работает корректно',
        });
      } else {
        throw new Error(result?.message || 'Request failed');
      }
    } catch (error: any) {
      setTestResult('error');
      toast({
        title: 'Тест не пройден',
        description: error.message || 'Не удалось отправить данные на webhook',
        variant: 'destructive',
      });
    } finally {
      setTesting(false);
    }
  };

  const webhookExample = `{
  "id": "abc123",
  "company": "X5 Retail",
  "position": "Сортировщик",
  "date": "2025-12-15",
  "time": "09:00-18:00",
  "address": "Москва, ул. Ленина 10",
  "quantity": 5,
  "requirements": "Без опыта",
  "pay": "3500 руб/смена"
}`;

  return (
    <DashboardLayout role="admin">
      <PageMeta title="Настройки" description="Настройки системы Люди и Ресурсы" />
      <div className="max-w-2xl mx-auto space-y-6 animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold mb-2">Настройки</h1>
          <p className="text-muted-foreground">
            Управление интеграциями и уведомлениями
          </p>
        </div>

        {/* Webhook settings */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Settings className="w-5 h-5 text-primary" />
              </div>
              <div>
                <CardTitle>Автопубликация</CardTitle>
                <CardDescription>
                  Настройка webhook для публикации заявок в Telegram и VK
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {loading ? (
              <div className="space-y-4">
                <div className="h-10 bg-muted animate-shimmer rounded-lg" />
                <div className="h-10 bg-muted animate-shimmer rounded-lg" />
              </div>
            ) : (
              <>
                {/* URL input */}
                <div>
                  <Label htmlFor="webhookUrl">Webhook URL</Label>
                  <Input
                    id="webhookUrl"
                    placeholder="https://your-webhook-endpoint.com/api"
                    value={settings.webhook_url}
                    onChange={(e) => setSettings({ ...settings, webhook_url: e.target.value })}
                  />
                </div>

                {/* Active switch */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Активировать webhook</p>
                    <p className="text-sm text-muted-foreground">
                      Автоматически отправлять заявки на указанный URL
                    </p>
                  </div>
                  <Switch
                    checked={settings.is_active}
                    onCheckedChange={(checked) => setSettings({ ...settings, is_active: checked })}
                  />
                </div>

                {/* Test result */}
                {testResult && (
                  <div className={cn(
                    "flex items-center gap-2 p-3 rounded-lg",
                    testResult === 'success' ? "bg-status-success/10 text-status-success" : "bg-destructive/10 text-destructive"
                  )}>
                    {testResult === 'success' ? (
                      <CheckCircle className="w-5 h-5" />
                    ) : (
                      <XCircle className="w-5 h-5" />
                    )}
                    <span className="text-sm">
                      {testResult === 'success' ? 'Тест пройден успешно' : 'Ошибка при тестировании'}
                    </span>
                  </div>
                )}

                {/* Buttons */}
                <div className="flex gap-3">
                  <Button onClick={handleSave} disabled={saving} className="btn-hover">
                    {saving ? (
                      <span className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                    ) : (
                      'Сохранить'
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleTest}
                    disabled={testing || !settings.webhook_url}
                    className="gap-2"
                  >
                    {testing ? (
                      <span className="w-4 h-4 border-2 border-foreground border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                    Тест webhook
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Webhook format */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-secondary/20 flex items-center justify-center">
                <Code className="w-5 h-5 text-secondary" />
              </div>
              <div>
                <CardTitle>Формат данных</CardTitle>
                <CardDescription>
                  Структура JSON, отправляемого на webhook
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
              <code>{webhookExample}</code>
            </pre>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

// Import cn for styling
import { cn } from '@/lib/utils';

export default AdminSettings;
