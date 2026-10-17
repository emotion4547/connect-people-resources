import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import PageMeta from '@/components/PageMeta';

type Step = 'loading' | 'none' | 'enrolling' | 'verify' | 'enabled';

// Двухфакторный вход (ТЗ, А-6): код из приложения-аутентификатора (TOTP).
const Security: React.FC = () => {
  const { role, signOut } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('loading');
  const [factorId, setFactorId] = useState('');
  const [qr, setQr] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [{ data: factors }, { data: aal }] = await Promise.all([
      supabase.auth.mfa.listFactors(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ]);
    const verified = factors?.totp?.find((f) => f.status === 'verified');
    if (!verified) { setStep('none'); return; }
    setFactorId(verified.id);
    setStep(aal?.currentLevel === 'aal2' ? 'enabled' : 'verify');
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const home = () => {
    if (role === 'hr') return '/hr/dashboard';
    if (role === 'worker') return '/worker/dashboard';
    if (role === 'admin') return '/admin/dashboard';
    return '/workspace';
  };

  const startEnroll = async () => {
    setBusy(true);
    // Недоподтверждённые попытки подключения мешают новой, убираем их.
    const { data: factors } = await supabase.auth.mfa.listFactors();
    for (const f of factors?.all ?? []) {
      if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Приложение-аутентификатор' });
    setBusy(false);
    if (error || !data) {
      toast({ title: 'Не удалось начать подключение', description: error?.message, variant: 'destructive' });
      return;
    }
    setFactorId(data.id);
    setQr(data.totp.qr_code);
    setSecret(data.totp.secret);
    setStep('enrolling');
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    setBusy(false);
    if (error) {
      toast({ title: 'Неверный код', description: 'Проверьте код в приложении и время на телефоне.', variant: 'destructive' });
      return;
    }
    setCode('');
    toast({ title: 'Готово', description: 'Двухфакторный вход подтверждён.' });
    await refresh();
  };

  const disable = async () => {
    setBusy(true);
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    setBusy(false);
    if (error) {
      toast({ title: 'Не удалось отключить', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Двухфакторный вход отключён' });
    await refresh();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <PageMeta title="Безопасность" description="Двухфакторный вход" />
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Двухфакторный вход</CardTitle>
          <CardDescription>
            Вход подтверждается кодом из приложения-аутентификатора на телефоне. Он защищает финансовые и паспортные данные, если пароль станет известен.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 'loading' && <p className="text-muted-foreground">Загрузка…</p>}

          {step === 'none' && (
            <>
              <p className="text-sm">Не подключён. Понадобится приложение-аутентификатор (любое, поддерживающее одноразовые коды TOTP).</p>
              <Button onClick={startEnroll} disabled={busy}>Подключить</Button>
            </>
          )}

          {step === 'enrolling' && (
            <form className="space-y-4" onSubmit={verify}>
              <p className="text-sm">Отсканируйте код в приложении или введите ключ вручную, затем введите шестизначный код.</p>
              <img src={qr} alt="QR-код для приложения-аутентификатора" className="mx-auto w-48 h-48" />
              <p className="text-xs text-muted-foreground break-all text-center">Ключ: <span className="font-mono">{secret}</span></p>
              <div className="space-y-2">
                <Label htmlFor="mfa-code">Код из приложения</Label>
                <Input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
              </div>
              <Button type="submit" disabled={busy || code.trim().length !== 6}>Подтвердить</Button>
            </form>
          )}

          {step === 'verify' && (
            <form className="space-y-4" onSubmit={verify}>
              <p className="text-sm">Введите код из приложения-аутентификатора, чтобы продолжить.</p>
              <div className="space-y-2">
                <Label htmlFor="mfa-code">Код из приложения</Label>
                <Input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={busy || code.trim().length !== 6}>Войти</Button>
                <Button type="button" variant="outline" onClick={() => signOut()}>Выйти</Button>
              </div>
            </form>
          )}

          {step === 'enabled' && (
            <>
              <p className="text-sm text-primary">Двухфакторный вход подключён и подтверждён в этой сессии.</p>
              <div className="flex gap-2">
                <Button onClick={() => navigate(home())}>Продолжить</Button>
                <Button variant="outline" onClick={disable} disabled={busy}>Отключить</Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Security;
