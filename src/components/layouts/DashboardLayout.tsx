import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import logo from '@/assets/logo.png';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { PWAInstallPrompt } from '@/components/PWAInstallPrompt';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
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
  Copy,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Calendar,
  MoreHorizontal,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  badge?: number;
}

interface DashboardLayoutProps {
  children: React.ReactNode;
  role: 'hr' | 'worker' | 'admin';
}

const hrNavItems: NavItem[] = [
  { label: 'Дашборд', href: '/hr/dashboard', icon: <Home className="w-5 h-5" /> },
  { label: 'Мои заявки', href: '/hr/requests', icon: <FileText className="w-5 h-5" /> },
  { label: 'Создать заявку', href: '/hr/create-request', icon: <PlusCircle className="w-5 h-5" /> },
  { label: 'Шаблоны', href: '/hr/templates', icon: <Copy className="w-5 h-5" /> },
  { label: 'Поддержка', href: '/hr/support', icon: <MessageCircle className="w-5 h-5" /> },
];

const workerNavItems: NavItem[] = [
  { label: 'Моя анкета', href: '/worker/profile', icon: <User className="w-5 h-5" /> },
  { label: 'Смены', href: '/worker/vacancies', icon: <FileText className="w-5 h-5" /> },
  { label: 'Календарь', href: '/worker/calendar', icon: <Calendar className="w-5 h-5" /> },
  { label: 'Отклики', href: '/worker/responses', icon: <CheckCircle className="w-5 h-5" /> },
  { label: 'Поддержка', href: '/worker/support', icon: <MessageCircle className="w-5 h-5" /> },
];

const adminNavItems: NavItem[] = [
  { label: 'Дашборд', href: '/admin/dashboard', icon: <Home className="w-5 h-5" /> },
  { label: 'Заявки', href: '/admin/requests', icon: <FileText className="w-5 h-5" /> },
  { label: 'Исполнители', href: '/admin/workers', icon: <Users className="w-5 h-5" /> },
  { label: 'Пользователи', href: '/admin/users', icon: <User className="w-5 h-5" /> },
  { label: 'Отчеты', href: '/admin/reports', icon: <BarChart3 className="w-5 h-5" /> },
  { label: 'Сообщения', href: '/admin/messages', icon: <Mail className="w-5 h-5" /> },
  { label: 'Обращения', href: '/admin/contact-messages', icon: <MessageCircle className="w-5 h-5" /> },
  { label: 'Настройки', href: '/admin/settings', icon: <Settings className="w-5 h-5" /> },
];

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({ children, role }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, signOut, role: userRole } = useAuth();
  const [collapsed, setCollapsed] = React.useState(() => {
    const saved = localStorage.getItem('sidebar-collapsed');
    return saved === 'true';
  });

  // Fetch unread contact messages count for admin
  const { data: unreadCount = 0 } = useQuery({
    queryKey: ['unread-contact-messages'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('contact_messages')
        .select('*', { count: 'exact', head: true })
        .eq('is_read', false);
      
      if (error) throw error;
      return count || 0;
    },
    enabled: role === 'admin',
    refetchInterval: 30000,
  });

  React.useEffect(() => {
    localStorage.setItem('sidebar-collapsed', String(collapsed));
  }, [collapsed]);

  // Add badge to admin nav items
  const getNavItems = () => {
    if (role === 'hr') return hrNavItems;
    if (role === 'worker') return workerNavItems;
    
    return adminNavItems.map(item => {
      if (item.href === '/admin/contact-messages' && unreadCount > 0) {
        return { ...item, badge: unreadCount };
      }
      return item;
    });
  };

  const navItems = getNavItems();

  // For mobile bottom nav, show first 4 items + "More" menu for the rest
  const mobileNavItems = navItems.slice(0, 4);
  const moreNavItems = navItems.slice(4);

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
    <TooltipProvider delayDuration={0}>
      <div className="min-h-screen bg-background">
        {/* Desktop Sidebar - hidden on mobile */}
        <aside
          className={cn(
            "fixed top-0 left-0 z-40 h-screen bg-sidebar text-sidebar-foreground flex-col transition-all duration-300 hidden lg:flex",
            collapsed ? "w-16" : "w-64"
          )}
        >
          {/* Logo */}
          <div className={cn("p-4 border-b border-sidebar-border", collapsed ? "px-2" : "p-6")}>
            <Link to="/" className="flex items-center gap-2">
              <img 
                src={logo} 
                alt="Работа для Всех" 
                className="w-10 h-10 object-cover rounded-full flex-shrink-0"
              />
              {!collapsed && <span className="font-bold text-lg">РАБОТА ДЛЯ ВСЕХ</span>}
            </Link>
          </div>

          {/* Navigation */}
          <nav className={cn("flex-1 p-2 space-y-1 overflow-y-auto", collapsed ? "px-1" : "p-4")}>
            {navItems.map((item) => (
              <Tooltip key={item.href}>
                <TooltipTrigger asChild>
                  <Link
                    to={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-xl transition-all duration-200 relative",
                      collapsed ? "px-3 py-3 justify-center" : "px-4 py-3",
                      location.pathname === item.href
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "hover:bg-sidebar-accent/50 text-sidebar-foreground/80"
                    )}
                  >
                    <span className="text-secondary flex-shrink-0 relative">
                      {item.icon}
                      {item.badge && item.badge > 0 && collapsed && (
                        <Badge 
                          variant="destructive" 
                          className="absolute -top-2 -right-2 h-4 min-w-4 px-1 text-[10px] flex items-center justify-center"
                        >
                          {item.badge > 99 ? '99+' : item.badge}
                        </Badge>
                      )}
                    </span>
                    {!collapsed && (
                      <>
                        <span className="font-medium flex-1">{item.label}</span>
                        {item.badge && item.badge > 0 && (
                          <Badge variant="destructive" className="h-5 min-w-5 px-1.5 text-xs">
                            {item.badge > 99 ? '99+' : item.badge}
                          </Badge>
                        )}
                      </>
                    )}
                  </Link>
                </TooltipTrigger>
                {collapsed && (
                  <TooltipContent side="right">
                    {item.label}
                    {item.badge && item.badge > 0 && ` (${item.badge})`}
                  </TooltipContent>
                )}
              </Tooltip>
            ))}
          </nav>

          {/* PWA Install Prompt */}
          <PWAInstallPrompt collapsed={collapsed} />

          {/* Collapse toggle button */}
          <div className="flex justify-end p-2 border-t border-sidebar-border">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCollapsed(!collapsed)}
              className="text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
            >
              {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </Button>
          </div>

          {/* User profile */}
          <div className={cn("p-2 border-t border-sidebar-border", collapsed ? "px-1" : "p-4")}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Link 
                  to={getProfileLink()}
                  className={cn(
                    "flex items-center gap-3 mb-2 p-2 rounded-xl hover:bg-sidebar-accent/50 transition-colors cursor-pointer",
                    collapsed && "justify-center"
                  )}
                >
                  <Avatar className={cn("border-2 border-secondary flex-shrink-0", collapsed ? "w-8 h-8" : "w-10 h-10")}>
                    <AvatarFallback className="bg-secondary text-secondary-foreground font-semibold text-sm">
                      {getInitials()}
                    </AvatarFallback>
                  </Avatar>
                  {!collapsed && (
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{profile?.full_name || 'Пользователь'}</p>
                      <p className="text-xs text-sidebar-foreground/60 truncate">{profile?.company || profile?.email}</p>
                    </div>
                  )}
                </Link>
              </TooltipTrigger>
              {collapsed && (
                <TooltipContent side="right">
                  {profile?.full_name || 'Профиль'}
                </TooltipContent>
              )}
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSignOut}
                  className={cn(
                    "w-full text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent/50",
                    collapsed ? "justify-center px-0" : "justify-start"
                  )}
                >
                  <LogOut className="w-4 h-4" />
                  {!collapsed && <span className="ml-2">Выйти</span>}
                </Button>
              </TooltipTrigger>
              {collapsed && (
                <TooltipContent side="right">
                  Выйти
                </TooltipContent>
              )}
            </Tooltip>
          </div>
        </aside>

        {/* Mobile Bottom Navigation */}
        <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border shadow-lg">
          <div className="flex items-center justify-around h-16 px-2">
            {mobileNavItems.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  "flex flex-col items-center justify-center flex-1 py-2 px-1 rounded-lg transition-colors relative",
                  location.pathname === item.href
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <span className="relative">
                  {item.icon}
                  {item.badge && item.badge > 0 && (
                    <Badge 
                      variant="destructive" 
                      className="absolute -top-2 -right-2 h-4 min-w-4 px-1 text-[10px] flex items-center justify-center"
                    >
                      {item.badge > 9 ? '9+' : item.badge}
                    </Badge>
                  )}
                </span>
                <span className="text-[10px] mt-1 truncate max-w-[60px]">{item.label}</span>
              </Link>
            ))}
            
            {/* More menu for additional items */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={cn(
                    "flex flex-col items-center justify-center flex-1 py-2 px-1 rounded-lg transition-colors",
                    moreNavItems.some(item => location.pathname === item.href)
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <MoreHorizontal className="w-5 h-5" />
                  <span className="text-[10px] mt-1">Ещё</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 mb-2">
                {moreNavItems.map((item) => (
                  <DropdownMenuItem key={item.href} asChild>
                    <Link
                      to={item.href}
                      className={cn(
                        "flex items-center gap-3 cursor-pointer",
                        location.pathname === item.href && "text-primary"
                      )}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                      {item.badge && item.badge > 0 && (
                        <Badge variant="destructive" className="ml-auto h-5 min-w-5 px-1.5 text-xs">
                          {item.badge > 99 ? '99+' : item.badge}
                        </Badge>
                      )}
                    </Link>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to={getProfileLink()} className="flex items-center gap-3 cursor-pointer">
                    <Avatar className="w-6 h-6 border border-secondary">
                      <AvatarFallback className="bg-secondary text-secondary-foreground text-xs">
                        {getInitials()}
                      </AvatarFallback>
                    </Avatar>
                    <span>Профиль</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={handleSignOut}
                  className="flex items-center gap-3 cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="w-5 h-5" />
                  <span>Выйти</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </nav>

        {/* Main content */}
        <main className={cn(
          "min-h-screen transition-all duration-300 pb-20 lg:pb-0",
          collapsed ? "lg:ml-16" : "lg:ml-64"
        )}>
          <div className="p-4 lg:p-8 animate-fade-in">
            {children}
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
};
