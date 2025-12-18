import { Link } from "react-router-dom";
import PageMeta from "@/components/PageMeta";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import logo from "@/assets/logo.png";

const PrivacyPolicy = () => {
  return (
    <div className="min-h-screen bg-background">
      <PageMeta 
        title="Политика конфиденциальности" 
        description="Политика конфиденциальности сервиса Работа для Всех. Информация о сборе, использовании и защите персональных данных."
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
          Политика конфиденциальности
        </h1>
        
        <div className="prose prose-sm sm:prose max-w-none text-muted-foreground space-y-6">
          <p className="text-sm text-muted-foreground">
            Последнее обновление: 1 января 2025 г.
          </p>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-4">1. Общие положения</h2>
            <p>
              Настоящая Политика конфиденциальности определяет порядок обработки и защиты персональных данных 
              пользователей сервиса «Работа для Всех» (далее — Сервис).
            </p>
            <p>
              Использование Сервиса означает согласие пользователя с настоящей Политикой и условиями 
              обработки его персональных данных.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-4">2. Какие данные мы собираем</h2>
            <p>Мы можем собирать следующие категории персональных данных:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Контактная информация: имя, фамилия, адрес электронной почты, номер телефона</li>
              <li>Профессиональные данные: опыт работы, предпочитаемые позиции, график работы</li>
              <li>Данные компании: название организации, ИНН, адрес (для HR-пользователей)</li>
              <li>Технические данные: IP-адрес, тип браузера, информация об устройстве</li>
              <li>Данные об использовании: история заявок, откликов, взаимодействия с Сервисом</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-4">3. Цели обработки данных</h2>
            <p>Персональные данные обрабатываются в следующих целях:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Предоставление доступа к функциям Сервиса</li>
              <li>Связь между HR-менеджерами и исполнителями</li>
              <li>Обработка заявок на подбор персонала</li>
              <li>Улучшение качества Сервиса</li>
              <li>Техническая поддержка пользователей</li>
              <li>Выполнение требований законодательства</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-4">4. Защита данных</h2>
            <p>
              Мы принимаем необходимые организационные и технические меры для защиты персональных данных 
              от несанкционированного доступа, изменения, раскрытия или уничтожения.
            </p>
            <p>
              Доступ к персональным данным имеют только уполномоченные сотрудники, которым эта информация 
              необходима для выполнения их должностных обязанностей.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-4">5. Передача данных третьим лицам</h2>
            <p>
              Мы не передаём персональные данные третьим лицам, за исключением случаев:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Получения согласия пользователя</li>
              <li>Необходимости для оказания услуг (например, передача данных исполнителя HR-менеджеру)</li>
              <li>Требований законодательства РФ</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-4">6. Права пользователей</h2>
            <p>Пользователи имеют право:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Получить информацию об обработке своих персональных данных</li>
              <li>Требовать уточнения или исправления своих данных</li>
              <li>Требовать удаления своих данных</li>
              <li>Отозвать согласие на обработку персональных данных</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-4">7. Файлы cookie</h2>
            <p>
              Сервис использует файлы cookie для обеспечения корректной работы, аналитики и улучшения 
              пользовательского опыта. Пользователь может отключить cookie в настройках браузера.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-4">8. Контактная информация</h2>
            <p>
              По вопросам, связанным с обработкой персональных данных, вы можете обратиться через 
              раздел поддержки в личном кабинете.
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

export default PrivacyPolicy;
