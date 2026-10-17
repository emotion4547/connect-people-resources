import React from 'react';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { fmtDate, fmtMoney } from '@/lib/format';
import { UNIT_LABELS, type ClientDocument, type DocumentLine } from '@/lib/documentsMeta';

// Строки документа и итоги: общий вид для бухгалтера, заказчика и печатной формы.
export const DocumentView: React.FC<{ doc: ClientDocument; lines: DocumentLine[] }> = ({ doc, lines }) => (
  <div className="space-y-3">
    <p className="text-sm text-muted-foreground">
      Период {fmtDate(doc.period_from)} — {fmtDate(doc.period_to)}
      {doc.due_date && <> · оплатить до {fmtDate(doc.due_date)}</>}
    </p>
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Объект и позиция</TableHead><TableHead className="text-right">Кол-во</TableHead><TableHead>Ед.</TableHead>
          <TableHead className="text-right">Цена</TableHead><TableHead className="text-right">Сумма</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((l) => (
          <TableRow key={l.id}>
            <TableCell>
              {[l.site_name, l.position_name].filter(Boolean).join(' · ')}
              {l.note && <div className="text-xs text-muted-foreground">{l.note}</div>}
            </TableCell>
            <TableCell className="text-right">{l.quantity}</TableCell>
            <TableCell>{UNIT_LABELS[l.unit ?? ''] ?? l.unit}</TableCell>
            <TableCell className="text-right">{fmtMoney(l.rate)}</TableCell>
            <TableCell className="text-right">{fmtMoney(l.amount)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow><TableCell colSpan={4} className="text-right">Итого без НДС</TableCell><TableCell className="text-right">{fmtMoney(doc.amount_net)}</TableCell></TableRow>
        <TableRow>
          <TableCell colSpan={4} className="text-right">{Number(doc.vat_rate) > 0 ? `НДС ${doc.vat_rate}%` : 'Без НДС'}</TableCell>
          <TableCell className="text-right">{fmtMoney(doc.vat_amount)}</TableCell>
        </TableRow>
        <TableRow><TableCell colSpan={4} className="text-right font-semibold">Всего к оплате</TableCell><TableCell className="text-right font-semibold">{fmtMoney(doc.amount_total)}</TableCell></TableRow>
      </TableFooter>
    </Table>
  </div>
);
