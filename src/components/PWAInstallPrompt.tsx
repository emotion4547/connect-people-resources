import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Smartphone, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface PWAInstallPromptProps {
  collapsed?: boolean;
}

export const PWAInstallPrompt: React.FC<PWAInstallPromptProps> = ({ collapsed = false }) => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSHint, setShowIOSHint] = useState(false);

  useEffect(() => {
    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
      return;
    }

    // Check if dismissed
    const dismissed = sessionStorage.getItem('pwa-prompt-dismissed');
    if (dismissed) {
      setIsDismissed(true);
    }

    // Check if iOS
    const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIOS(isIOSDevice);

    // Listen for install prompt (works in Chrome, Edge, Samsung Internet, Opera)
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // Listen for successful installation
    window.addEventListener('appinstalled', () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    });

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstall = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setIsInstalled(true);
      }
      setDeferredPrompt(null);
    } else if (isIOS) {
      setShowIOSHint(true);
    }
  };

  const handleDismiss = () => {
    setIsDismissed(true);
    sessionStorage.setItem('pwa-prompt-dismissed', 'true');
  };

  // Don't show if installed or dismissed
  if (isInstalled || isDismissed) {
    return null;
  }

  // Don't show if no install prompt available and not iOS
  if (!deferredPrompt && !isIOS) {
    return null;
  }

  if (collapsed) {
    return (
      <div className="p-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleInstall}
          className="w-full justify-center text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 p-2"
        >
          <Smartphone className="w-5 h-5 text-secondary" />
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-2 mb-2">
      <div className="bg-sidebar-accent/30 rounded-xl p-3 relative">
        <button
          onClick={handleDismiss}
          className="absolute top-2 right-2 text-sidebar-foreground/60 hover:text-sidebar-foreground"
        >
          <X className="w-4 h-4" />
        </button>
        
        <div className="flex items-center gap-2 mb-2">
          <Smartphone className="w-5 h-5 text-secondary" />
          <span className="text-sm font-medium">Мобильное приложение</span>
        </div>
        
        <p className="text-xs text-sidebar-foreground/70 mb-3">
          Установите для быстрого доступа
        </p>
        
        <Button
          size="sm"
          onClick={handleInstall}
          className="w-full bg-secondary hover:bg-secondary/90 text-secondary-foreground"
        >
          <Download className="w-4 h-4 mr-2" />
          Установить
        </Button>

        {showIOSHint && isIOS && (
          <div className="mt-3 p-2 bg-sidebar-accent/50 rounded-lg text-xs text-sidebar-foreground/80">
            <p className="font-medium mb-1">Для установки на iOS:</p>
            <p>1. Нажмите кнопку «Поделиться» ↗</p>
            <p>2. Выберите «На экран Домой»</p>
          </div>
        )}
      </div>
    </div>
  );
};
