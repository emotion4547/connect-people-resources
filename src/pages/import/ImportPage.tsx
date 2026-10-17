import React, { useMemo, useRef, useState } from 'react';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useOrg } from '@/contexts/OrgContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useToast } from '@/hooks/use-toast';
import { rpc } from '@/lib/db';
import { downloadCsv } from '@/lib/csv';
import { IMPORT_ENTITIES, cellToValue, decodeCsvBytes, matchColumn, parseCsv, templateCsvRows, type ImportEntity } from '@/lib/importMeta';
import PageMeta from '@/components/PageMeta';
import { Download, FileSpreadsheet, Upload } from 'lucide-react';

interface Outcome { row_no: number; result: string; message: string; entity_id: string | null }
interface Parsed { fileName: string; rows: Record<string, string>[]; recognized: string[]; ignored: string[]; missing: string[] }

const MAX_ROWS = 2000;
const RESULT_LABEL: Record<string, string> = { created: 'создано', updated: 'обновлено', skipped: 'пропущено', error: 'ошибка' };

// ИЭ-1, ИЭ-2: импорт из Excel (.xlsx) или CSV: проверка файла, предпросмотр с причинами по строкам, загрузка.
const ImportPage: React.FC = () => {
  const { orgId } = useOrg();
  const { can } = usePermissions();
  const { toast } = useToast();
  const available = IMPORT_ENTITIES.filter((e) => can(e.module, 'create'));
  const [entityId, setEntityId] = useState<string>('');
  const entity: ImportEntity | undefined = available.find((e) => e.id === (entityId || available[0]?.id));
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null);
  const [applied, setApplied] = useState(false);
  const [onDuplicate, setOnDuplicate] = useState<'skip' | 'update'>('skip');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const reset = () => { setParsed(null); setOutcomes(null); setApplied(false); if (input.current) input.current.value = ''; };

  const readFile = async (file: File) => {
    if (!entity) return;
    reset();
    let table: unknown[][];
    try {
      if (/\.xlsx$/i.test(file.name)) {
        const { readSheet } = await import('read-excel-file/browser');
        table = (await readSheet(file)) as unknown[][];
      } else if (/\.(csv|txt)$/i.test(file.name)) {
        table = parseCsv(decodeCsvBytes(await file.arrayBuffer()));
      } else {
        toast({ title: 'Нужен файл .xlsx или .csv', variant: 'destructive' }); return;
      }
    } catch (e) {
      toast({ title: 'Не удалось прочитать файл', description: e instanceof Error ? e.message : undefined, variant: 'destructive' }); return;
    }
    const [head, ...body] = table.filter((r) => r.some((c) => c !== null && c !== undefined && String(c).trim() !== ''));
    if (!head) { toast({ title: 'В файле нет данных', variant: 'destructive' }); return; }
    const cols = head.map((h) => matchColumn(String(h ?? ''), entity));
    const recognized = cols.filter(Boolean).map((c) => c!.header);
    const ignored = head.filter((_, i) => !cols[i]).map((h) => String(h ?? '')).filter(Boolean);
    const missing = entity.columns.filter((c) => c.required && !cols.some((x) => x?.key === c.key)).map((c) => c.header);
    if (body.length > MAX_ROWS) { toast({ title: `В файле ${body.length} строк`, description: `За один раз можно загрузить не больше ${MAX_ROWS}: разделите файл`, variant: 'destructive' }); return; }
    const rows = body.map((r) => { const o: Record<string, string> = {}; cols.forEach((c, i) => { if (c) o[c.key] = cellToValue(r[i], c); }); return o; });
    setParsed({ fileName: file.name, rows, recognized, ignored, missing });
    if (!missing.length && rows.length) await run(rows, false);
  };

  const run = async (rows: Record<string, string>[], apply: boolean) => {
    if (!orgId || !entity) return;
    setBusy(true);
    const { data, error } = await rpc('import_rows', { _org_id: orgId, _entity: entity.id, _rows: rows, _apply: apply, _on_duplicate: onDuplicate });
    setBusy(false);
    if (error) { toast({ title: apply ? 'Не удалось загрузить' : 'Не удалось проверить файл', description: error.message, variant: 'destructive' }); return; }
    setOutcomes(data as Outcome[]); setApplied(apply);
    if (apply) toast({ title: 'Загрузка завершена' });
  };

  const count = (r: string) => outcomes?.filter((o) => o.result === r).length ?? 0;
  const problems = useMemo(() => (outcomes ?? []).filter((o) => o.result === 'error' || o.result === 'skipped'), [outcomes]);

  if (!available.length) return <AppLayout><p className="p-6">Для вашей роли импорт не предусмотрен.</p></AppLayout>;

  return (
    <AppLayout>
      <PageMeta title="Импорт из Excel" description="Загрузка исполнителей, заказчиков, объектов и тарифов" />
      <div className="max-w-5xl mx-auto space-y-6 animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold mb-2">Импорт из Excel</h1>
          <p className="text-muted-foreground">Скачайте шаблон, заполните его и загрузите файл .xlsx или .csv. Сначала система проверит каждую строку и покажет итог, ничего не сохраняя; ошибочные строки не мешают остальным.</p>
        </div>
        <Tabs value={entity?.id} onValueChange={(v) => { setEntityId(v); reset(); }}>
          <TabsList className="flex-wrap h-auto">{available.map((e) => <TabsTrigger key={e.id} value={e.id}>{e.title}</TabsTrigger>)}</TabsList>
          {available.map((e) => (
            <TabsContent key={e.id} value={e.id}>
              <Card>
                <CardHeader><CardTitle className="text-lg">{e.title}</CardTitle><CardDescription>{e.description}</CardDescription></CardHeader>
                <CardContent className="space-y-4">
                  <Table>
                    <TableHeader><TableRow><TableHead>Столбец</TableHead><TableHead>Обязательный</TableHead><TableHead>Пример</TableHead><TableHead>Подсказка</TableHead></TableRow></TableHeader>
                    <TableBody>{e.columns.map((c) => <TableRow key={c.key}><TableCell className="font-medium">{c.header}</TableCell><TableCell>{c.required ? 'да' : ''}</TableCell><TableCell className="text-muted-foreground">{c.example}</TableCell><TableCell className="text-muted-foreground">{c.hint ?? ''}</TableCell></TableRow>)}</TableBody>
                  </Table>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button variant="outline" className="gap-2" onClick={() => { const t = templateCsvRows(e); downloadCsv(`shablon-${e.id}.csv`, t.header, t.rows); }}><FileSpreadsheet className="w-4 h-4" /> Скачать шаблон</Button>
                    <input ref={input} type="file" accept=".xlsx,.csv,.txt" className="hidden" id="import-file" onChange={(ev) => ev.target.files?.[0] && readFile(ev.target.files[0])} />
                    <Button className="gap-2" onClick={() => input.current?.click()} disabled={busy}><Upload className="w-4 h-4" /> Выбрать файл</Button>
                    <Select value={onDuplicate} onValueChange={(v) => { setOnDuplicate(v as 'skip' | 'update'); setOutcomes(null); }}>
                      <SelectTrigger className="w-64" aria-label="Что делать с дублями"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="skip">Дубли пропускать</SelectItem><SelectItem value="update">Дубли обновлять</SelectItem></SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>

        {parsed && (
          <Card>
            <CardHeader><CardTitle className="text-lg">Файл «{parsed.fileName}»: {parsed.rows.length} строк</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {parsed.missing.length > 0 && <Alert variant="destructive"><AlertTitle>Нет обязательных столбцов</AlertTitle><AlertDescription>{parsed.missing.join(', ')}. Загрузка невозможна: возьмите шаблон.</AlertDescription></Alert>}
              {parsed.ignored.length > 0 && <p className="text-sm text-muted-foreground">Эти столбцы не распознаны и будут пропущены: {parsed.ignored.join(', ')}.</p>}
              {outcomes && (
                <>
                  <div className="flex flex-wrap gap-2 text-sm">
                    <Badge variant="secondary">создать: {count('created')}</Badge><Badge variant="secondary">обновить: {count('updated')}</Badge>
                    <Badge variant="outline">пропустить: {count('skipped')}</Badge><Badge variant={count('error') ? 'destructive' : 'outline'}>ошибок: {count('error')}</Badge>
                  </div>
                  {applied
                    ? <Alert><AlertTitle>Загрузка завершена</AlertTitle><AlertDescription>Создано {count('created')}, обновлено {count('updated')}, пропущено {count('skipped')}, с ошибками {count('error')}. Строки с ошибками не загружены — исправьте их в файле и загрузите заново.</AlertDescription></Alert>
                    : <div className="flex flex-wrap gap-2"><Button disabled={busy || count('created') + count('updated') === 0} onClick={() => run(parsed.rows, true)}>Загрузить {count('created') + count('updated')} строк</Button><Button variant="ghost" onClick={reset}>Отмена</Button></div>}
                  {problems.length > 0 && (
                    <>
                      <div className="flex justify-end"><Button variant="outline" size="sm" className="gap-2" onClick={() => downloadCsv(`oshibki-${entity?.id}.csv`, ['Строка в файле', 'Итог', 'Причина'], problems.map((p) => [p.row_no, RESULT_LABEL[p.result], p.message]))}><Download className="w-4 h-4" /> Отчёт об ошибках (CSV)</Button></div>
                      <Table>
                        <TableHeader><TableRow><TableHead className="w-24">Строка</TableHead><TableHead className="w-32">Итог</TableHead><TableHead>Причина</TableHead></TableRow></TableHeader>
                        <TableBody>{problems.slice(0, 300).map((p) => <TableRow key={p.row_no}><TableCell>{p.row_no}</TableCell><TableCell><Badge variant={p.result === 'error' ? 'destructive' : 'outline'}>{RESULT_LABEL[p.result]}</Badge></TableCell><TableCell>{p.message}</TableCell></TableRow>)}</TableBody>
                      </Table>
                      {problems.length > 300 && <p className="text-xs text-muted-foreground">Показаны первые 300 строк, остальные — в отчёте.</p>}
                    </>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
};

export default ImportPage;
