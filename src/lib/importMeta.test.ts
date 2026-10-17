import { describe, expect, it } from 'vitest';
import { IMPORT_ENTITIES, cellToValue, decodeCsvBytes, matchColumn, parseCsv } from '@/lib/importMeta';

const candidates = IMPORT_ENTITIES.find((e) => e.id === 'candidates')!;
const tariffs = IMPORT_ENTITIES.find((e) => e.id === 'tariffs')!;

describe('разбор CSV из Excel', () => {
  it('определяет разделитель «;», «,» и табуляцию', () => {
    expect(parseCsv('a;b;c\n1;2;3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('понимает кавычки, переводы строк внутри ячейки и экранированные кавычки', () => {
    expect(parseCsv('имя;заметка\n"Иванов; Иван";"он сказал ""да""\nи ушёл"')).toEqual([['имя', 'заметка'], ['Иванов; Иван', 'он сказал "да"\nи ушёл']]);
  });
  it('пропускает пустые строки и BOM', () => {
    expect(parseCsv('﻿a;b\n\n1;2\n;\n')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('читает файл в Windows-1251, если это не UTF-8', () => {
    const bytes = new Uint8Array([0xd4, 0xc8, 0xce]); // «ФИО» в cp1251
    expect(decodeCsvBytes(bytes.buffer)).toBe('ФИО');
    expect(decodeCsvBytes(new TextEncoder().encode('ФИО').buffer as ArrayBuffer)).toBe('ФИО');
  });
});

describe('столбцы и значения шаблонов', () => {
  it('узнаёт столбцы по названию, синониму и коду', () => {
    expect(matchColumn('ФИО', candidates)?.key).toBe('full_name');
    expect(matchColumn(' Фамилия Имя Отчество ', candidates)?.key).toBe('full_name');
    expect(matchColumn('Тел.', candidates)?.key).toBe('phone');
    expect(matchColumn('tax_status', candidates)?.key).toBe('tax_status');
    expect(matchColumn('Что-то своё', candidates)).toBeUndefined();
  });
  it('переводит русские значения в коды и даты Excel в ISO', () => {
    const tax = candidates.columns.find((c) => c.key === 'tax_status')!;
    expect(cellToValue('Самозанятый', tax)).toBe('self_employed');
    expect(cellToValue('ГПХ', tax)).toBe('gph');
    const date = candidates.columns.find((c) => c.key === 'birth_date')!;
    expect(cellToValue(new Date(Date.UTC(1990, 2, 15)), date)).toBe('1990-03-15');
    expect(cellToValue(null, date)).toBe('');
    const unit = tariffs.columns.find((c) => c.key === 'unit')!;
    expect(cellToValue('смена', unit)).toBe('shift');
  });
  it('телефон-число из Excel не превращается в экспоненту', () => {
    const phone = candidates.columns.find((c) => c.key === 'phone')!;
    expect(cellToValue(79001234567, phone)).toBe('79001234567');
  });
});
