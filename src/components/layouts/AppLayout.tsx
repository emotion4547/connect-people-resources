import React from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';

// Общие экраны сотрудников (заказчики, заказы, табель…): для администратора системы в его оболочке,
// для остальных ролей сотрудников — в рабочем месте с разделами по их правам.
export const AppLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { role } = useAuth();
  return <DashboardLayout role={role === 'admin' ? 'admin' : 'staff'}>{children}</DashboardLayout>;
};
