import { useState } from "react";
import { Link } from "react-router-dom";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import PageMeta from "@/components/PageMeta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ArrowLeft, Send, Mail, Phone, MapPin, CheckCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import logo from "@/assets/logo.png";

const contactSchema = z.object({
  name: z.string().trim().min(2, "Имя должно содержать минимум 2 символа").max(100, "Имя слишком длинное"),
  email: z.string().trim().email("Введите корректный email").max(255, "Email слишком длинный"),
  phone: z.string().trim().max(20, "Номер телефона слишком длинный").optional().or(z.literal("")),
  subject: z.string().min(1, "Выберите тему обращения"),
  message: z.string().trim().min(10, "Сообщение должно содержать минимум 10 символов").max(2000, "Сообщение слишком длинное"),
});

type ContactFormValues = z.infer<typeof contactSchema>;

const subjects = [
  { value: "general", label: "Общий вопрос" },
  { value: "hr_support", label: "Поддержка для HR" },
  { value: "worker_support", label: "Поддержка для исполнителей" },
  { value: "partnership", label: "Сотрудничество" },
  { value: "bug_report", label: "Сообщить об ошибке" },
  { value: "other", label: "Другое" },
];

const Contact = () => {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const form = useForm<ContactFormValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      subject: "",
      message: "",
    },
  });

  const onSubmit = async (data: ContactFormValues) => {
    setIsSubmitting(true);
    try {
      const { error } = await supabase.from("contact_messages").insert({
        name: data.name,
        email: data.email,
        phone: data.phone || null,
        subject: subjects.find(s => s.value === data.subject)?.label || data.subject,
        message: data.message,
      });

      if (error) throw error;

      setIsSubmitted(true);
      toast({
        title: "Сообщение отправлено",
        description: "Мы свяжемся с вами в ближайшее время.",
      });
    } catch (error) {
      console.error("Error submitting contact form:", error);
      toast({
        title: "Ошибка",
        description: "Не удалось отправить сообщение. Попробуйте позже.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-secondary/5">
      <PageMeta 
        title="Контакты" 
        description="Свяжитесь с командой сервиса Работа для Всех. Форма обратной связи для вопросов, предложений и поддержки."
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
      <main className="container mx-auto px-4 py-12">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
              Свяжитесь с нами
            </h1>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Есть вопросы или предложения? Заполните форму ниже, и мы ответим вам в ближайшее время.
            </p>
          </div>

          <div className="grid lg:grid-cols-3 gap-8">
            {/* Contact Info */}
            <div className="space-y-6">
              <Card className="bg-card border-border">
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Mail className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground mb-1">Email</h3>
                      <p className="text-sm text-muted-foreground">support@rabotadlyavsekh.ru</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-card border-border">
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 bg-secondary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Phone className="w-5 h-5 text-secondary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground mb-1">Телефон</h3>
                      <p className="text-sm text-muted-foreground">+7 (800) 000-00-00</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-card border-border">
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                      <MapPin className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground mb-1">Адрес</h3>
                      <p className="text-sm text-muted-foreground">Россия, Москва</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Contact Form */}
            <div className="lg:col-span-2">
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle>Форма обратной связи</CardTitle>
                  <CardDescription>
                    Заполните форму, и мы свяжемся с вами
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {isSubmitted ? (
                    <div className="text-center py-12">
                      <div className="w-16 h-16 bg-status-success/10 rounded-full flex items-center justify-center mx-auto mb-4">
                        <CheckCircle className="w-8 h-8 text-status-success" />
                      </div>
                      <h3 className="text-xl font-semibold text-foreground mb-2">
                        Сообщение отправлено!
                      </h3>
                      <p className="text-muted-foreground mb-6">
                        Мы получили ваше обращение и ответим в ближайшее время.
                      </p>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setIsSubmitted(false);
                          form.reset();
                        }}
                      >
                        Отправить ещё одно сообщение
                      </Button>
                    </div>
                  ) : (
                    <Form {...form}>
                      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                        <div className="grid sm:grid-cols-2 gap-4">
                          <FormField
                            control={form.control}
                            name="name"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Имя *</FormLabel>
                                <FormControl>
                                  <Input placeholder="Ваше имя" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="email"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Email *</FormLabel>
                                <FormControl>
                                  <Input type="email" placeholder="email@example.com" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>

                        <div className="grid sm:grid-cols-2 gap-4">
                          <FormField
                            control={form.control}
                            name="phone"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Телефон</FormLabel>
                                <FormControl>
                                  <Input placeholder="+7 (___) ___-__-__" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="subject"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Тема обращения *</FormLabel>
                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder="Выберите тему" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    {subjects.map((subject) => (
                                      <SelectItem key={subject.value} value={subject.value}>
                                        {subject.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>

                        <FormField
                          control={form.control}
                          name="message"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Сообщение *</FormLabel>
                              <FormControl>
                                <Textarea 
                                  placeholder="Опишите ваш вопрос или предложение..."
                                  className="min-h-[150px] resize-none"
                                  {...field} 
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <Button 
                          type="submit" 
                          disabled={isSubmitting}
                          className="w-full sm:w-auto bg-primary hover:bg-primary/90"
                        >
                          {isSubmitting ? (
                            "Отправка..."
                          ) : (
                            <>
                              <Send className="w-4 h-4 mr-2" />
                              Отправить сообщение
                            </>
                          )}
                        </Button>
                      </form>
                    </Form>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-8 px-4 border-t border-border mt-12">
        <div className="container mx-auto text-center">
          <p className="text-sm text-muted-foreground">
            © 2025 РАБОТА ДЛЯ ВСЕХ. Все права защищены.
          </p>
        </div>
      </footer>
    </div>
  );
};

export default Contact;
