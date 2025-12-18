import { Link } from "react-router-dom";
import { 
  Users, Check, Wallet, Zap, BarChart3, 
  ClipboardList, UserCheck, ChartLine, LayoutDashboard,
  ArrowRight, Send
} from "lucide-react";
import screenshotWorker from "@/assets/screenshot-worker-dashboard.png";
import screenshotHR from "@/assets/screenshot-hr-dashboard.png";

const Index = () => {
  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-md border-b border-border">
        <div className="max-w-7xl mx-auto px-4 py-3 md:py-4 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center flex-shrink-0">
              <Users className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg md:text-xl font-bold text-foreground">Работа для Всех</span>
          </div>
          
          {/* Nav Links */}
          <nav className="hidden md:flex items-center gap-6">
            <a href="#workers" className="text-foreground hover:text-primary hover:underline transition-colors">
              Для исполнителей
            </a>
            <a href="#hr" className="text-foreground hover:text-accent hover:underline transition-colors">
              Для HR
            </a>
          </nav>
          
          {/* Login Buttons */}
          <div className="flex items-center gap-2 md:gap-3">
            <Link to="/login?role=worker">
              <button className="px-3 md:px-4 py-2 border-2 border-primary text-primary text-sm font-medium rounded-lg hover:bg-primary hover:text-white transition-all duration-200">
                Вход
              </button>
            </Link>
            <Link to="/login?role=hr" className="hidden sm:block">
              <button className="px-3 md:px-4 py-2 border-2 border-accent text-foreground text-sm font-medium rounded-lg hover:bg-accent/10 transition-all duration-200">
                Вход (HR)
              </button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="pt-20 md:pt-24 min-h-[600px] md:min-h-[calc(100vh-80px)] relative">
        <div className="grid grid-cols-1 lg:grid-cols-2 h-full">
          {/* Left - Workers */}
          <div id="workers" className="bg-background flex flex-col justify-center p-8 md:p-12 lg:p-16 relative">
            <span className="lg:hidden section-label-worker mb-2">👤 Для исполнителей</span>
            
            <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-primary mb-4 md:mb-6 leading-tight">
              Смены сегодня — оплата завтра
            </h1>
            
            <p className="text-base md:text-lg text-muted-foreground leading-relaxed mb-6 md:mb-8 max-w-lg">
              Без резюме, без собеседований. Выбирай смены, которые подходят именно тебе, откликайся одним кликом и получай подтверждение в личном кабинете.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-3">
              <Link to="/login?role=worker" className="w-full sm:w-auto">
                <button className="w-full cta-button-primary">
                  Стать исполнителем
                  <ArrowRight className="w-5 h-5" />
                </button>
              </Link>
            </div>
          </div>
          
          {/* Right - HR */}
          <div id="hr" className="bg-muted flex flex-col justify-center p-8 md:p-12 lg:p-16 relative">
            <span className="lg:hidden section-label-hr mb-2">👔 Для HR</span>
            
            <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-foreground mb-4 md:mb-6 leading-tight">
              Закройте заявку за 24 часа
            </h1>
            
            <p className="text-base md:text-lg text-muted-foreground leading-relaxed mb-6 md:mb-8 max-w-lg">
              Готовая база исполнителей, автопубликация в соцсетях и полный контроль в одном личном кабинете. Вместо десятков чатов — одна удобная платформа.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-3">
              <Link to="/login?role=hr" className="w-full sm:w-auto">
                <button className="w-full cta-button-secondary">
                  Запросить демонстрацию
                  <ArrowRight className="w-5 h-5" />
                </button>
              </Link>
            </div>
          </div>
        </div>
        
        {/* Vertical Divider */}
        <div className="hidden lg:block absolute left-1/2 top-0 bottom-0 w-px bg-primary/15 -translate-x-1/2" />
      </section>

      {/* How it Works */}
      <section className="section-padding bg-background relative">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20">
            {/* Left - Workers */}
            <div>
              <span className="lg:hidden section-label-worker">👤 Для исполнителей</span>
              <h2 className="heading-2 text-foreground mb-8 md:mb-10">Как это работает</h2>
              
              <div className="space-y-6">
                {[
                  { title: "Заполните анкету", desc: "Укажите своё имя, номер телефона и опыт. Никакого резюме — только нужная информация." },
                  { title: "Смотрите смены", desc: "В личном кабинете видите ленту доступных смен по вашему городу, графику и ставке." },
                  { title: "Откликнитесь", desc: "Нашли подходящую смену? Откликнитесь одним кликом. Система сразу вас зарегистрирует." },
                  { title: "Выполните и получите оплату", desc: "Выходите на работу, отмечаете выполнение в кабинете, видите историю смен и оплат." }
                ].map((step, index) => (
                  <div key={index} className="flex gap-4">
                    <div className="step-number">{index + 1}</div>
                    <div className="flex-1 pt-1">
                      <h4 className="text-lg font-semibold text-foreground mb-1">{step.title}</h4>
                      <p className="text-sm text-muted-foreground">{step.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            {/* Right - HR */}
            <div>
              <span className="lg:hidden section-label-hr">👔 Для HR</span>
              <h2 className="heading-2 text-foreground mb-8 md:mb-10">Как это работает</h2>
              
              <div className="space-y-6">
                {[
                  { title: "Создайте заявку", desc: "За 2 минуты укажите дату, время, объект, должность и количество нужных людей." },
                  { title: "Система рассылает", desc: "Заявка автоматически публикуется в Telegram, VK и отправляется подходящим исполнителям." },
                  { title: "Менеджер подтверждает", desc: "Из откликнувшихся исполнителей выбираете нужных, менеджер подтверждает выход." },
                  { title: "Контролируйте результат", desc: "В личном кабинете видите статусы по каждому исполнителю: кто согласился, кто выйдет, кто уже отработал." }
                ].map((step, index) => (
                  <div key={index} className="flex gap-4">
                    <div className="step-number-hr">{index + 1}</div>
                    <div className="flex-1 pt-1">
                      <h4 className="text-lg font-semibold text-foreground mb-1">{step.title}</h4>
                      <p className="text-sm text-muted-foreground">{step.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        
        {/* Vertical Divider */}
        <div className="hidden lg:block absolute left-1/2 top-16 bottom-16 w-px bg-border -translate-x-1/2" />
      </section>

      {/* Benefits */}
      <section className="section-padding bg-muted relative">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20">
            {/* Left - Workers */}
            <div>
              <span className="lg:hidden section-label-worker">👤 Для исполнителей</span>
              <h2 className="heading-2 text-foreground mb-8 md:mb-10">Почему исполнители выбирают нас</h2>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[
                  { icon: Check, title: "Без резюме", desc: "Только базовая информация о себе. Ни сложных анкет, ни лишних вопросов." },
                  { icon: Wallet, title: "Понятные ставки", desc: "Видишь сразу, сколько платят за смену и что нужно делать." },
                  { icon: Zap, title: "Откликнись одним кликом", desc: "Выбрал смену — один клик, и ты в процессе. Никаких звонков и переписок." },
                  { icon: BarChart3, title: "История и прозрачность", desc: "Видишь все свои смены, выплаты и рейтинг. Всё отслеживается в кабинете." }
                ].map((benefit, index) => (
                  <div key={index} className="benefit-card">
                    <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center mb-3">
                      <benefit.icon className="w-5 h-5 text-primary" />
                    </div>
                    <h4 className="text-lg font-semibold text-foreground mb-2">{benefit.title}</h4>
                    <p className="text-sm text-muted-foreground leading-relaxed">{benefit.desc}</p>
                  </div>
                ))}
              </div>
            </div>
            
            {/* Right - HR */}
            <div>
              <span className="lg:hidden section-label-hr">👔 Для HR</span>
              <h2 className="heading-2 text-foreground mb-8 md:mb-10">Почему HR выбирают нас</h2>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[
                  { icon: Check, title: "Быстрое закрытие заявок", desc: "До 70% заявок закрываются в срок благодаря готовой базе исполнителей и автопубликации." },
                  { icon: Users, title: "Готовая база исполнителей", desc: "1000+ проверенных исполнителей по всей России. Рейтинги и история работ." },
                  { icon: LayoutDashboard, title: "Полный контроль в одном месте", desc: "Вместо десятков чатов, таблиц и звонков — всё в одном личном кабинете с ясными статусами." },
                  { icon: ChartLine, title: "Аналитика и история", desc: "Отслеживайте тренды по объектам, датам и исполнителям. Экспортируйте отчёты." }
                ].map((benefit, index) => (
                  <div key={index} className="benefit-card-hr">
                    <div className="w-10 h-10 bg-accent/20 rounded-full flex items-center justify-center mb-3">
                      <benefit.icon className="w-5 h-5 text-accent" />
                    </div>
                    <h4 className="text-lg font-semibold text-foreground mb-2">{benefit.title}</h4>
                    <p className="text-sm text-muted-foreground leading-relaxed">{benefit.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        
        {/* Vertical Divider */}
        <div className="hidden lg:block absolute left-1/2 top-16 bottom-16 w-px bg-border -translate-x-1/2" />
      </section>

      {/* Cabinets Preview */}
      <section className="section-padding bg-background relative">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20">
            {/* Left - Workers Cabinet */}
            <div>
              <span className="lg:hidden section-label-worker">👤 Для исполнителей</span>
              <h3 className="text-2xl md:text-3xl font-semibold text-foreground mb-4">Ваш личный кабинет исполнителя</h3>
              <p className="text-muted-foreground mb-6">
                Лента доступных смен, быстрый отклик, история выполненных работ и заработков.
              </p>
              
              <div className="cabinet-preview">
                <img 
                  src={screenshotWorker} 
                  alt="Кабинет исполнителя" 
                  className="w-full h-auto rounded-lg"
                  loading="lazy"
                />
                <ul className="mt-4 space-y-2">
                  {[
                    "Лента доступных смен с фильтрами",
                    "Быстрый отклик одной кнопкой",
                    "Подтверждение выхода от HR",
                    "История работ и выплат"
                  ].map((item, index) => (
                    <li key={index} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Check className="w-4 h-4 text-primary flex-shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            
            {/* Right - HR Cabinet */}
            <div>
              <span className="lg:hidden section-label-hr">👔 Для HR</span>
              <h3 className="text-2xl md:text-3xl font-semibold text-foreground mb-4">Ваш личный кабинет HR</h3>
              <p className="text-muted-foreground mb-6">
                Доска заявок с фильтрами, создание новых смен за 2 минуты, список откликнувшихся исполнителей, полный контроль статусов.
              </p>
              
              <div className="cabinet-preview">
                <img 
                  src={screenshotHR} 
                  alt="Кабинет HR" 
                  className="w-full h-auto rounded-lg"
                  loading="lazy"
                />
                <ul className="mt-4 space-y-2">
                  {[
                    "Доска заявок с быстрым созданием",
                    "Список откликнувшихся исполнителей",
                    "Подтверждение выхода",
                    "Статусы по каждому исполнителю"
                  ].map((item, index) => (
                    <li key={index} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Check className="w-4 h-4 text-accent flex-shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
        
        {/* Vertical Divider */}
        <div className="hidden lg:block absolute left-1/2 top-16 bottom-16 w-px bg-border -translate-x-1/2" />
      </section>

      {/* Statistics & Social Proof */}
      <section className="section-padding bg-muted relative">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20">
            {/* Left - Workers Stats */}
            <div>
              <span className="lg:hidden section-label-worker">👤 Для исполнителей</span>
              
              <div className="grid grid-cols-2 gap-6 mb-8">
                <div>
                  <p className="stat-number-worker">1000+</p>
                  <p className="text-sm text-muted-foreground mt-1">Исполнителей в базе по России</p>
                </div>
                <div>
                  <p className="stat-number-worker">~2 мин</p>
                  <p className="text-sm text-muted-foreground mt-1">На регистрацию и анкету</p>
                </div>
              </div>
              
              <div className="bg-background p-6 rounded-xl border border-border">
                <p className="quote-text italic mb-4">
                  "Просто создал профиль и сразу получил 3 предложения на завтра. Без никакой рутины."
                </p>
                <p className="text-sm font-medium text-foreground">— Иван, исполнитель, Москва</p>
              </div>
            </div>
            
            {/* Right - HR Stats */}
            <div>
              <span className="lg:hidden section-label-hr">👔 Для HR</span>
              
              <div className="grid grid-cols-2 gap-6 mb-8">
                <div>
                  <p className="stat-number-hr">70%</p>
                  <p className="text-sm text-muted-foreground mt-1">Заявок закрываются в срок</p>
                </div>
                <div>
                  <p className="stat-number-hr">99%</p>
                  <p className="text-sm text-muted-foreground mt-1">Показатель выхода на смены</p>
                </div>
              </div>
              
              <div className="bg-background p-6 rounded-xl border border-border">
                <p className="quote-text italic mb-4">
                  "Перестали держать десятки чатов. Всё, что связано со сменами, теперь в «Работа для Всех». Сбережения на время координации — огромные."
                </p>
                <p className="text-sm font-medium text-foreground">— HR-менеджер федеральной сети</p>
              </div>
            </div>
          </div>
        </div>
        
        {/* Vertical Divider */}
        <div className="hidden lg:block absolute left-1/2 top-16 bottom-16 w-px bg-border -translate-x-1/2" />
      </section>

      {/* Final CTA */}
      <section className="section-padding bg-[hsl(0,0%,10%)] relative">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20">
            {/* Left - Workers */}
            <div className="text-center lg:text-left">
              <span className="lg:hidden inline-flex items-center gap-2 px-4 py-1.5 bg-primary/20 text-primary rounded-full text-sm font-medium mb-4">
                👤 Для исполнителей
              </span>
              
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">Готовы начать?</h2>
              <p className="text-base text-gray-400 mb-6 max-w-md mx-auto lg:mx-0">
                Создайте анкету прямо сейчас и получите первые предложения уже сегодня.
              </p>
              
              <Link to="/login?role=worker" className="inline-block w-full sm:w-auto">
                <button className="w-full sm:w-auto cta-button-primary px-10 py-4">
                  Стать исполнителем
                </button>
              </Link>
              
              <p className="mt-4">
                <Link to="/login?role=worker" className="text-sm text-primary hover:underline">
                  Уже есть аккаунт? Войти
                </Link>
              </p>
            </div>
            
            {/* Right - HR */}
            <div className="text-center lg:text-left">
              <span className="lg:hidden inline-flex items-center gap-2 px-4 py-1.5 bg-accent/20 text-accent rounded-full text-sm font-medium mb-4">
                👔 Для HR
              </span>
              
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">Готовы увеличить скорость?</h2>
              <p className="text-base text-gray-400 mb-6 max-w-md mx-auto lg:mx-0">
                Подключите сервис к вашей сети и протестируйте на одном объекте. Никаких долгих контрактов.
              </p>
              
              <Link to="/login?role=hr" className="inline-block w-full sm:w-auto">
                <button className="w-full sm:w-auto cta-button-secondary-dark px-10 py-4">
                  Запросить демонстрацию
                </button>
              </Link>
              
              <p className="mt-4">
                <Link to="/login?role=hr" className="text-sm text-accent hover:underline">
                  Уже партнёр? Войти в кабинет
                </Link>
              </p>
            </div>
          </div>
        </div>
        
        {/* Vertical Divider */}
        <div className="hidden lg:block absolute left-1/2 top-16 bottom-16 w-px bg-white/10 -translate-x-1/2" />
      </section>

      {/* Footer */}
      <footer className="bg-[hsl(0,0%,10%)] border-t border-white/10 py-10 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Logo & Copyright */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <Users className="w-5 h-5 text-white" />
                </div>
                <span className="text-lg font-bold text-white">Работа для Всех</span>
              </div>
              <p className="text-sm text-gray-500">© 2025 Работа для Всех. Все права защищены.</p>
              
              {/* Social Links */}
              <div className="flex gap-3 mt-4">
                <a href="#" className="w-10 h-10 bg-white/5 hover:bg-white/10 rounded-lg flex items-center justify-center transition-colors">
                  <Send className="w-5 h-5 text-gray-400" />
                </a>
              </div>
            </div>
            
            {/* Workers Links */}
            <div>
              <h4 className="text-sm font-semibold text-white mb-4">Для исполнителей</h4>
              <ul className="space-y-2">
                <li><Link to="/login?role=worker" className="text-sm text-gray-400 hover:text-primary transition-colors">Регистрация</Link></li>
                <li><Link to="/login?role=worker" className="text-sm text-gray-400 hover:text-primary transition-colors">Вход</Link></li>
                <li><a href="#" className="text-sm text-gray-400 hover:text-primary transition-colors">FAQ</a></li>
              </ul>
            </div>
            
            {/* HR Links */}
            <div>
              <h4 className="text-sm font-semibold text-white mb-4">Для HR</h4>
              <ul className="space-y-2">
                <li><Link to="/login?role=hr" className="text-sm text-gray-400 hover:text-accent transition-colors">Демонстрация</Link></li>
                <li><Link to="/login?role=hr" className="text-sm text-gray-400 hover:text-accent transition-colors">Вход</Link></li>
                <li><a href="#" className="text-sm text-gray-400 hover:text-accent transition-colors">Контакты</a></li>
              </ul>
            </div>
          </div>
          
          {/* Bottom Links */}
          <div className="mt-8 pt-8 border-t border-white/10 flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex gap-4">
              <a href="#" className="text-xs text-gray-500 hover:text-gray-300 transition-colors">О сервисе</a>
              <a href="#" className="text-xs text-gray-500 hover:text-gray-300 transition-colors">Политика конфиденциальности</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
