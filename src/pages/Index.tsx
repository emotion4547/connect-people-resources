import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { 
  Users, Rocket, HardHat, Clock, MapPin, Shield, Zap, 
  FileText, Send, CheckCircle, ClipboardList, Bell, 
  UserCheck, History, BarChart3, MessageSquare, Eye,
  Building2, Warehouse, Store, Quote, ZoomIn, X
} from "lucide-react";
import screenshotHR from "@/assets/screenshot-hr-dashboard.png";
import screenshotWorker from "@/assets/screenshot-worker-dashboard.png";
import screenshotAdmin from "@/assets/screenshot-admin-panel.png";

const Index = () => {
  const [selectedScreenshot, setSelectedScreenshot] = useState<{ src: string; title: string } | null>(null);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 sm:w-10 sm:h-10 bg-primary rounded-xl flex items-center justify-center flex-shrink-0">
              <Users className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
            </div>
            <span className="text-base sm:text-xl font-bold text-foreground truncate">Работа для Всех</span>
          </div>
          <Link to="/login">
            <Button variant="outline" size="sm" className="border-primary text-primary hover:bg-primary hover:text-white flex-shrink-0">
              Войти
            </Button>
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <section className="pt-24 sm:pt-28 pb-12 sm:pb-20 px-4 bg-gradient-to-br from-primary/5 via-background to-secondary/5 animate-fade-in overflow-hidden">
        <div className="container mx-auto max-w-6xl">
          <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-center">
            {/* Text Block */}
            <div className="text-center lg:text-left relative z-10">
              <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl xl:text-6xl font-bold text-foreground mb-4 sm:mb-6 leading-tight px-2 sm:px-0">
                Аутстаффинг персонала{" "}
                <span className="text-primary">в один клик</span>
              </h1>
              <p className="text-sm sm:text-base md:text-lg lg:text-xl text-muted-foreground mb-6 sm:mb-8 max-w-xl mx-auto lg:mx-0 px-2 sm:px-0">
                Онлайн‑сервис «Работа для Всех», который помогает федеральным сетям быстро закрывать заявки на неквалифицированный персонал и даёт исполнителям простой способ находить смены с понятной оплатой.
              </p>
              
              <div className="flex flex-col gap-3 justify-center items-center lg:items-start mb-4 sm:mb-6 px-2 sm:px-0">
                <Link to="/login?role=hr" className="w-full max-w-xs sm:max-w-sm">
                  <Button size="lg" className="w-full bg-primary hover:bg-primary/90 text-white px-4 sm:px-6 py-4 sm:py-5 text-sm sm:text-base rounded-xl sm:rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105">
                    <Rocket className="w-4 h-4 sm:w-5 sm:h-5 mr-2 flex-shrink-0" />
                    <span>Найти людей для сети</span>
                  </Button>
                </Link>
                <Link to="/login?role=worker" className="w-full max-w-xs sm:max-w-sm">
                  <Button size="lg" variant="outline" className="w-full border-2 border-secondary bg-white text-secondary hover:bg-secondary hover:text-white px-4 sm:px-6 py-4 sm:py-5 text-sm sm:text-base rounded-xl sm:rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105">
                    <HardHat className="w-4 h-4 sm:w-5 sm:h-5 mr-2 flex-shrink-0" />
                    <span>Найти смену</span>
                  </Button>
                </Link>
              </div>
              
              <p className="text-xs sm:text-sm text-muted-foreground px-4 sm:px-0">
                Без звонков по базе и бесконечных переписок — всё в одном личном кабинете.
              </p>
            </div>
            
            {/* Illustration / Dashboard Preview */}
            <div className="hidden lg:block relative z-0">
              <div className="relative ml-4">
                <div className="bg-card rounded-3xl shadow-2xl border border-border p-6 transform rotate-1 hover:rotate-0 transition-transform duration-500">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-3 h-3 rounded-full bg-destructive"></div>
                    <div className="w-3 h-3 rounded-full bg-secondary"></div>
                    <div className="w-3 h-3 rounded-full bg-status-success"></div>
                  </div>
                  <div className="space-y-4">
                    <div className="h-8 bg-primary/10 rounded-lg w-3/4"></div>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="h-20 bg-primary/20 rounded-xl flex items-center justify-center">
                        <FileText className="w-8 h-8 text-primary/60" />
                      </div>
                      <div className="h-20 bg-secondary/20 rounded-xl flex items-center justify-center">
                        <Users className="w-8 h-8 text-secondary/60" />
                      </div>
                      <div className="h-20 bg-status-success/20 rounded-xl flex items-center justify-center">
                        <CheckCircle className="w-8 h-8 text-status-success/60" />
                      </div>
                    </div>
                    <div className="h-32 bg-muted rounded-xl"></div>
                  </div>
                </div>
                <div className="absolute -top-4 right-4 bg-secondary text-white px-4 py-2 rounded-xl shadow-lg text-sm font-medium">
                  Личный кабинет
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How it Works - Two Columns */}
      <section className="py-12 sm:py-20 px-4 bg-muted/30 overflow-hidden">
        <div className="container mx-auto max-w-6xl">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-center text-foreground mb-8 sm:mb-12 px-2">
            Как работает «Работа для Всех»
          </h2>
          
          <div className="grid lg:grid-cols-2 gap-4 sm:gap-8 mb-8 sm:mb-12">
            {/* HR Column */}
            <Card className="bg-card border-border hover:border-primary/50 transition-all duration-300 hover:shadow-xl">
              <CardContent className="p-4 sm:p-6 md:p-8">
                <div className="flex items-center gap-3 mb-4 sm:mb-6">
                  <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Building2 className="w-5 h-5 text-primary" />
                  </div>
                  <h3 className="text-lg sm:text-xl md:text-2xl font-bold text-foreground">Для HR федеральных сетей</h3>
                </div>
                
                <div className="space-y-3 sm:space-y-5">
                  {[
                    { icon: ClipboardList, text: "Создаёте заявку на нужные даты и объект за пару минут." },
                    { icon: Send, text: "Сервис автоматически рассылает её исполнителям и публикует в Telegram и VK." },
                    { icon: UserCheck, text: "Менеджер аутстаффинговой компании подбирает людей и подтверждает выход." },
                    { icon: Eye, text: "Вы в личном кабинете видите статусы и понимаете, кто и когда выйдет на смену." }
                  ].map((step, index) => (
                    <div key={index} className="flex items-start gap-3 sm:gap-4">
                      <div className="w-8 h-8 sm:w-10 sm:h-10 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                        <span className="text-primary font-bold text-sm sm:text-base">{index + 1}</span>
                      </div>
                      <div className="flex items-start gap-2 sm:gap-3 flex-1 min-w-0">
                        <step.icon className="w-4 h-4 sm:w-5 sm:h-5 text-primary flex-shrink-0 mt-0.5" />
                        <p className="text-sm sm:text-base text-muted-foreground">{step.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Workers Column */}
            <Card className="bg-card border-border hover:border-secondary/50 transition-all duration-300 hover:shadow-xl">
              <CardContent className="p-4 sm:p-6 md:p-8">
                <div className="flex items-center gap-3 mb-4 sm:mb-6">
                  <div className="w-10 h-10 bg-secondary/10 rounded-xl flex items-center justify-center flex-shrink-0">
                    <HardHat className="w-5 h-5 text-secondary" />
                  </div>
                  <h3 className="text-lg sm:text-xl md:text-2xl font-bold text-foreground">Для исполнителей</h3>
                </div>
                
                <div className="space-y-3 sm:space-y-5">
                  {[
                    { icon: FileText, text: "Регистрируетесь и заполняете простую анкету без резюме." },
                    { icon: Bell, text: "Получаете подходящие смены по городу, графику и ставке." },
                    { icon: CheckCircle, text: "Откликаетесь в один клик и получаете подтверждение в личном кабинете." },
                    { icon: History, text: "Выходите на смену и видите историю отработанных смен и оплат." }
                  ].map((step, index) => (
                    <div key={index} className="flex items-start gap-3 sm:gap-4">
                      <div className="w-8 h-8 sm:w-10 sm:h-10 bg-secondary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                        <span className="text-secondary font-bold text-sm sm:text-base">{index + 1}</span>
                      </div>
                      <div className="flex items-start gap-2 sm:gap-3 flex-1 min-w-0">
                        <step.icon className="w-4 h-4 sm:w-5 sm:h-5 text-secondary flex-shrink-0 mt-0.5" />
                        <p className="text-sm sm:text-base text-muted-foreground">{step.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
            <Link to="/login?role=hr" className="w-full max-w-xs sm:w-auto">
              <Button variant="outline" className="w-full border-primary text-primary hover:bg-primary hover:text-white text-sm sm:text-base">
                Перейти в кабинет HR
              </Button>
            </Link>
            <Link to="/login?role=worker" className="w-full max-w-xs sm:w-auto">
              <Button variant="outline" className="w-full border-secondary text-secondary hover:bg-secondary hover:text-white text-sm sm:text-base">
                Перейти в кабинет исполнителя
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Benefits for HR */}
      <section className="py-12 sm:py-20 px-4 bg-primary/5 overflow-hidden">
        <div className="container mx-auto max-w-6xl">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-center text-foreground mb-8 sm:mb-12 px-2">
            Почему HR выбирают «Работа для Всех»
          </h2>
          
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 mb-8 sm:mb-10">
            {[
              { icon: Zap, title: "Быстрое закрытие заявок", desc: "Готовая база исполнителей и автопубликации в соцсети." },
              { icon: ClipboardList, title: "Единый личный кабинет", desc: "Вместо мессенджеров, таблиц и личных контактов." },
              { icon: Eye, title: "Прозрачные статусы", desc: "По каждой заявке: от создания до выхода людей на смену." },
              { icon: MessageSquare, title: "Меньше звонков", desc: "Меньше ручных звонков и переписок — больше контроля." },
              { icon: BarChart3, title: "История и аналитика", desc: "История заявок и базовая аналитика по точкам и датам." },
              { icon: Shield, title: "Надёжность", desc: "Проверенные исполнители с рейтингом и историей." }
            ].map((benefit, index) => (
              <div 
                key={index}
                className="flex items-start gap-3 sm:gap-4 p-4 sm:p-6 rounded-xl sm:rounded-2xl bg-card border border-border hover:border-primary/30 hover:shadow-lg transition-all duration-300"
              >
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-primary/10 rounded-lg sm:rounded-xl flex items-center justify-center flex-shrink-0">
                  <benefit.icon className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
                </div>
                <div className="min-w-0">
                  <h4 className="font-semibold text-sm sm:text-base text-foreground mb-1">{benefit.title}</h4>
                  <p className="text-xs sm:text-sm text-muted-foreground">{benefit.desc}</p>
                </div>
              </div>
            ))}
          </div>
          
          <div className="text-center px-4">
            <Link to="/login?role=hr" className="inline-block w-full max-w-xs sm:w-auto">
              <Button size="lg" className="w-full bg-primary hover:bg-primary/90 text-white px-6 sm:px-8 py-4 sm:py-6 text-sm sm:text-lg rounded-xl sm:rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105">
                Посмотреть кабинет HR
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Benefits for Workers */}
      <section className="py-12 sm:py-20 px-4 overflow-hidden">
        <div className="container mx-auto max-w-6xl">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-center text-foreground mb-8 sm:mb-12 px-2">
            Почему исполнителям удобно работать через «Работа для Всех»
          </h2>
          
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 mb-8 sm:mb-10">
            {[
              { icon: FileText, title: "Понятные смены", desc: "Где работать, сколько часов и сколько платят." },
              { icon: CheckCircle, title: "Без резюме", desc: "Без резюме и сложных анкет — достаточно базовой информации." },
              { icon: ClipboardList, title: "Всё в одном месте", desc: "Все отклики и подтверждения в одном личном кабинете." },
              { icon: MapPin, title: "Удобный график", desc: "Можно выбирать удобный график и локации." },
              { icon: History, title: "История смен", desc: "Видна история уже отработанных смен." }
            ].map((benefit, index) => (
              <div 
                key={index}
                className="flex items-start gap-3 sm:gap-4 p-4 sm:p-6 rounded-xl sm:rounded-2xl bg-card border border-border hover:border-secondary/30 hover:shadow-lg transition-all duration-300"
              >
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-secondary/10 rounded-lg sm:rounded-xl flex items-center justify-center flex-shrink-0">
                  <benefit.icon className="w-5 h-5 sm:w-6 sm:h-6 text-secondary" />
                </div>
                <div className="min-w-0">
                  <h4 className="font-semibold text-sm sm:text-base text-foreground mb-1">{benefit.title}</h4>
                  <p className="text-xs sm:text-sm text-muted-foreground">{benefit.desc}</p>
                </div>
              </div>
            ))}
          </div>
          
          <div className="text-center px-4">
            <Link to="/login?role=worker" className="inline-block w-full max-w-xs sm:w-auto">
              <Button size="lg" className="w-full bg-secondary hover:bg-secondary/90 text-white px-6 sm:px-8 py-4 sm:py-6 text-sm sm:text-lg rounded-xl sm:rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105">
                Создать анкету исполнителя
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Social Proof & Numbers */}
      <section className="py-12 sm:py-20 px-4 bg-muted/30 overflow-hidden">
        <div className="container mx-auto max-w-6xl">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-center text-foreground mb-8 sm:mb-12 px-2">
            Сервис, который упрощает жизнь и HR, и исполнителям
          </h2>
          
          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-8 mb-12 sm:mb-16">
            {[
              { number: "70%", label: "заявок закрываются в срок" },
              { number: "1000+", label: "исполнителей в базе по России" },
              { number: "~2 мин", label: "на создание заявки" },
              { number: "99%", label: "показатель выхода на смены" }
            ].map((stat, index) => (
              <div key={index} className="text-center p-4 sm:p-6">
                <p className="text-2xl sm:text-3xl md:text-4xl font-bold text-primary mb-1 sm:mb-2">{stat.number}</p>
                <p className="text-xs sm:text-sm text-muted-foreground">{stat.label}</p>
              </div>
            ))}
          </div>
          
          {/* Testimonial */}
          <div className="max-w-3xl mx-auto">
            <Card className="bg-card border-border p-4 sm:p-8">
              <CardContent className="p-0">
                <Quote className="w-8 h-8 sm:w-10 sm:h-10 text-secondary/30 mb-3 sm:mb-4" />
                <p className="text-base sm:text-lg md:text-xl text-foreground mb-4 sm:mb-6 leading-relaxed">
                  «Мы перестали держать десятки чатов в WhatsApp. Всё, что связано со сменами, теперь в "Работа для Всех". Сбережения на время координации — огромные.»
                </p>
                <p className="text-sm sm:text-base text-muted-foreground">— HR-менеджер федеральной сети</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Screenshots Section */}
      <section className="py-12 sm:py-20 px-4 overflow-hidden">
        <div className="container mx-auto max-w-6xl">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-center text-foreground mb-3 sm:mb-4 px-2">
            Как выглядит сервис
          </h2>
          <p className="text-sm sm:text-base text-muted-foreground text-center mb-8 sm:mb-12 px-4">
            Кабинет HR, кабинет исполнителя и панель администратора
          </p>
          
          <div className="grid md:grid-cols-3 gap-4 sm:gap-6">
            {[
              { src: screenshotHR, title: "Кабинет HR", desc: "Доска заявок с фильтрами, статусами, быстрое создание новых смен и список откликнувшихся исполнителей." },
              { src: screenshotWorker, title: "Кабинет исполнителя", desc: "Лента доступных смен с видимыми ставками. Откликнуться — один клик. Поддержка пользователей." },
              { src: screenshotAdmin, title: "Панель администратора", desc: "Выбор исполнителей, контроль явки, работа с обращениями пользователей и управление системой." }
            ].map((screenshot, index) => (
              <div 
                key={index} 
                className="group relative cursor-pointer"
                onClick={() => setSelectedScreenshot({ src: screenshot.src, title: screenshot.title })}
              >
                <div className="bg-card rounded-xl sm:rounded-2xl border border-border overflow-hidden hover:border-primary/30 hover:shadow-xl transition-all duration-300">
                  <div className="relative aspect-video overflow-hidden bg-muted">
                    <img 
                      src={screenshot.src} 
                      alt={screenshot.title}
                      className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-300"
                    />
                    <div className="absolute inset-0 bg-primary/0 group-hover:bg-primary/10 transition-colors duration-300 flex items-center justify-center">
                      <ZoomIn className="w-8 h-8 sm:w-10 sm:h-10 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-300 drop-shadow-lg" />
                    </div>
                  </div>
                  <div className="p-3 sm:p-4">
                    <h3 className="font-semibold text-sm sm:text-base text-foreground mb-1 sm:mb-2">{screenshot.title}</h3>
                    <p className="text-xs sm:text-sm text-muted-foreground">{screenshot.desc}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Screenshot Modal */}
      <Dialog open={!!selectedScreenshot} onOpenChange={() => setSelectedScreenshot(null)}>
        <DialogContent className="max-w-[95vw] sm:max-w-5xl p-0 bg-background border-border">
          <div className="relative">
            <button
              onClick={() => setSelectedScreenshot(null)}
              className="absolute right-2 top-2 sm:right-4 sm:top-4 z-10 w-8 h-8 sm:w-10 sm:h-10 bg-background/80 hover:bg-background rounded-full flex items-center justify-center transition-colors"
            >
              <X className="w-4 h-4 sm:w-5 sm:h-5 text-foreground" />
            </button>
            {selectedScreenshot && (
              <div className="p-2 sm:p-4">
                <h3 className="text-lg sm:text-xl font-semibold text-foreground mb-2 sm:mb-4 pr-10 sm:pr-12">{selectedScreenshot.title}</h3>
                <img 
                  src={selectedScreenshot.src} 
                  alt={selectedScreenshot.title}
                  className="w-full h-auto rounded-lg"
                />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Final CTA */}
      <section className="py-12 sm:py-20 px-4 bg-primary overflow-hidden">
        <div className="container mx-auto max-w-4xl text-center">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white mb-3 sm:mb-4 px-2">
            Начните прямо сейчас
          </h2>
          <p className="text-sm sm:text-base md:text-lg text-white/80 mb-6 sm:mb-8 max-w-2xl mx-auto px-4">
            Подключите сервис к вашей сети или создайте анкету, чтобы получать первые предложения уже на этой неделе.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center items-center px-4">
            <Link to="/login?role=hr" className="w-full max-w-xs sm:w-auto">
              <Button size="lg" className="w-full bg-white text-primary hover:bg-white/90 px-6 sm:px-8 py-4 sm:py-6 text-sm sm:text-lg rounded-xl sm:rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105">
                Запросить демонстрацию
              </Button>
            </Link>
            <Link to="/login?role=worker" className="w-full max-w-xs sm:w-auto">
              <Button size="lg" variant="outline" className="w-full border-2 border-white text-white hover:bg-white hover:text-primary px-6 sm:px-8 py-4 sm:py-6 text-sm sm:text-lg rounded-xl sm:rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105">
                Стать исполнителем
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Target Audience */}
      <section className="py-12 sm:py-16 px-4 bg-muted/30 overflow-hidden">
        <div className="container mx-auto max-w-6xl">
          <h2 className="text-xl sm:text-2xl md:text-3xl font-bold text-center text-foreground mb-6 sm:mb-8 px-2">
            Для каких объектов подходит сервис
          </h2>
          <p className="text-sm sm:text-base text-muted-foreground text-center mb-6 sm:mb-10 max-w-2xl mx-auto px-4">
            Склады, сортировочные центры, магазины и другие объекты, где важна скорость и надёжность выхода людей на смену.
          </p>
          
          <div className="flex flex-wrap justify-center gap-3 sm:gap-4">
            {[
              { icon: Warehouse, label: "Склады" },
              { icon: Store, label: "Магазины" },
              { icon: Building2, label: "Сортировочные центры" }
            ].map((item, index) => (
              <div 
                key={index}
                className="flex items-center gap-2 sm:gap-3 px-4 sm:px-6 py-2 sm:py-3 bg-card border border-border rounded-full hover:border-primary/30 transition-colors"
              >
                <item.icon className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                <span className="text-sm sm:text-base text-foreground">{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 sm:py-12 px-4 bg-card border-t border-border">
        <div className="container mx-auto max-w-6xl">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 sm:gap-6">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 sm:w-8 sm:h-8 bg-primary rounded-lg flex items-center justify-center">
                <Users className="w-3 h-3 sm:w-4 sm:h-4 text-white" />
              </div>
              <span className="text-sm sm:text-base font-bold text-foreground">Работа для Всех</span>
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground text-center">
              © 2025 Работа для Всех. Все права защищены.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
