import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { db } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { DOC_KINDS, type ClientDocument, type DocumentLine } from '@/lib/documentsMeta';
import { DocumentView } from '@/components/documents/DocumentView';
import PageMeta from '@/components/PageMeta';

interface Party { name: string | null; legal_name?: string | null; inn: string | null; kpp: string | null; address?: string | null; legal_address?: string | null;
  bank_name: string | null; bank_account: string | null; bik: string | null; signer_name?: string | null; signer_position?: string | null }

// Печатная форма: открывается из системы и сохраняется в PDF средствами браузера («Печать → Сохранить как PDF»).
const DocumentPrint: React.FC = () => {
  const { id } = useParams();
  const [doc, setDoc] = useState<ClientDocument | null>(null);
  const [lines, setLines] = useState<DocumentLine[]>([]);
  const [seller, setSeller] = useState<Party | null>(null);
  const [buyer, setBuyer] = useState<Party | null>(null);

  useEffect(() => {
    (async () => {
      const d = await db('client_documents').select('*').eq('id', id).maybeSingle();
      if (!d.data) return;
      setDoc(d.data);
      const [l, o, c] = await Promise.all([
        db('client_document_lines').select('*').eq('document_id', id).order('sort_order'),
        db('organizations').select('name,inn,kpp,address,bank_name,bank_account,bik,signer_name,signer_position').eq('id', d.data.org_id).maybeSingle(),
        db('clients').select('name,legal_name,inn,kpp,legal_address,bank_name,bank_account,bik').eq('id', d.data.client_id).maybeSingle(),
      ]);
      setLines(l.data ?? []); setSeller(o.data); setBuyer(c.data);
    })();
  }, [id]);

  if (!doc) return <p className="p-6">Загрузка…</p>;
  const party = (p: Party | null) => p && (
    <div className="text-sm">
      <div className="font-medium">{p.legal_name ?? p.name}</div>
      <div>ИНН {p.inn ?? '—'}{p.kpp ? `, КПП ${p.kpp}` : ''}</div>
      <div>{p.address ?? p.legal_address}</div>
      {p.bank_account && <div>р/с {p.bank_account}, {p.bank_name}, БИК {p.bik}</div>}
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-black print:p-0">
      <PageMeta title={`${DOC_KINDS[doc.kind]} № ${doc.number ?? ''}`} description="Печатная форма" />
      <button className="mb-4 rounded border px-3 py-1 text-sm print:hidden" onClick={() => window.print()}>Печать / сохранить в PDF</button>
      <h1 className="mb-1 text-xl font-bold">{DOC_KINDS[doc.kind]} № {doc.number}</h1>
      <p className="mb-4 text-sm">от {fmtDate(doc.issue_date)}</p>
      <div className="mb-4 grid grid-cols-2 gap-6">
        <div><div className="mb-1 text-xs uppercase text-gray-500">Исполнитель</div>{party(seller)}</div>
        <div><div className="mb-1 text-xs uppercase text-gray-500">Заказчик</div>{party(buyer)}</div>
      </div>
      <DocumentView doc={doc} lines={lines} />
      <div className="mt-12 grid grid-cols-2 gap-6 text-sm">
        <div>Исполнитель<br />{seller?.signer_position} ______________ {seller?.signer_name}<br /><span className="text-gray-500">М.П.</span></div>
        <div>Заказчик<br />______________<br /><span className="text-gray-500">М.П.</span></div>
      </div>
    </div>
  );
};

export default DocumentPrint;
