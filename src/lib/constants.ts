// Shared constants used across HR/Worker/Admin screens.

export const POSITIONS = [
  'Сортировщик',
  'Упаковщик',
  'Грузчик',
  'Комплектовщик',
  'Кладовщик',
  'Водитель погрузчика',
  'Разнорабочий',
] as const;

export type Position = (typeof POSITIONS)[number];

export const CUSTOM_POSITION = '__custom__';
