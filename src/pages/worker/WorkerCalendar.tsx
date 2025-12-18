import React, { useEffect, useState, useMemo } from 'react';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { ChevronLeft, ChevronRight, Calendar, MapPin, Clock, Banknote } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, isToday, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import PageMeta from '@/components/PageMeta';
import { cn } from '@/lib/utils';

interface Shift {
  id: string;
  status: string;
  request_id: string;
  position: string;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  address: string;
  pay: string | null;
}

const WorkerCalendar: React.FC = () => {
  const { user } = useAuth();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  useEffect(() => {
    if (user) {
      fetchShifts();
    }
  }, [user]);

  const fetchShifts = async () => {
    if (!user) return;

    try {
      // Get assigned responses
      const { data: responsesData, error: responsesError } = await supabase
        .from('responses')
        .select('id, status, request_id')
        .eq('worker_id', user.id)
        .in('status', ['assigned', 'completed']);

      if (responsesError) throw responsesError;

      if (!responsesData?.length) {
        setShifts([]);
        setLoading(false);
        return;
      }

      // Get request details
      const requestIds = responsesData.map(r => r.request_id);
      const { data: requestsData, error: requestsError } = await supabase
        .from('requests')
        .select('id, position, start_date, end_date, start_time, end_time, address, pay')
        .in('id', requestIds);

      if (requestsError) throw requestsError;

      // Combine data
      const requestsMap = new Map(requestsData?.map(r => [r.id, r]) || []);
      const combinedData: Shift[] = responsesData.map(response => {
        const request = requestsMap.get(response.request_id);
        return {
          id: response.id,
          status: response.status,
          request_id: response.request_id,
          position: request?.position || 'Неизвестно',
          start_date: request?.start_date || new Date().toISOString(),
          end_date: request?.end_date || request?.start_date || new Date().toISOString(),
          start_time: request?.start_time || null,
          end_time: request?.end_time || null,
          address: request?.address || '-',
          pay: request?.pay || null,
        };
      });

      setShifts(combinedData);
    } catch (error) {
      console.error('Error fetching shifts:', error);
    } finally {
      setLoading(false);
    }
  };

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const monthDays = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // Get day of week for first day (0 = Sunday, 1 = Monday, etc.)
  const startDayOfWeek = monthStart.getDay();
  // Adjust for Monday start (Russian calendar)
  const adjustedStartDay = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1;

  // Get shifts for a specific date
  const getShiftsForDate = (date: Date) => {
    return shifts.filter(shift => {
      const shiftStart = parseISO(shift.start_date);
      const shiftEnd = parseISO(shift.end_date);
      return date >= shiftStart && date <= shiftEnd;
    });
  };

  const selectedDateShifts = useMemo(() => {
    if (!selectedDate) return [];
    return getShiftsForDate(selectedDate);
  }, [selectedDate, shifts]);

  const getStatusBadge = (status: string) => {
    if (status === 'completed') {
      return <Badge className="bg-status-gold/20 text-secondary">Выполнено</Badge>;
    }
    return <Badge className="bg-status-success/20 text-status-success">Назначен</Badge>;
  };

  const weekDays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

  return (
    <DashboardLayout role="worker">
      <PageMeta title="Календарь смен" description="Ваш календарь назначенных смен" />
      <div className="space-y-6 animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold mb-2">Календарь смен</h1>
          <p className="text-muted-foreground">
            Ваши назначенные и выполненные смены
          </p>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Calendar */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <CardTitle className="text-xl capitalize">
                  {format(currentMonth, 'LLLL yyyy', { locale: ru })}
                </CardTitle>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="h-64 flex items-center justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
              ) : (
                <>
                  {/* Week days header */}
                  <div className="grid grid-cols-7 gap-1 mb-2">
                    {weekDays.map(day => (
                      <div key={day} className="text-center text-sm font-medium text-muted-foreground py-2">
                        {day}
                      </div>
                    ))}
                  </div>

                  {/* Calendar grid */}
                  <div className="grid grid-cols-7 gap-1">
                    {/* Empty cells for days before month start */}
                    {Array.from({ length: adjustedStartDay }).map((_, i) => (
                      <div key={`empty-${i}`} className="aspect-square" />
                    ))}

                    {/* Month days */}
                    {monthDays.map(day => {
                      const dayShifts = getShiftsForDate(day);
                      const hasShifts = dayShifts.length > 0;
                      const isSelected = selectedDate && isSameDay(day, selectedDate);
                      const hasCompleted = dayShifts.some(s => s.status === 'completed');
                      const hasAssigned = dayShifts.some(s => s.status === 'assigned');

                      return (
                        <button
                          key={day.toISOString()}
                          onClick={() => setSelectedDate(day)}
                          className={cn(
                            "aspect-square p-1 rounded-lg transition-all relative",
                            "hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary",
                            isToday(day) && "ring-2 ring-primary",
                            isSelected && "bg-primary text-primary-foreground hover:bg-primary",
                            !isSameMonth(day, currentMonth) && "text-muted-foreground/50"
                          )}
                        >
                          <span className="text-sm font-medium">{format(day, 'd')}</span>
                          {hasShifts && (
                            <div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex gap-0.5">
                              {hasAssigned && (
                                <div className="w-1.5 h-1.5 rounded-full bg-status-success" />
                              )}
                              {hasCompleted && (
                                <div className="w-1.5 h-1.5 rounded-full bg-secondary" />
                              )}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Legend */}
                  <div className="flex items-center gap-4 mt-4 pt-4 border-t text-sm text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-status-success" />
                      <span>Назначено</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-secondary" />
                      <span>Выполнено</span>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Selected date details */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Calendar className="w-5 h-5" />
                {selectedDate
                  ? format(selectedDate, 'd MMMM yyyy', { locale: ru })
                  : 'Выберите дату'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!selectedDate ? (
                <p className="text-muted-foreground text-sm">
                  Нажмите на дату в календаре, чтобы увидеть детали смен
                </p>
              ) : selectedDateShifts.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  На эту дату смен нет
                </p>
              ) : (
                <div className="space-y-4">
                  {selectedDateShifts.map(shift => (
                    <div
                      key={shift.id}
                      className="p-4 rounded-lg bg-muted/50 space-y-3"
                    >
                      <div className="flex items-start justify-between">
                        <h4 className="font-semibold">{shift.position}</h4>
                        {getStatusBadge(shift.status)}
                      </div>
                      
                      <div className="space-y-2 text-sm">
                        {shift.start_time && (
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Clock className="w-4 h-4" />
                            <span>
                              {shift.start_time.slice(0, 5)}
                              {shift.end_time && ` - ${shift.end_time.slice(0, 5)}`}
                            </span>
                          </div>
                        )}
                        
                        <div className="flex items-start gap-2 text-muted-foreground">
                          <MapPin className="w-4 h-4 flex-shrink-0 mt-0.5" />
                          <span>{shift.address}</span>
                        </div>
                        
                        {shift.pay && (
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Banknote className="w-4 h-4" />
                            <span>{shift.pay}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Stats */}
        <div className="grid sm:grid-cols-3 gap-4">
          <Card className="bg-status-success/10 border-status-success/20">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-status-success/20">
                  <Calendar className="w-5 h-5 text-status-success" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{shifts.filter(s => s.status === 'assigned').length}</p>
                  <p className="text-sm text-muted-foreground">Назначенных смен</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-secondary/10 border-secondary/20">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-secondary/20">
                  <Calendar className="w-5 h-5 text-secondary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{shifts.filter(s => s.status === 'completed').length}</p>
                  <p className="text-sm text-muted-foreground">Выполненных смен</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-primary/10 border-primary/20">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/20">
                  <Calendar className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{shifts.length}</p>
                  <p className="text-sm text-muted-foreground">Всего смен</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default WorkerCalendar;
