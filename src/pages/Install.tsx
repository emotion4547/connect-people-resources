import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import PageMeta from "@/components/PageMeta";
import logo from "@/assets/logo.png";
import { Download, Smartphone, Check, Share, MoreVertical, PlusSquare, ArrowLeft } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const Install = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    // Check if already installed
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setIsInstalled(true);
    }

    // Check if iOS
    const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent);
    setIsIOS(isIOSDevice);

    // Listen for install prompt
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    // Listen for successful installation
    window.addEventListener("appinstalled", () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    });

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === "accepted") {
      setIsInstalled(true);
    }
    setDeferredPrompt(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-secondary/5 flex flex-col">
      <PageMeta
        title="Установить приложение"
        description="Установите приложение Работа для Всех на ваш телефон для быстрого доступа"
      />

      {/* Header */}
      <header className="bg-background/80 backdrop-blur-md border-b border-border">
        <div className="container mx-auto px-4 py-4 flex items-center gap-4">
          <Link to="/">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <img src={logo} alt="Работа для Всех" className="w-8 h-8 object-cover rounded-full" />
            <span className="text-lg font-bold text-foreground">Установка приложения</span>
          </div>
        </div>
      </header>

      <div className="flex-1 container mx-auto px-4 py-8 flex items-center justify-center">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-20 h-20 bg-primary/10 rounded-2xl flex items-center justify-center">
              <img src={logo} alt="Работа для Всех" className="w-14 h-14 object-cover rounded-xl" />
            </div>
            <CardTitle className="text-2xl">Работа для Всех</CardTitle>
            <CardDescription>
              Установите приложение на телефон для быстрого доступа
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            {isInstalled ? (
              <div className="text-center space-y-4">
                <div className="w-16 h-16 mx-auto bg-status-success/10 rounded-full flex items-center justify-center">
                  <Check className="w-8 h-8 text-status-success" />
                </div>
                <p className="text-muted-foreground">
                  Приложение уже установлено на вашем устройстве!
                </p>
                <Link to="/">
                  <Button className="w-full">Перейти в приложение</Button>
                </Link>
              </div>
            ) : deferredPrompt ? (
              <div className="space-y-4">
                <Button onClick={handleInstall} className="w-full" size="lg">
                  <Download className="w-5 h-5 mr-2" />
                  Установить приложение
                </Button>
                <p className="text-sm text-muted-foreground text-center">
                  Приложение будет добавлено на главный экран
                </p>
              </div>
            ) : isIOS ? (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground text-center mb-4">
                  Для установки на iPhone/iPad:
                </p>
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-3 bg-muted rounded-lg">
                    <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0">
                      <Share className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">1. Нажмите «Поделиться»</p>
                      <p className="text-xs text-muted-foreground">
                        Иконка внизу экрана Safari
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-muted rounded-lg">
                    <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0">
                      <PlusSquare className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">2. «На экран Домой»</p>
                      <p className="text-xs text-muted-foreground">
                        Прокрутите вниз и выберите эту опцию
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-muted rounded-lg">
                    <div className="w-8 h-8 bg-status-success/10 rounded-full flex items-center justify-center flex-shrink-0">
                      <Check className="w-4 h-4 text-status-success" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">3. Нажмите «Добавить»</p>
                      <p className="text-xs text-muted-foreground">
                        Приложение появится на главном экране
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground text-center mb-4">
                  Для установки на Android:
                </p>
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-3 bg-muted rounded-lg">
                    <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0">
                      <MoreVertical className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">1. Откройте меню браузера</p>
                      <p className="text-xs text-muted-foreground">
                        Три точки в правом верхнем углу
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-muted rounded-lg">
                    <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0">
                      <Smartphone className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">2. «Установить приложение»</p>
                      <p className="text-xs text-muted-foreground">
                        Или «Добавить на главный экран»
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-muted rounded-lg">
                    <div className="w-8 h-8 bg-status-success/10 rounded-full flex items-center justify-center flex-shrink-0">
                      <Check className="w-4 h-4 text-status-success" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">3. Подтвердите установку</p>
                      <p className="text-xs text-muted-foreground">
                        Приложение появится на главном экране
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Benefits */}
            <div className="pt-4 border-t border-border">
              <p className="text-sm font-medium text-center mb-3">Преимущества приложения:</p>
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Check className="w-3 h-3 text-status-success" />
                  <span>Быстрый доступ</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-3 h-3 text-status-success" />
                  <span>Работает офлайн</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-3 h-3 text-status-success" />
                  <span>Как обычное приложение</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-3 h-3 text-status-success" />
                  <span>Не занимает память</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Install;
