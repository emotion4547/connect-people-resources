import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FileText, Send, Users, Rocket, HardHat, Clock, MapPin, Shield, Zap } from "lucide-react";

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
      <section className="pt-32 pb-20 px-4 animate-fade-in">
        <div className="container mx-auto text-center">
          <div className="inline-block px-4 py-2 bg-secondary/20 rounded-full text-secondary font-medium mb-6 animate-float-up">
            ✨ Платформа для аутстаффинга персонала
          </div>
          <h1 className="text-4xl md:text-6xl font-bold text-foreground mb-6 leading-tight">
            Аутстаффинг персонала<br />
            <span className="text-primary">в один клик</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
            Онлайн‑сервис «ЛЮДИ И РЕСУРСЫ» для быстрого закрытия заявок 
            на неквалифицированный персонал для федеральных сетей
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/login?role=hr">
              <Button size="lg" className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-white px-8 py-6 text-lg rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105">
                <Rocket className="w-5 h-5 mr-2" />
                Для федеральных сетей (HR)
              </Button>
            </Link>
            <Link to="/login?role=worker">
              <Button size="lg" variant="outline" className="w-full sm:w-auto border-2 border-secondary text-secondary hover:bg-secondary hover:text-white px-8 py-6 text-lg rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105">
                <HardHat className="w-5 h-5 mr-2" />
                Для исполнителей
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-20 px-4 bg-muted/30">
        <div className="container mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center text-foreground mb-4">
            Как это работает
          </h2>
          <p className="text-center text-muted-foreground mb-12 max-w-xl mx-auto">
            Простой и прозрачный процесс подбора персонала за три шага
          </p>
          
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon: FileText,
                title: "HR создает заявку за 2 минуты",
                description: "Укажите должность, даты, адрес и количество сотрудников — заявка готова",
                step: "01"
              },
              {
                icon: Send,
                title: "Автопубликация в соцсетях",
                description: "Заявка автоматически публикуется в Telegram, VK и каталоге исполнителей",
                step: "02"
              },
              {
                icon: Users,
                title: "Менеджер назначает исполнителей",
                description: "Прозрачные статусы, история откликов и полный контроль процесса",
                step: "03"
              }
            ].map((item, index) => (
              <Card 
                key={index} 
                className="bg-card border-border hover:border-secondary transition-all duration-300 hover:shadow-xl group animate-float-up"
                style={{ animationDelay: `${index * 0.1}s` }}
              >
                <CardContent className="p-8 text-center">
                  <div className="relative mb-6">
                    <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto group-hover:bg-primary/20 transition-colors">
                      <item.icon className="w-8 h-8 text-primary" />
                    </div>
                    <span className="absolute -top-2 -right-2 w-8 h-8 bg-secondary text-white text-sm font-bold rounded-full flex items-center justify-center">
                      {item.step}
                    </span>
                  </div>
                  <h3 className="text-xl font-semibold text-foreground mb-3">{item.title}</h3>
                  <p className="text-muted-foreground">{item.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 px-4">
        <div className="container mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center text-foreground mb-12">
            Преимущества платформы
          </h2>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { icon: Zap, title: "Быстрый старт", desc: "Регистрация за 1 минуту" },
              { icon: Clock, title: "Экономия времени", desc: "Автоматизация рутины" },
              { icon: MapPin, title: "По всей России", desc: "Работаем во всех регионах" },
              { icon: Shield, title: "Надежность", desc: "Проверенные исполнители" }
            ].map((feature, index) => (
              <div 
                key={index}
                className="flex items-start gap-4 p-6 rounded-2xl bg-muted/30 hover:bg-muted/50 transition-colors animate-float-up"
                style={{ animationDelay: `${index * 0.05}s` }}
              >
                <div className="w-12 h-12 bg-secondary/20 rounded-xl flex items-center justify-center flex-shrink-0">
                  <feature.icon className="w-6 h-6 text-secondary" />
                </div>
                <div>
                  <h4 className="font-semibold text-foreground mb-1">{feature.title}</h4>
                  <p className="text-sm text-muted-foreground">{feature.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4 bg-primary">
        <div className="container mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-6">
            Готовы начать?
          </h2>
          <p className="text-white/80 mb-8 max-w-xl mx-auto">
            Присоединяйтесь к платформе «ЛЮДИ И РЕСУРСЫ» и закрывайте заявки на персонал быстрее
          </p>
          <Link to="/login">
            <Button size="lg" className="bg-white text-primary hover:bg-white/90 px-8 py-6 text-lg rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105">
              Начать сейчас
            </Button>
          </Link>
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
