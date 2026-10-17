import type { AppRole } from '@/contexts/AuthContext';

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: 'Администратор системы',
  director: 'Руководитель',
  sales: 'Менеджер по продажам',
  site_manager: 'Менеджер объекта',
  recruiter: 'Рекрутер',
  accountant: 'Бухгалтер',
  client_admin: 'Администратор заказчика',
  client_manager: 'Менеджер заказчика',
  hr: 'HR (заказчик)',
  worker: 'Исполнитель',
};

// Роли сотрудников аутсорсера: их заводит администратор организации.
export const STAFF_ROLES: AppRole[] = ['director', 'sales', 'site_manager', 'recruiter', 'accountant', 'admin'];

export const DEPARTMENTS: Record<string, string> = {
  management: 'Руководство',
  sales: 'Продажи',
  sites: 'Ведение объектов',
  hiring: 'Найм',
  accounting: 'Бухгалтерия',
  admin: 'Администрирование',
};
