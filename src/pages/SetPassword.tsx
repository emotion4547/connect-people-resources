import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import PageMeta from '@/components/PageMeta';

const MIN_LENGTH = 8;

// Сюда ведёт ссылка из приглашения сотрудника и из сброса пароля: по ссылке человек уже
// вошёл в систему, остаётся задать пароль.
const SetPassword: React.FC = () => {
  const { user, role, loading } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Ссылка из письма разбирается клиентом не мгновенно: ждём окончания загрузки сессии.
  const [waited, setWaited] = useState(false);
  useEffect(() => { const t = setTimeout(() => setWaited(true), 2500); return () => clearTimeout(t); }, []);

  const home = () => {
    if (role === 'hr') return '/hr/dashboard';
    if (role === 'worker') return '/worker/dashboard';
    if (role === 'admin') return '/admin/dashboard';
    return '/workspace';
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < MIN_LENGTH) { setError(`Пароль не короче ${MIN_LENGTH} символов`); return; }
    if (password !== repeat) { setError('Пароли не совпадают'); return; }
    setError('');
    setSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    toast({ title: 'Пароль установлен' });
    navigate(home(), { replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <PageMeta title="Установка пароля" description="Установите пароль для входа" />
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Установите пароль</CardTitle>
          <CardDescription>Этим паролем вы будете входить в систему.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading || (!user && !waited) ? (
            <p className="text-muted-foreground">Проверяем ссылку…</p>
          ) : !user ? (
            <div className="space-y-3">
              <p className="text-destructive">Ссылка недействительна или уже использована.</p>
              <p className="text-sm text-muted-foreground">Попросите администратора выдать новую ссылку.</p>
              <Button variant="outline" onClick={() => navigate('/login')}>К входу</Button>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={submit}>
              <div className="space-y-2">
                <Label htmlFor="new-password">Новый пароль</Label>
                <Input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="repeat-password">Повторите пароль</Label>
                <Input id="repeat-password" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
              </div>
              {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
              <Button type="submit" className="w-full" disabled={saving}>{saving ? 'Сохранение…' : 'Сохранить пароль'}</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default SetPassword;
