import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Home,
  FileText,
  PlusCircle,
  MessageCircle,
  User,
  CheckCircle,
  Users,
  BarChart3,
  Mail,
  Settings,
  LogOut,
  Menu,
  X,
} from 'lucide-react';

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
}

interface DashboardLayoutProps {
  children: React.ReactNode;
  role: 'hr' | 'worker' | 'admin';
}

const hrNavItems: NavItem[] = [
  { label: 'Дашборд', href: '/hr/dashboard', icon: <Home className="w-5 h-5" /> },
  { label: 'Мои заявки', href: '/hr/requests', icon: <FileText className="w-5 h-5" /> },
  { label: 'Создать заявку', href: '/hr/create-request', icon: <PlusCircle className="w-5 h-5" /> },
  { label: 'Поддержка', href: '/hr/support', icon: <MessageCircle className="w-5 h-5" /> },
];

const workerNavItems: NavItem[] = [
  { label: 'Моя анкета', href: '/worker/profile', icon: <User className="w-5 h-5" /> },
  { label: 'Доступные смены', href: '/worker/vacancies', icon: <FileText className="w-5 h-5" /> },
  { label: 'Мои отклики', href: '/worker/responses', icon: <CheckCircle className="w-5 h-5" /> },
  { label: 'Поддержка', href: '/worker/support', icon: <MessageCircle className="w-5 h-5" /> },
];

const adminNavItems: NavItem[] = [
  { label: 'Дашборд', href: '/admin/dashboard', icon: <Home className="w-5 h-5" /> },
  { label: 'Заявки', href: '/admin/requests', icon: <FileText className="w-5 h-5" /> },
  { label: 'Исполнители', href: '/admin/workers', icon: <Users className="w-5 h-5" /> },
  { label: 'Пользователи', href: '/admin/users', icon: <User className="w-5 h-5" /> },
  { label: 'Отчеты', href: '/admin/reports', icon: <BarChart3 className="w-5 h-5" /> },
  { label: 'Сообщения', href: '/admin/messages', icon: <Mail className="w-5 h-5" /> },
  { label: 'Настройки', href: '/admin/settings', icon: <Settings className="w-5 h-5" /> },
];

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({ children, role }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, signOut, role: userRole } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  const navItems = role === 'hr' ? hrNavItems : role === 'worker' ? workerNavItems : adminNavItems;

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  const getInitials = () => {
    if (profile?.full_name) {
      return profile.full_name.split(' ').map((n: string) => n[0]).join('').toUpperCase();
    }
    return profile?.email?.[0]?.toUpperCase() || 'U';
  };

  const getProfileLink = () => {
    if (userRole === 'hr') return '/hr/profile';
    if (userRole === 'admin') return '/admin/profile';
    return '/worker/profile';
  };

  return (
    <div className="min-h-screen flex w-full bg-background">
      {/* Mobile menu button */}
      <button
        className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-primary text-primary-foreground rounded-lg shadow-lg"
        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
      >
        {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
      </button>

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed lg:sticky top-0 left-0 z-40 h-screen w-64 bg-sidebar text-sidebar-foreground flex flex-col transition-transform duration-300",
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        {/* Logo */}
        <div className="p-6 border-b border-sidebar-border">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center">
              <span className="text-secondary-foreground font-bold text-lg">ЛР</span>
            </div>
            <span className="font-bold text-lg">ЛЮДИ И РЕСУРСЫ</span>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <Link
              key={item.href}
              to={item.href}
              onClick={() => setMobileMenuOpen(false)}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200",
                location.pathname === item.href
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "hover:bg-sidebar-accent/50 text-sidebar-foreground/80"
              )}
            >
              <span className="text-secondary">{item.icon}</span>
              <span className="font-medium">{item.label}</span>
            </Link>
          ))}
        </nav>

        {/* User profile */}
        <div className="p-4 border-t border-sidebar-border">
          <Link 
            to={getProfileLink()} 
            onClick={() => setMobileMenuOpen(false)}
            className="flex items-center gap-3 mb-3 p-2 -m-2 rounded-xl hover:bg-sidebar-accent/50 transition-colors cursor-pointer"
          >
            <Avatar className="w-10 h-10 border-2 border-secondary">
              <AvatarFallback className="bg-secondary text-secondary-foreground font-semibold">
                {getInitials()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{profile?.full_name || 'Пользователь'}</p>
              <p className="text-xs text-sidebar-foreground/60 truncate">{profile?.company || profile?.email}</p>
            </div>
          </Link>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSignOut}
            className="w-full justify-start text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Выйти
          </Button>
        </div>
      </aside>

      {/* Overlay for mobile */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Main content */}
      <main className="flex-1 min-h-screen lg:ml-0">
        <div className="p-4 lg:p-8 pt-16 lg:pt-8 animate-fade-in">
          {children}
        </div>
      </main>
    </div>
  );
};
