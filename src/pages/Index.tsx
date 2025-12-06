import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { 
  Users, Rocket, HardHat, Clock, MapPin, Shield, Zap, 
  FileText, Send, CheckCircle, ClipboardList, Bell, 
  UserCheck, History, BarChart3, MessageSquare, Eye,
  Building2, Warehouse, Store, Quote
} from "lucide-react";

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center">
              <Users className="w-6 h-6 text-white" />
            </div>
            <span className="text-xl font-bold text-foreground">ЛЮДИ И РЕСУРСЫ</span>
          </div>
          <Link to="/login">
            <Button variant="outline" className="border-primary text-primary hover:bg-primary hover:text-white">
              Войти
            </Button>
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <section className="pt-28 pb-20 px-4 bg-gradient-to-br from-primary/5 via-background to-secondary/5 animate-fade-in">
        <div className="container mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Text Block */}
            <div className="text-center lg:text-left relative z-10">
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-foreground mb-6 leading-tight">
                Аутстаффинг персонала{" "}
                <span className="text-primary">в один клик</span>
              </h1>
              <p className="text-lg md:text-xl text-muted-foreground mb-8 max-w-xl mx-auto lg:mx-0">
                Онлайн‑сервис «ЛЮДИ И РЕСУРСЫ», который помогает федеральным сетям быстро закрывать заявки на неквалифицированный персонал и даёт исполнителям простой способ находить смены с понятной оплатой.
              </p>
              
              <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start mb-6">
                <Link to="/login?role=hr">
                  <Button size="lg" className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-white px-8 py-6 text-lg rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105">
                    <Rocket className="w-5 h-5 mr-2" />
                    Найти людей для сети (для HR)
                  </Button>
                </Link>
                <Link to="/login?role=worker">
                  <Button size="lg" variant="outline" className="w-full sm:w-auto border-2 border-secondary bg-white text-secondary hover:bg-secondary hover:text-white px-8 py-6 text-lg rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105">
                    <HardHat className="w-5 h-5 mr-2" />
                    Найти смену (для исполнителей)
                  </Button>
                </Link>
              </div>
              
              <p className="text-sm text-muted-foreground">
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
                <div className="absolute -bottom-4 left-0 bg-secondary text-white px-4 py-2 rounded-xl shadow-lg text-sm font-medium">
                  Личный кабинет
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How it Works - Two Columns */}
      <section className="py-20 px-4 bg-muted/30">
        <div className="container mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center text-foreground mb-12">
            Как работает «ЛЮДИ И РЕСУРСЫ»
          </h2>
          
          <div className="grid lg:grid-cols-2 gap-8 mb-12">
            {/* HR Column */}
            <Card className="bg-card border-border hover:border-primary/50 transition-all duration-300 hover:shadow-xl">
              <CardContent className="p-8">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center">
                    <Building2 className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="text-2xl font-bold text-foreground">Для HR федеральных сетей</h3>
                </div>
                
                <div className="space-y-5">
                  {[
                    { icon: ClipboardList, text: "Создаёте заявку на нужные даты и объект за пару минут." },
                    { icon: Send, text: "Сервис автоматически рассылает её исполнителям и публикует в Telegram и VK." },
                    { icon: UserCheck, text: "Менеджер аутстаффинговой компании подбирает людей и подтверждает выход." },
                    { icon: Eye, text: "Вы в личном кабинете видите статусы и понимаете, кто и когда выйдет на смену." }
                  ].map((step, index) => (
                    <div key={index} className="flex items-start gap-4">
                      <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                        <span className="text-primary font-bold">{index + 1}</span>
                      </div>
                      <div className="flex items-center gap-3 flex-1">
                        <step.icon className="w-5 h-5 text-primary flex-shrink-0" />
                        <p className="text-muted-foreground">{step.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Workers Column */}
            <Card className="bg-card border-border hover:border-secondary/50 transition-all duration-300 hover:shadow-xl">
              <CardContent className="p-8">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-12 h-12 bg-secondary/10 rounded-xl flex items-center justify-center">
                    <HardHat className="w-6 h-6 text-secondary" />
                  </div>
                  <h3 className="text-2xl font-bold text-foreground">Для исполнителей</h3>
                </div>
                
                <div className="space-y-5">
                  {[
                    { icon: FileText, text: "Регистрируетесь и заполняете простую анкету без резюме." },
                    { icon: Bell, text: "Получаете подходящие смены по городу, графику и ставке." },
                    { icon: CheckCircle, text: "Откликаетесь в один клик и получаете подтверждение в личном кабинете." },
                    { icon: History, text: "Выходите на смену и видите историю отработанных смен и оплат." }
                  ].map((step, index) => (
                    <div key={index} className="flex items-start gap-4">
                      <div className="w-10 h-10 bg-secondary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                        <span className="text-secondary font-bold">{index + 1}</span>
                      </div>
                      <div className="flex items-center gap-3 flex-1">
                        <step.icon className="w-5 h-5 text-secondary flex-shrink-0" />
                        <p className="text-muted-foreground">{step.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/login?role=hr">
              <Button variant="outline" className="border-primary text-primary hover:bg-primary hover:text-white">
                Перейти в кабинет HR
              </Button>
            </Link>
            <Link to="/login?role=worker">
              <Button variant="outline" className="border-secondary text-secondary hover:bg-secondary hover:text-white">
                Перейти в кабинет исполнителя
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Benefits for HR */}
      <section className="py-20 px-4 bg-primary/5">
        <div className="container mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center text-foreground mb-12">
            Почему HR выбирают «ЛЮДИ И РЕСУРСЫ»
          </h2>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-10">
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
                className="flex items-start gap-4 p-6 rounded-2xl bg-card border border-border hover:border-primary/30 hover:shadow-lg transition-all duration-300"
              >
                <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center flex-shrink-0">
                  <benefit.icon className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h4 className="font-semibold text-foreground mb-1">{benefit.title}</h4>
                  <p className="text-sm text-muted-foreground">{benefit.desc}</p>
                </div>
              </div>
            ))}
          </div>
          
          <div className="text-center">
            <Link to="/login?role=hr">
              <Button size="lg" className="bg-primary hover:bg-primary/90 text-white px-8 py-6 text-lg rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105">
                Посмотреть, как работает кабинет HR
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Benefits for Workers */}
      <section className="py-20 px-4">
        <div className="container mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center text-foreground mb-12">
            Почему исполнителям удобно работать через «ЛЮДИ И РЕСУРСЫ»
          </h2>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-10">
            {[
              { icon: FileText, title: "Понятные смены", desc: "Где работать, сколько часов и сколько платят." },
              { icon: CheckCircle, title: "Без резюме", desc: "Без резюме и сложных анкет — достаточно базовой информации." },
              { icon: ClipboardList, title: "Всё в одном месте", desc: "Все отклики и подтверждения в одном личном кабинете." },
              { icon: MapPin, title: "Удобный график", desc: "Можно выбирать удобный график и локации." },
              { icon: History, title: "История смен", desc: "Видна история уже отработанных смен." }
            ].map((benefit, index) => (
              <div 
                key={index}
                className="flex items-start gap-4 p-6 rounded-2xl bg-card border border-border hover:border-secondary/30 hover:shadow-lg transition-all duration-300"
              >
                <div className="w-12 h-12 bg-secondary/10 rounded-xl flex items-center justify-center flex-shrink-0">
                  <benefit.icon className="w-6 h-6 text-secondary" />
                </div>
                <div>
                  <h4 className="font-semibold text-foreground mb-1">{benefit.title}</h4>
                  <p className="text-sm text-muted-foreground">{benefit.desc}</p>
                </div>
              </div>
            ))}
          </div>
          
          <div className="text-center">
            <Link to="/login?role=worker">
              <Button size="lg" className="bg-secondary hover:bg-secondary/90 text-white px-8 py-6 text-lg rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105">
                Создать анкету исполнителя
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Social Proof & Numbers */}
      <section className="py-20 px-4 bg-muted/30">
        <div className="container mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center text-foreground mb-12">
            Сервис, который упрощает жизнь и HR, и исполнителям
          </h2>
          
          {/* Stats */}
          <div className="grid md:grid-cols-3 gap-8 mb-16">
            {[
              { value: "до 70%", label: "заявок закрываются в срок" },
              { value: "1000+", label: "исполнителей в базе по всей России" },
              { value: "~2 мин", label: "на создание заявки" }
            ].map((stat, index) => (
              <div key={index} className="text-center p-8 bg-card rounded-2xl border border-border hover:shadow-lg transition-all duration-300">
                <div className="text-4xl md:text-5xl font-bold text-primary mb-2">{stat.value}</div>
                <p className="text-muted-foreground">{stat.label}</p>
              </div>
            ))}
          </div>
          
          {/* Quote */}
          <div className="max-w-3xl mx-auto">
            <Card className="bg-card border-border">
              <CardContent className="p-8">
                <Quote className="w-10 h-10 text-secondary/30 mb-4" />
                <blockquote className="text-xl text-foreground mb-4 italic">
                  «Мы перестали держать десятки чатов — всё, что связано со сменами, теперь в "ЛЮДИ И РЕСУРСЫ".»
                </blockquote>
                <p className="text-muted-foreground">— HR-менеджер федеральной сети</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* How the Service Looks */}
      <section className="py-20 px-4">
        <div className="container mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center text-foreground mb-6">
            Понятные кабинеты для всех участников процесса
          </h2>
          <p className="text-center text-muted-foreground mb-12 max-w-2xl mx-auto">
            У каждой роли — свой удобный интерфейс с нужными функциями
          </p>
          
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { 
                title: "Кабинет HR", 
                desc: "Доска заявок с фильтрами, статусами и быстрым созданием новых запросов.",
                icon: Building2,
                color: "primary"
              },
              { 
                title: "Кабинет исполнителя", 
                desc: "Список смен с понятной ставкой и возможностью откликнуться в один клик.",
                icon: HardHat,
                color: "secondary"
              },
              { 
                title: "Панель администратора", 
                desc: "Подбор исполнителей, контроль выходов и поддержка пользователей.",
                icon: Shield,
                color: "primary"
              }
            ].map((cabinet, index) => (
              <Card key={index} className="bg-card border-border hover:shadow-xl transition-all duration-300 overflow-hidden group">
                <CardContent className="p-0">
                  {/* Preview placeholder */}
                  <div className={`h-48 bg-gradient-to-br ${cabinet.color === 'primary' ? 'from-primary/10 to-primary/5' : 'from-secondary/10 to-secondary/5'} flex items-center justify-center`}>
                    <cabinet.icon className={`w-16 h-16 ${cabinet.color === 'primary' ? 'text-primary/30' : 'text-secondary/30'} group-hover:scale-110 transition-transform duration-300`} />
                  </div>
                  <div className="p-6">
                    <h3 className="text-xl font-semibold text-foreground mb-2">{cabinet.title}</h3>
                    <p className="text-muted-foreground">{cabinet.desc}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20 px-4 bg-gradient-to-br from-primary via-primary/95 to-primary/90">
        <div className="container mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-12">
            Начните пользоваться «ЛЮДИ И РЕСУРСЫ» уже сегодня
          </h2>
          
          <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto mb-12">
            {/* For HR */}
            <div className="bg-white/10 backdrop-blur rounded-2xl p-8 text-left">
              <div className="flex items-center gap-3 mb-4">
                <Building2 className="w-8 h-8 text-white" />
                <h3 className="text-xl font-bold text-white">Для HR</h3>
              </div>
              <p className="text-white/80 mb-6">
                Подключите сервис к вашей сети и протестируйте его на одном объекте или пилотном проекте.
              </p>
              <Link to="/login?role=hr">
                <Button size="lg" className="w-full bg-white text-primary hover:bg-white/90 rounded-xl">
                  Запросить демонстрацию для HR
                </Button>
              </Link>
            </div>
            
            {/* For Workers */}
            <div className="bg-white/10 backdrop-blur rounded-2xl p-8 text-left">
              <div className="flex items-center gap-3 mb-4">
                <HardHat className="w-8 h-8 text-secondary" />
                <h3 className="text-xl font-bold text-white">Для исполнителей</h3>
              </div>
              <p className="text-white/80 mb-6">
                Создайте анкету и получите первые предложения по сменам.
              </p>
              <Link to="/login?role=worker">
                <Button size="lg" className="w-full bg-secondary text-white hover:bg-secondary/90 rounded-xl">
                  Стать исполнителем
                </Button>
              </Link>
            </div>
          </div>
          
          <p className="text-white/60 text-sm max-w-2xl mx-auto">
            «ЛЮДИ И РЕСУРСЫ» создан специально для работы с неквалифицированным персоналом: склады, сортировочные центры, магазины и другие объекты, где важна скорость и надёжность выхода людей на смену.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-4 bg-foreground">
        <div className="container mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center">
                <Users className="w-6 h-6 text-white" />
              </div>
              <span className="text-xl font-bold text-white">ЛЮДИ И РЕСУРСЫ</span>
            </div>
            <div className="flex items-center gap-6 text-white/60 text-sm">
              <div className="flex items-center gap-2">
                <Warehouse className="w-4 h-4" />
                <span>Склады</span>
              </div>
              <div className="flex items-center gap-2">
                <Store className="w-4 h-4" />
                <span>Магазины</span>
              </div>
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4" />
                <span>Сортировочные центры</span>
              </div>
            </div>
            <p className="text-white/60 text-sm">
              © 2025 ЛЮДИ И РЕСУРСЫ. Все права защищены.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
