import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import PageMeta from "@/components/PageMeta";
import { Button } from "@/components/ui/button";
import { Home, ArrowLeft, Search, HelpCircle } from "lucide-react";
import logo from "@/assets/logo.png";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-secondary/5 flex flex-col">
      <PageMeta title="Страница не найдена" description="Запрашиваемая страница не существует" />
      
      {/* Header */}
      <header className="p-4 sm:p-6">
        <Link to="/" className="inline-flex items-center gap-2 group">
          <img src={logo} alt="Работа для Всех" className="w-8 h-8 object-cover rounded-full" />
          <span className="font-bold text-foreground group-hover:text-primary transition-colors">
            РАБОТА ДЛЯ ВСЕХ
          </span>
        </Link>
      </header>

      {/* Main content */}
      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="text-center max-w-lg mx-auto">
          {/* Animated 404 */}
          <div className="relative mb-8">
            <h1 className="text-[120px] sm:text-[180px] font-bold text-primary/10 leading-none select-none">
              404
            </h1>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="bg-card rounded-2xl shadow-xl border border-border p-6 animate-fade-in">
                <Search className="w-12 h-12 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Не найдено</p>
              </div>
            </div>
          </div>

          {/* Message */}
          <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-4 animate-fade-in">
            Упс! Страница не найдена
          </h2>
          <p className="text-muted-foreground mb-8 animate-fade-in" style={{ animationDelay: '100ms' }}>
            Страница <code className="bg-muted px-2 py-1 rounded text-sm">{location.pathname}</code> не существует 
            или была перемещена. Возможно, вы перешли по устаревшей ссылке.
          </p>

          {/* Action buttons */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center animate-fade-in" style={{ animationDelay: '200ms' }}>
            <Link to="/">
              <Button size="lg" className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-white rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105">
                <Home className="w-5 h-5 mr-2" />
                На главную
              </Button>
            </Link>
            <Button 
              size="lg" 
              variant="outline" 
              onClick={() => window.history.back()}
              className="w-full sm:w-auto border-border hover:bg-muted rounded-xl"
            >
              <ArrowLeft className="w-5 h-5 mr-2" />
              Назад
            </Button>
          </div>

          {/* Quick links */}
          <div className="mt-12 pt-8 border-t border-border animate-fade-in" style={{ animationDelay: '300ms' }}>
            <p className="text-sm text-muted-foreground mb-4">Возможно, вы искали:</p>
            <div className="flex flex-wrap gap-2 justify-center">
              <Link to="/login?role=hr">
                <Button variant="ghost" size="sm" className="text-primary hover:bg-primary/10">
                  Кабинет HR
                </Button>
              </Link>
              <Link to="/login?role=worker">
                <Button variant="ghost" size="sm" className="text-secondary hover:bg-secondary/10">
                  Кабинет исполнителя
                </Button>
              </Link>
              <Link to="/login">
                <Button variant="ghost" size="sm" className="hover:bg-muted">
                  Вход в систему
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="p-4 sm:p-6 text-center">
        <p className="text-xs text-muted-foreground">
          © 2025 РАБОТА ДЛЯ ВСЕХ. Все права защищены.
        </p>
      </footer>
    </div>
  );
};

export default NotFound;
