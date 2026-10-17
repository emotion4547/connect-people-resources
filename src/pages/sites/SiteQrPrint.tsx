import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '@/components/ui/button';
import { db, rpc } from '@/lib/db';
import PageMeta from '@/components/PageMeta';

// Печатная форма A4 с постоянным кодом объекта (ТЗ, О-2).
const SiteQrPrint: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [payload, setPayload] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    (async () => {
      const [s, p] = await Promise.all([
        db('sites').select('name,address').eq('id', id).maybeSingle(),
        rpc('site_qr_payload', { _site_id: id, _rotating: false }),
      ]);
      if (s.error || p.error || !s.data) { setError('Нет доступа к коду этого объекта'); return; }
      setName(s.data.name);
      setAddress(s.data.address ?? '');
      setPayload(p.data);
    })();
  }, [id]);

  return (
    <div className="min-h-screen bg-white text-black flex flex-col items-center justify-center gap-8 p-10 print:p-0">
      <PageMeta title={`QR: ${name}`} description="Печатная форма QR объекта" />
      {error ? <p>{error}</p> : (
        <>
          <h1 className="text-4xl font-bold text-center">{name}</h1>
          {address && <p className="text-xl text-center">{address}</p>}
          {payload && <QRCodeSVG title="QR-код объекта для отметки прихода" value={payload} size={420} marginSize={2} />}
          <p className="text-2xl text-center max-w-xl">Отметьтесь в приложении «Работа для Всех», когда придёте на смену и когда закончите её.</p>
          <Button className="print:hidden" onClick={() => window.print()}>Печать</Button>
        </>
      )}
    </div>
  );
};

export default SiteQrPrint;
