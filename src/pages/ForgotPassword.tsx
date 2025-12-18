import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Mail, CheckCircle } from 'lucide-react';
import { z } from 'zod';

const emailSchema = z.object({
  email: z.string().trim().email('Введите корректный email'),
});

const ForgotPassword: React.FC = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      emailSchema.parse({ email });
    } catch (err) {
      if (err instanceof z.ZodError) {
        setError(err.errors[0]?.message || 'Ошибка валидации');
      }
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) {
        toast({
          title: 'Ошибка',
          description: error.message,
          variant: 'destructive',
        });
        return;
      }

      setSent(true);
      toast({
        title: 'Письмо отправлено',
        description: 'Проверьте вашу почту для восстановления пароля',
      });
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/5 to-secondary/5 flex items-center justify-center p-4">
        <div className="w-full max-w-md animate-scale-in">
          <Card className="shadow-card border-secondary/20">
            <CardContent className="pt-8 pb-8 text-center">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-xl font-semibold mb-2">Письмо отправлено!</h2>
              <p className="text-muted-foreground mb-6">
                Мы отправили инструкции по восстановлению пароля на адрес <strong>{email}</strong>
              </p>
              <p className="text-sm text-muted-foreground mb-6">
                Если письмо не пришло, проверьте папку «Спам»
              </p>
              <Link to="/login">
                <Button variant="outline" className="w-full">
                  Вернуться к входу
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 to-secondary/5 flex items-center justify-center p-4">
      <div className="w-full max-w-md animate-scale-in">
        <Link 
          to="/login" 
          className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Назад к входу
        </Link>

        <Card className="shadow-card border-secondary/20">
          <CardHeader className="text-center pb-4">
            <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center mx-auto mb-4">
              <Mail className="w-7 h-7 text-primary-foreground" />
            </div>
            <CardTitle className="text-2xl">Восстановление пароля</CardTitle>
            <CardDescription>
              Введите email, указанный при регистрации, и мы отправим вам ссылку для сброса пароля
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="example@mail.ru"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={error ? "border-destructive" : ""}
                />
                {error && (
                  <p className="text-xs text-destructive mt-1">{error}</p>
                )}
              </div>

              <Button type="submit" className="w-full btn-hover" disabled={loading}>
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                    Отправка...
                  </span>
                ) : (
                  'Отправить ссылку'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ForgotPassword;
