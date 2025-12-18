import { Link } from "react-router-dom";
import PageMeta from "@/components/PageMeta";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import logo from "@/assets/logo.png";

const Terms = () => {
  return (
    <div className="min-h-screen bg-background">
      <PageMeta 
        title="Условия использования" 
        description="Условия использования сервиса Работа для Всех. Правила и соглашения для пользователей платформы."
      />
      
      {/* Header */}
      <header className="border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <img src={logo} alt="Работа для Всех" className="w-8 h-8 object-cover rounded-full" />
            <span className="font-bold text-foreground">РАБОТА ДЛЯ ВСЕХ</span>
          </Link>
          <Link to="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              На главную
            </Button>
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="container mx-auto px-4 py-12 max-w-4xl">
        <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-8">
          Условия использования
        </h1>
        
        <div className="prose prose-sm sm:prose max-w-none text-muted-foreground space-y-6">
          <p className="text-sm text-muted-foreground">
            Последнее обновление: 1 января 2025 г.
          </p>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-4">1. Общие положения</h2>
            <p>
              Настоящие Условия использования (далее — Условия) регулируют отношения между 
              администрацией сервиса «Работа для Всех» (далее — Сервис) и пользователями Сервиса.
            </p>
            <p>
              Регистрация и использование Сервиса означает полное и безоговорочное принятие 
              настоящих Условий.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-4">2. Описание Сервиса</h2>
            <p>
              Сервис «Работа для Всех» — это онлайн-платформа для подбора временного персонала, 
              которая связывает HR-менеджеров федеральных сетей с исполнителями, ищущими временную работу.
            </p>
            <p>Сервис предоставляет следующие возможности:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Для HR-менеджеров: создание заявок на персонал, управление откликами, контроль статусов</li>
              <li>Для исполнителей: просмотр доступных смен, отклик на заявки, ведение истории работы</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-4">3. Регистрация и аккаунт</h2>
            <p>
              Для использования Сервиса необходимо зарегистрироваться, указав достоверные данные.
            </p>
            <p>Пользователь обязуется:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Предоставлять актуальную и достоверную информацию</li>
              <li>Обеспечивать конфиденциальность данных для входа в аккаунт</li>
              <li>Незамедлительно уведомлять о несанкционированном доступе к аккаунту</li>
              <li>Не передавать доступ к аккаунту третьим лицам</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-4">4. Правила использования</h2>
            <p>При использовании Сервиса запрещается:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Размещать заведомо ложную информацию</li>
              <li>Нарушать права третьих лиц</li>
              <li>Использовать Сервис для незаконной деятельности</li>
              <li>Пытаться получить несанкционированный доступ к системе</li>
              <li>Распространять вредоносное программное обеспечение</li>
              <li>Осуществлять действия, нарушающие работу Сервиса</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-4">5. Обязанности HR-менеджеров</h2>
            <p>HR-менеджеры обязуются:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Размещать достоверную информацию о вакансиях и условиях работы</li>
              <li>Указывать реальную оплату труда</li>
              <li>Соблюдать трудовое законодательство РФ</li>
              <li>Своевременно обновлять статусы заявок</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-4">6. Обязанности исполнителей</h2>
            <p>Исполнители обязуются:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Предоставлять достоверную информацию о себе</li>
              <li>Выходить на подтверждённые смены или своевременно отменять участие</li>
              <li>Добросовестно выполнять рабочие обязанности</li>
              <li>Соблюдать правила объекта, на котором выполняется работа</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-4">7. Ограничение ответственности</h2>
            <p>
              Сервис является платформой для связи HR-менеджеров и исполнителей. 
              Администрация Сервиса не несёт ответственности за:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Качество выполнения работ исполнителями</li>
              <li>Выполнение обязательств по оплате со стороны работодателей</li>
              <li>Достоверность информации, размещённой пользователями</li>
              <li>Любые споры между пользователями</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-4">8. Блокировка аккаунта</h2>
            <p>
              Администрация Сервиса вправе заблокировать или удалить аккаунт пользователя 
              в случае нарушения настоящих Условий без предварительного уведомления.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-4">9. Изменение Условий</h2>
            <p>
              Администрация Сервиса вправе изменять настоящие Условия. Актуальная версия 
              всегда доступна на данной странице. Продолжение использования Сервиса после 
              изменения Условий означает согласие с новой редакцией.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-4">10. Применимое право</h2>
            <p>
              Настоящие Условия регулируются законодательством Российской Федерации. 
              Все споры подлежат разрешению в соответствии с действующим законодательством РФ.
            </p>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-8 px-4 border-t border-border">
        <div className="container mx-auto text-center">
          <p className="text-sm text-muted-foreground">
            © 2025 РАБОТА ДЛЯ ВСЕХ. Все права защищены.
          </p>
        </div>
      </footer>
    </div>
  );
};

export default Terms;
