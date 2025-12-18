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

type RoleType = 'hr' | 'worker';

const loginSchema = z.object({
  email: z.string().trim().email('Введите корректный email'),
  password: z.string().min(6, 'Пароль должен быть не менее 6 символов'),
});

const signupSchema = loginSchema.extend({
  fullName: z.string().trim().min(2, 'Введите ваше имя'),
  company: z.string().optional(),
});

const Login: React.FC = () => {
  const [searchParams] = useSearchParams();
  const initialRole = searchParams.get('role') as RoleType | null;
  
  const [selectedRole, setSelectedRole] = useState<RoleType>(initialRole || 'hr');
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [company, setCompany] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const navigate = useNavigate();
  const { user, role, loading: authLoading, signIn, signUp } = useAuth();
  const { toast } = useToast();

  // DEV diagnostics: show which header contains non-Latin1 chars
  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const onHeader = (e: Event) => {
      const ce = e as CustomEvent<{ header?: string }>;
      const headerName = ce.detail?.header;
      if (headerName) {
        toast({
          title: "Техническая ошибка",
          description: `Найден заголовок с кириллицей/не-ASCII: ${headerName}`,
          variant: "destructive",
          duration: 15000,
        });
      }
    };

    const onFetchError = (e: Event) => {
      const ce = e as CustomEvent<{ message?: string }>;
      if (ce.detail?.message?.includes("non ISO-8859-1")) {
        toast({
          title: "Ошибка регистрации",
          description: "Техническая проблема с кодировкой (не-ASCII в заголовках).",
          variant: "destructive",
          duration: 15000,
        });
      }
    };

    window.addEventListener("lovable-non-latin1-header", onHeader as EventListener);
    window.addEventListener("lovable-fetch-error", onFetchError as EventListener);
    return () => {
      window.removeEventListener("lovable-non-latin1-header", onHeader as EventListener);
      window.removeEventListener("lovable-fetch-error", onFetchError as EventListener);
    };
  }, [toast]);

  // Redirect authenticated users based on their role
  useEffect(() => {
    if (!authLoading && user && role) {
      if (role === 'hr') navigate('/hr/dashboard', { replace: true });
      else if (role === 'worker') navigate('/worker/vacancies', { replace: true });
      else if (role === 'admin') navigate('/admin/dashboard', { replace: true });
    }
  }, [user, role, authLoading, navigate]);

  // Only HR and Worker can self-register, Admin is assigned by existing admin
  const roles = [
    { id: 'hr' as RoleType, label: 'HR', icon: <Briefcase className="w-5 h-5" /> },
    { id: 'worker' as RoleType, label: 'Исполнитель', icon: <HardHat className="w-5 h-5" /> },
  ];

  const validateForm = () => {
    try {
      if (isSignUp) {
        signupSchema.parse({ email, password, fullName, company });
      } else {
        loginSchema.parse({ email, password });
      }
      setErrors({});
      return true;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const newErrors: Record<string, string> = {};
        error.errors.forEach((err) => {
          if (err.path[0]) {
            newErrors[err.path[0] as string] = err.message;
          }
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
        const { error } = await signUp(email, password, {
          role: selectedRole,
          full_name: fullName,
          company: selectedRole === 'hr' ? company : undefined,
        });

        if (error) {
          if (error.message.includes('already registered')) {
            toast({
              title: 'Ошибка регистрации',
              description: 'Пользователь с таким email уже зарегистрирован',
              variant: 'destructive',
            });
          } else {
            toast({
              title: 'Ошибка регистрации',
              description: error.message,
              variant: 'destructive',
            });
          }
          return;
        }

        toast({
          title: 'Регистрация успешна!',
          description: 'На вашу почту отправлено письмо для подтверждения. Проверьте почту и перейдите по ссылке.',
          duration: 10000,
        });
        // Don't redirect - user needs to confirm email first
        return;
      } else {
        const { error } = await signIn(email, password);

        if (error) {
          toast({
            title: 'Ошибка входа',
            description: 'Неверный email или пароль',
            variant: 'destructive',
          });
          return;
        }

        toast({
          title: 'Добро пожаловать!',
          description: 'Вы успешно вошли в систему',
        });
        // Redirect will happen via useEffect when role is loaded
      }
    } finally {
      setLoading(false);
    }
  };

  // Show loading if checking auth state
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

  // If user is already logged in but role is loading, show loading
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
    <div className="min-h-screen bg-gradient-to-br from-primary/5 to-secondary/5 flex items-center justify-center p-4">
      <div className="w-full max-w-md animate-scale-in">
        <Link 
          to="/" 
          className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          На главную
        </Link>

        <Card className="shadow-card border-secondary/20">
          <CardHeader className="text-center pb-4">
            <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center mx-auto mb-4">
              <span className="text-primary-foreground font-bold text-xl">РВ</span>
            </div>
            <CardTitle className="text-2xl">
              {isSignUp ? 'Регистрация' : 'Вход'} в «Работа для Всех»
            </CardTitle>
            <CardDescription>
              {isSignUp ? 'Создайте аккаунт для начала работы' : 'Войдите в свой аккаунт'}
            </CardDescription>
          </CardHeader>

          <CardContent>
            {/* Role Selection - only shown for signup */}
            {isSignUp && (
              <div className="grid grid-cols-2 gap-3 mb-6">
                {roles.map((role) => (
                  <button
                    key={role.id}
                    type="button"
                    onClick={() => setSelectedRole(role.id)}
                    className={cn(
                      "flex items-center justify-center gap-3 p-4 rounded-xl border-2 transition-all duration-200",
                      selectedRole === role.id
                        ? "border-secondary bg-secondary/10 text-foreground"
                        : "border-border hover:border-secondary/50 text-muted-foreground"
                    )}
                  >
                    <span className={cn(
                      "flex-shrink-0",
                      selectedRole === role.id ? "text-secondary" : "text-muted-foreground"
                    )}>
                      {role.icon}
                    </span>
                    <span className="font-medium whitespace-nowrap">
                      {role.label}
                    </span>
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
                      className={cn(errors.fullName && "border-destructive")}
                    />
                    {errors.fullName && (
                      <p className="text-xs text-destructive mt-1">{errors.fullName}</p>
                    )}
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

              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="example@mail.ru"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={cn(errors.email && "border-destructive")}
                />
                {errors.email && (
                  <p className="text-xs text-destructive mt-1">{errors.email}</p>
                )}
              </div>

              <div>
                <Label htmlFor="password">Пароль</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={cn(errors.password && "border-destructive")}
                />
                {errors.password && (
                  <p className="text-xs text-destructive mt-1">{errors.password}</p>
                )}
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

            <div className="mt-6 text-center space-y-2">
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
              {!isSignUp && (
                <div>
                  <Link to="/forgot-password" className="text-sm text-muted-foreground hover:text-primary hover:underline">
                    Забыли пароль?
                  </Link>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Login;
