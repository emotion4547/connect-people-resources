import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Briefcase, HardHat, ArrowLeft } from 'lucide-react';
import { z } from 'zod';
import PageMeta from '@/components/PageMeta';
import { PWAInstallPrompt } from '@/components/PWAInstallPrompt';
import logo from '@/assets/logo.png';

type RoleType = 'hr' | 'worker';

const WORKER_EMAIL_DOMAIN = 'workers.local';
const loginRegex = /^[a-zA-Z0-9._-]{3,32}$/;

const loginToEmail = (login: string) => `${login.trim().toLowerCase()}@${WORKER_EMAIL_DOMAIN}`;

const hrLoginSchema = z.object({
  email: z.string().trim().email('Введите корректный email'),
  password: z.string().min(6, 'Пароль должен быть не менее 6 символов'),
});

const workerLoginSchema = z.object({
  login: z.string().trim().regex(loginRegex, 'Логин: 3-32 символа (буквы, цифры, . _ -)'),
  password: z.string().min(6, 'Пароль должен быть не менее 6 символов'),
});

const hrSignupSchema = hrLoginSchema.extend({
  fullName: z.string().trim().min(2, 'Введите ваше имя'),
  company: z.string().optional(),
});

const workerSignupSchema = workerLoginSchema.extend({
  fullName: z.string().trim().min(2, 'Введите ваше имя'),
});

const Login: React.FC = () => {
  const [searchParams] = useSearchParams();
  const initialRole = searchParams.get('role') as RoleType | null;

  const [selectedRole, setSelectedRole] = useState<RoleType>(initialRole || 'hr');
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [company, setCompany] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const navigate = useNavigate();
  const { user, role, loading: authLoading, signIn, signUp } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (!authLoading && user && role) {
      if (role === 'hr') navigate('/hr/dashboard', { replace: true });
      else if (role === 'worker') navigate('/worker/dashboard', { replace: true });
      else if (role === 'admin') navigate('/admin/dashboard', { replace: true });
    }
  }, [user, role, authLoading, navigate]);

  const roles = [
    { id: 'hr' as RoleType, label: 'HR', icon: <Briefcase className="w-5 h-5" /> },
    { id: 'worker' as RoleType, label: 'Исполнитель', icon: <HardHat className="w-5 h-5" /> },
  ];

  // For sign-in we don't know the role yet — detect by whether the input looks like an email or a login.
  const signInUsesLogin = !isSignUp && !email.includes('@') && email.length > 0;
  const usesLogin = isSignUp ? selectedRole === 'worker' : signInUsesLogin;

  const validateForm = () => {
    try {
      if (isSignUp) {
        if (selectedRole === 'worker') {
          workerSignupSchema.parse({ login, password, fullName });
        } else {
          hrSignupSchema.parse({ email, password, fullName, company });
        }
      } else {
        if (signInUsesLogin) {
          workerLoginSchema.parse({ login: email, password });
        } else {
          hrLoginSchema.parse({ email, password });
        }
      }
      setErrors({});
      return true;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const newErrors: Record<string, string> = {};
        error.errors.forEach((err) => {
          if (err.path[0]) newErrors[err.path[0] as string] = err.message;
        });
        setErrors(newErrors);
      }
      return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;
    setLoading(true);

    try {
      if (isSignUp) {
        const isWorker = selectedRole === 'worker';
        const emailToUse = isWorker ? loginToEmail(login) : email;
        const { error } = await signUp(emailToUse, password, {
          role: selectedRole,
          full_name: fullName,
          company: !isWorker ? company : undefined,
          ...(isWorker ? { login: login.trim().toLowerCase() } : {}),
        } as any);

        if (error) {
          if (error.message?.includes('already registered') || error.message?.includes('already exists')) {
            toast({
              title: 'Ошибка регистрации',
              description: isWorker
                ? 'Пользователь с таким логином уже зарегистрирован'
                : 'Пользователь с таким email уже зарегистрирован',
              variant: 'destructive',
            });
          } else {
            toast({ title: 'Ошибка регистрации', description: error.message, variant: 'destructive' });
          }
          return;
        }

        toast({ title: 'Регистрация успешна!', description: 'Добро пожаловать в систему' });
      } else {
        const emailToUse = signInUsesLogin ? loginToEmail(email) : email;
        const { error } = await signIn(emailToUse, password);

        if (error) {
          toast({
            title: 'Ошибка входа',
            description: signInUsesLogin ? 'Неверный логин или пароль' : 'Неверный email или пароль',
            variant: 'destructive',
          });
          return;
        }
        toast({ title: 'Добро пожаловать!', description: 'Вы успешно вошли в систему' });
      }
    } finally {
      setLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-muted-foreground">Загрузка...</p>
        </div>
      </div>
    );
  }

  if (user && !role) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-muted-foreground">Загрузка профиля...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 to-secondary/5 flex items-center justify-center p-4 pb-24 sm:pb-4">
      <div className="sm:hidden">
        <PWAInstallPrompt variant="mobile-banner" />
      </div>

      <PageMeta
        title={isSignUp ? 'Регистрация' : 'Вход'}
        description="Войдите или зарегистрируйтесь в системе Работа для Всех для подбора персонала"
      />
      <div className="w-full max-w-md animate-scale-in">
        <Link to="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-6 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          На главную
        </Link>

        <Card className="shadow-card border-secondary/20">
          <CardHeader className="text-center pb-4">
            <img src={logo} alt="Работа для Всех" className="w-14 h-14 object-contain mx-auto mb-4" />
            <CardTitle className="text-2xl">
              {isSignUp ? 'Регистрация' : 'Вход'} в "РАБОТА ДЛЯ ВСЕХ"
            </CardTitle>
            <CardDescription>
              {isSignUp ? 'Создайте аккаунт для начала работы' : 'Войдите в свой аккаунт'}
            </CardDescription>
          </CardHeader>

          <CardContent>
            {isSignUp && (
              <div className="grid grid-cols-2 gap-3 mb-6">
                {roles.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setSelectedRole(r.id)}
                    className={cn(
                      'flex items-center justify-center gap-3 p-4 rounded-xl border-2 transition-all duration-200',
                      selectedRole === r.id
                        ? 'border-secondary bg-secondary/10 text-foreground'
                        : 'border-border hover:border-secondary/50 text-muted-foreground'
                    )}
                  >
                    <span className={cn('flex-shrink-0', selectedRole === r.id ? 'text-secondary' : 'text-muted-foreground')}>
                      {r.icon}
                    </span>
                    <span className="font-medium whitespace-nowrap">{r.label}</span>
                  </button>
                ))}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {isSignUp && (
                <>
                  <div>
                    <Label htmlFor="fullName">ФИО</Label>
                    <Input
                      id="fullName"
                      type="text"
                      placeholder="Иванов Иван Иванович"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className={cn(errors.fullName && 'border-destructive')}
                    />
                    {errors.fullName && <p className="text-xs text-destructive mt-1">{errors.fullName}</p>}
                  </div>

                  {selectedRole === 'hr' && (
                    <div>
                      <Label htmlFor="company">Компания</Label>
                      <Input
                        id="company"
                        type="text"
                        placeholder="Название компании"
                        value={company}
                        onChange={(e) => setCompany(e.target.value)}
                      />
                    </div>
                  )}
                </>
              )}

              {isSignUp && selectedRole === 'worker' ? (
                <div>
                  <Label htmlFor="login">Логин</Label>
                  <Input
                    id="login"
                    type="text"
                    placeholder="ivan_petrov"
                    autoCapitalize="none"
                    autoCorrect="off"
                    value={login}
                    onChange={(e) => setLogin(e.target.value)}
                    className={cn(errors.login && 'border-destructive')}
                  />
                  {errors.login && <p className="text-xs text-destructive mt-1">{errors.login}</p>}
                </div>
              ) : (
                <div>
                  <Label htmlFor="email">{!isSignUp ? 'Email или логин' : 'Email'}</Label>
                  <Input
                    id="email"
                    type="text"
                    autoCapitalize="none"
                    autoCorrect="off"
                    placeholder={!isSignUp ? 'example@mail.ru или логин' : 'example@mail.ru'}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={cn((errors.email || errors.login) && 'border-destructive')}
                  />
                  {(errors.email || errors.login) && (
                    <p className="text-xs text-destructive mt-1">{errors.email || errors.login}</p>
                  )}
                </div>
              )}

              <div>
                <Label htmlFor="password">Пароль</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={cn(errors.password && 'border-destructive')}
                />
                {errors.password && <p className="text-xs text-destructive mt-1">{errors.password}</p>}
              </div>

              <Button type="submit" className="w-full btn-hover" disabled={loading}>
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                    Загрузка...
                  </span>
                ) : isSignUp ? (
                  'Зарегистрироваться'
                ) : (
                  'Войти'
                )}
              </Button>
            </form>

            <div className="mt-6 text-center">
              <button
                type="button"
                onClick={() => {
                  setIsSignUp(!isSignUp);
                  setErrors({});
                }}
                className="text-sm text-primary hover:underline"
              >
                {isSignUp ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Зарегистрироваться'}
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Login;
