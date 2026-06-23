import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import PageMeta from "@/components/PageMeta";
import ScrollReveal from "@/components/ScrollReveal";

import { PWAInstallPrompt } from "@/components/PWAInstallPrompt";
import logo from "@/assets/logo.png";
import {
  Users, Rocket, HardHat, Clock, MapPin, Shield, Zap, 
  FileText, Send, CheckCircle, ClipboardList, Bell, 
  UserCheck, History, BarChart3, MessageSquare, Eye,
  Building2, Warehouse, Store, Quote
} from "lucide-react";

// FAQ items for structured data
const faqItems = [
  {
    question: "Что такое сервис «Работа для Всех»?",
    answer: "«Работа для Всех» — это онлайн-платформа для подбора временного персонала, которая связывает HR-менеджеров федеральных сетей с исполнителями, ищущими временную работу на складах, в магазинах и сортировочных центрах."
  },
  {
    question: "Как HR-менеджеру найти персонал?",
    answer: "Зарегистрируйтесь как HR, создайте заявку с указанием даты, адреса, количества людей и оплаты. Сервис автоматически разошлёт её исполнителям и опубликует в соцсетях. Вы увидите отклики в личном кабинете."
  },
  {
    question: "Как исполнителю найти работу?",
    answer: "Зарегистрируйтесь как исполнитель, заполните простую анкету без резюме, и получайте подходящие смены по городу и графику. Откликайтесь в один клик и получайте подтверждение в личном кабинете."
  },
  {
    question: "Сколько стоит использование сервиса?",
    answer: "Регистрация и базовое использование сервиса бесплатны. Подробности о тарифах можно уточнить в службе поддержки."
  },
  {
    question: "Какие объекты обслуживает сервис?",
    answer: "Сервис специализируется на подборе неквалифицированного персонала для складов, сортировочных центров, магазинов и других объектов федеральных сетей по всей России."
  }
];

const Index = () => {
  return (
    <div className="min-h-screen bg-background pb-20 sm:pb-0">
      {/* Mobile PWA Install Banner */}
      <div className="sm:hidden">
        <PWAInstallPrompt variant="mobile-banner" />
      </div>
      <PageMeta 
        title="Главная" 
        description="Работа для Всех — современная платформа для подбора временного персонала. Быстрый поиск исполнителей для HR и удобные смены для работников."
        faqItems={faqItems}
      />
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src={logo} alt="Работа для Всех" className="w-8 h-8 sm:w-10 sm:h-10 object-cover rounded-full flex-shrink-0" />
            <span className="text-base sm:text-xl font-bold text-foreground truncate">РАБОТА ДЛЯ ВСЕХ</span>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/login">
              <Button variant="outline" size="sm" className="border-primary text-primary hover:bg-primary hover:text-white flex-shrink-0">
                Войти
              </Button>
            </Link>
          </div>
        </div>
      </header>
      <main>
      {/* Hero Section */}
      <section className="pt-24 sm:pt-28 pb-12 sm:pb-20 px-4 bg-gradient-to-br from-primary/5 via-background to-secondary/5 animate-fade-in overflow-hidden">
        <div className="container mx-auto max-w-6xl">
          <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-center">
            {/* Text Block */}
            <div className="text-center lg:text-left relative z-10">
              <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl xl:text-6xl font-bold text-foreground mb-4 sm:mb-6 leading-tight px-2 sm:px-0">
                Аутсорсинг персонала{" "}
                <span className="text-primary">в один клик</span>
              </h1>
              <p className="text-sm sm:text-base md:text-lg lg:text-xl text-muted-foreground mb-6 sm:mb-8 max-w-xl mx-auto lg:mx-0 px-2 sm:px-0">
                Онлайн‑сервис «РАБОТА ДЛЯ ВСЕХ», который помогает федеральным сетям быстро закрывать заявки на неквалифицированный персонал и даёт исполнителям простой способ находить смены с понятной оплатой.
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
      <section className="py-20 px-4 bg-muted/30">
        <div className="container mx-auto">
          <ScrollReveal animation="fade-up">
            <h2 className="text-3xl md:text-4xl font-bold text-center text-foreground mb-12">
              Как работает «РАБОТА ДЛЯ ВСЕХ»
            </h2>
          </ScrollReveal>
          
          <div className="grid lg:grid-cols-2 gap-8 mb-12">
            {/* HR Column */}
            <ScrollReveal animation="fade-right" delay={100}>
              <Card className="bg-card border-border hover:border-primary/50 transition-all duration-300 hover:shadow-xl h-full">
              <CardContent className="p-8">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 bg-primary/10 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Building2 className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
                  </div>
                  <h3 className="text-xl sm:text-2xl font-bold text-foreground">Для HR федеральных сетей</h3>
                </div>
                
                <div className="space-y-5">
                  {[
                    { icon: ClipboardList, text: "Создаёте заявку на нужные даты и объект за пару минут." },
                    { icon: Send, text: "Сервис автоматически рассылает её исполнителям и публикует в Telegram и VK." },
                    { icon: UserCheck, text: "Менеджер аутсорсинговой компании подбирает людей и подтверждает выход." },
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
            </ScrollReveal>

            {/* Workers Column */}
            <ScrollReveal animation="fade-left" delay={200}>
            <Card className="bg-card border-border hover:border-secondary/50 transition-all duration-300 hover:shadow-xl h-full">
              <CardContent className="p-8">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 bg-secondary/10 rounded-xl flex items-center justify-center flex-shrink-0">
                    <HardHat className="w-5 h-5 sm:w-6 sm:h-6 text-secondary" />
                  </div>
                  <h3 className="text-xl sm:text-2xl font-bold text-foreground">Для исполнителей</h3>
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
            </ScrollReveal>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center px-4">
            <Link to="/login?role=hr" className="w-full sm:w-auto">
              <Button variant="outline" className="w-full border-primary text-primary hover:bg-primary hover:text-white">
                Перейти в кабинет HR
              </Button>
            </Link>
            <Link to="/login?role=worker" className="w-full sm:w-auto">
              <Button variant="outline" className="w-full border-secondary text-secondary hover:bg-secondary hover:text-white">
                Перейти в кабинет исполнителя
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Benefits for HR */}
      <section className="py-20 px-4 bg-primary/5">
        <div className="container mx-auto">
          <ScrollReveal animation="fade-up">
            <h2 className="text-3xl md:text-4xl font-bold text-center text-foreground mb-12">
              Почему HR выбирают «РАБОТА ДЛЯ ВСЕХ»
            </h2>
          </ScrollReveal>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-10">
            {[
              { icon: Zap, title: "Быстрое закрытие заявок", desc: "Готовая база исполнителей и автопубликации в соцсети." },
              { icon: ClipboardList, title: "Единый личный кабинет", desc: "Вместо мессенджеров, таблиц и личных контактов." },
              { icon: Eye, title: "Прозрачные статусы", desc: "По каждой заявке: от создания до выхода людей на смену." },
              { icon: MessageSquare, title: "Меньше звонков", desc: "Меньше ручных звонков и переписок — больше контроля." },
              { icon: BarChart3, title: "История и аналитика", desc: "История заявок и базовая аналитика по точкам и датам." },
              { icon: Shield, title: "Надёжность", desc: "Проверенные исполнители с рейтингом и историей." }
            ].map((benefit, index) => (
              <ScrollReveal key={index} animation="zoom-in" delay={index * 100}>
                <div 
                  className="flex items-start gap-4 p-6 rounded-2xl bg-card border border-border hover:border-primary/30 hover:shadow-lg transition-all duration-300 h-full"
                >
                  <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center flex-shrink-0">
                    <benefit.icon className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-foreground mb-1">{benefit.title}</h4>
                    <p className="text-sm text-muted-foreground">{benefit.desc}</p>
                  </div>
                </div>
              </ScrollReveal>
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
          <ScrollReveal animation="fade-up">
            <h2 className="text-3xl md:text-4xl font-bold text-center text-foreground mb-12">
              Почему исполнителям удобно работать через «РАБОТА ДЛЯ ВСЕХ»
            </h2>
          </ScrollReveal>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-10">
            {[
              { icon: FileText, title: "Понятные смены", desc: "Где работать, сколько часов и сколько платят." },
              { icon: CheckCircle, title: "Без резюме", desc: "Без резюме и сложных анкет — достаточно базовой информации." },
              { icon: ClipboardList, title: "Всё в одном месте", desc: "Все отклики и подтверждения в одном личном кабинете." },
              { icon: MapPin, title: "Удобный график", desc: "Можно выбирать удобный график и локации." },
              { icon: History, title: "История смен", desc: "Видна история уже отработанных смен." }
            ].map((benefit, index) => (
              <ScrollReveal key={index} animation="zoom-in" delay={index * 100}>
                <div 
                  className="flex items-start gap-4 p-6 rounded-2xl bg-card border border-border hover:border-secondary/30 hover:shadow-lg transition-all duration-300 h-full"
                >
                  <div className="w-12 h-12 bg-secondary/10 rounded-xl flex items-center justify-center flex-shrink-0">
                    <benefit.icon className="w-6 h-6 text-secondary" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-foreground mb-1">{benefit.title}</h4>
                    <p className="text-sm text-muted-foreground">{benefit.desc}</p>
                  </div>
                </div>
              </ScrollReveal>
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
          <ScrollReveal animation="fade-up">
            <h2 className="text-3xl md:text-4xl font-bold text-center text-foreground mb-12">
              Сервис, который упрощает жизнь и HR, и исполнителям
            </h2>
          </ScrollReveal>
          
          {/* Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-8 mb-16">
            {[
              { value: "до 70%", label: "заявок закрываются в срок" },
              { value: "1000+", label: "исполнителей в базе по всей России" },
              { value: "~2 мин", label: "на создание заявки" }
            ].map((stat, index) => (
              <ScrollReveal key={index} animation="fade-up" delay={index * 150}>
                <div className="text-center p-6 sm:p-8 bg-card rounded-2xl border border-border hover:shadow-lg transition-all duration-300">
                  <div className="text-3xl sm:text-4xl md:text-5xl font-bold text-primary mb-2">{stat.value}</div>
                  <p className="text-sm sm:text-base text-muted-foreground">{stat.label}</p>
                </div>
              </ScrollReveal>
            ))}
          </div>
          
          {/* Quote */}
          <ScrollReveal animation="zoom-in" delay={300}>
            <div className="max-w-3xl mx-auto">
              <Card className="bg-card border-border">
                <CardContent className="p-8">
                  <Quote className="w-10 h-10 text-secondary/30 mb-4" />
                  <blockquote className="text-xl text-foreground mb-4 italic">
                    «Мы перестали держать десятки чатов — всё, что связано со сменами, теперь в "РАБОТА ДЛЯ ВСЕХ".»
                  </blockquote>
                  <p className="text-muted-foreground">— HR-менеджер федеральной сети</p>
                </CardContent>
              </Card>
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* How the Service Looks */}
      <section className="py-20 px-4">
        <div className="container mx-auto">
          <ScrollReveal animation="fade-up">
            <h2 className="text-3xl md:text-4xl font-bold text-center text-foreground mb-6">
              Понятные кабинеты для всех участников процесса
            </h2>
            <p className="text-center text-muted-foreground mb-12 max-w-2xl mx-auto">
              У каждой роли — свой удобный интерфейс с нужными функциями
            </p>
          </ScrollReveal>
          
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
              <ScrollReveal key={index} animation="fade-up" delay={index * 150}>
                <Card className="bg-card border-border hover:shadow-xl transition-all duration-300 overflow-hidden group h-full">
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
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20 px-4 bg-gradient-to-br from-primary via-primary/95 to-primary/90">
        <div className="container mx-auto text-center">
          <ScrollReveal animation="fade-up">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-12">
              Начните пользоваться «РАБОТА ДЛЯ ВСЕХ» уже сегодня
            </h2>
          </ScrollReveal>
          
          <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto mb-12">
            {/* For HR */}
            <ScrollReveal animation="fade-right" delay={100}>
              <div className="bg-white/10 backdrop-blur rounded-2xl p-8 text-left flex flex-col h-full">
                <div className="flex items-center gap-3 mb-4">
                  <Building2 className="w-8 h-8 text-white" />
                  <h3 className="text-xl font-bold text-white">Для HR</h3>
                </div>
                <p className="text-white/80 mb-6 flex-1">
                  Подключите сервис к вашей сети и протестируйте его на одном объекте или пилотном проекте.
                </p>
                <Link to="/login?role=hr" className="mt-auto">
                  <Button size="lg" className="w-full bg-white text-primary hover:bg-white/90 rounded-xl">
                    Запросить демонстрацию для HR
                  </Button>
                </Link>
              </div>
            </ScrollReveal>
            
            {/* For Workers */}
            <ScrollReveal animation="fade-left" delay={200}>
              <div className="bg-white/10 backdrop-blur rounded-2xl p-8 text-left flex flex-col h-full">
                <div className="flex items-center gap-3 mb-4">
                  <HardHat className="w-8 h-8 text-secondary" />
                  <h3 className="text-xl font-bold text-white">Для исполнителей</h3>
                </div>
                <p className="text-white/80 mb-6 flex-1">
                  Создайте анкету и получите первые предложения по сменам.
                </p>
                <Link to="/login?role=worker" className="mt-auto">
                  <Button size="lg" className="w-full bg-secondary text-white hover:bg-secondary/90 rounded-xl">
                    Стать исполнителем
                  </Button>
                </Link>
              </div>
            </ScrollReveal>
          </div>
          
          <p className="text-white/60 text-sm max-w-2xl mx-auto">
            «РАБОТА ДЛЯ ВСЕХ» создан специально для работы с неквалифицированным персоналом: склады, сортировочные центры, магазины и другие объекты, где важна скорость и надёжность выхода людей на смену.
          </p>
        </div>
      </section>
      </main>

      {/* Footer */}
      <footer className="py-8 sm:py-12 px-4 bg-foreground">
        <div className="container mx-auto">
          <div className="flex flex-col items-center gap-6 text-center">
            <div className="flex items-center gap-2">
              <img src={logo} alt="Работа для Всех" className="w-8 h-8 sm:w-10 sm:h-10 object-cover rounded-full" />
              <span className="text-lg sm:text-xl font-bold text-white">РАБОТА ДЛЯ ВСЕХ</span>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6 text-white/60 text-xs sm:text-sm">
              <div className="flex items-center gap-2">
                <Warehouse className="w-4 h-4 flex-shrink-0" />
                <span>Склады</span>
              </div>
              <div className="flex items-center gap-2">
                <Store className="w-4 h-4 flex-shrink-0" />
                <span>Магазины</span>
              </div>
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 flex-shrink-0" />
                <span>Сортировочные центры</span>
              </div>
            </div>
            
            {/* Legal links */}
            <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6 text-white/60 text-xs sm:text-sm">
              <Link to="/contact" className="hover:text-white transition-colors">
                Контакты
              </Link>
              <Link to="/privacy" className="hover:text-white transition-colors">
                Политика конфиденциальности
              </Link>
              <Link to="/terms" className="hover:text-white transition-colors">
                Условия использования
              </Link>
            </div>
            
            {/* Company info */}
            <div className="text-white/40 text-xs space-y-1">
              <p>ООО «АРХИМЕД ЛИР» | ИНН: 5610256637 | ОГРН: 1255600003955</p>
              <p>460026, Оренбургская обл., г. Оренбург, ул. Одесская, д. 100</p>
            </div>
            
            <p className="text-white/60 text-xs sm:text-sm">
              © 2025 РАБОТА ДЛЯ ВСЕХ. Все права защищены.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
