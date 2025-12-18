import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { X, Cookie } from 'lucide-react';

const COOKIE_CONSENT_KEY = 'cookie-consent-accepted';

export const CookieConsent = () => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem(COOKIE_CONSENT_KEY);
    if (!consent) {
      // Show after a short delay for better UX
      const timer = setTimeout(() => setIsVisible(true), 1000);
      return () => clearTimeout(timer);
    }
  }, []);

  const acceptCookies = () => {
    localStorage.setItem(COOKIE_CONSENT_KEY, 'true');
    setIsVisible(false);
  };

  const declineCookies = () => {
    localStorage.setItem(COOKIE_CONSENT_KEY, 'declined');
    setIsVisible(false);
  };

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 animate-slide-up">
      <div className="container mx-auto max-w-4xl">
        <div className="bg-card border border-border rounded-2xl shadow-xl p-4 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="flex items-start gap-3 flex-1">
            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
              <Cookie className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1">
              <p className="text-sm text-foreground">
                Мы используем файлы cookie для улучшения работы сайта и анализа трафика.
                Продолжая использовать сайт, вы соглашаетесь с{' '}
                <Link to="/privacy" className="text-primary hover:underline">
                  Политикой конфиденциальности
                </Link>.
              </p>
            </div>
          </div>
          <div className="flex gap-2 w-full sm:w-auto flex-shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={declineCookies}
              className="flex-1 sm:flex-none"
            >
              Отклонить
            </Button>
            <Button
              size="sm"
              onClick={acceptCookies}
              className="flex-1 sm:flex-none bg-primary hover:bg-primary/90"
            >
              Принять
            </Button>
          </div>
          <button
            onClick={declineCookies}
            className="absolute top-2 right-2 sm:static p-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default CookieConsent;
