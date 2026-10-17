import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { db, rpc } from '@/lib/db';
import PageMeta from '@/components/PageMeta';

// Режим «планшет на объекте» (ТЗ, О-2): код меняется каждую минуту, поэтому фото кода не поможет
// отметиться из дома. Новый код запрашивается у сервера на границе минуты.
const SiteTablet: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [name, setName] = useState('');
  const [payload, setPayload] = useState('');
  const [left, setLeft] = useState(60);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!id) return;
    const { data, error: err } = await rpc('site_qr_payload', { _site_id: id, _rotating: true });
    if (err) setError('Нет доступа к коду этого объекта'); else { setError(''); setPayload(data); }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    db('sites').select('name').eq('id', id).maybeSingle().then(({ data }: { data: { name: string } | null }) => setName(data?.name ?? ''));
    refresh();
  }, [id, refresh]);

  useEffect(() => {
    const tick = setInterval(() => {
      const secondsLeft = 60 - (Math.floor(Date.now() / 1000) % 60);
      setLeft(secondsLeft);
      if (secondsLeft === 60) refresh();
    }, 1000);
    return () => clearInterval(tick);
  }, [refresh]);

  return (
    <div className="min-h-screen bg-white text-black flex flex-col items-center justify-center gap-6 p-6">
      <PageMeta title={`Планшет: ${name}`} description="Меняющийся QR объекта" />
      {error ? <p>{error}</p> : (
        <>
          <h1 className="text-4xl font-bold text-center">{name}</h1>
          {payload && <QRCodeSVG value={payload} size={Math.min(window.innerHeight - 260, 520)} marginSize={2} />}
          <p className="text-2xl">Код обновится через {left} с</p>
          <p className="text-lg text-neutral-600">Отметьтесь в приложении, наведя камеру на код</p>
        </>
      )}
    </div>
  );
};

export default SiteTablet;
