import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

// Считывание QR объекта камерой телефона. Если браузер не умеет (нет BarcodeDetector), код можно ввести вручную.
export const QrScanDialog: React.FC<{ open: boolean; onClose: () => void; onCode: (code: string) => void }> = ({ open, onClose, onCode }) => {
  const video = useRef<HTMLVideoElement>(null);
  const [manual, setManual] = useState('');
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Detector = (window as any).BarcodeDetector;
    if (!Detector || !navigator.mediaDevices?.getUserMedia) { setSupported(false); return; }
    setSupported(true);
    let stop = false;
    let stream: MediaStream | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (video.current) { video.current.srcObject = stream; await video.current.play(); }
        const detector = new Detector({ formats: ['qr_code'] });
        const tick = async () => {
          if (stop || !video.current) return;
          try {
            const found = await detector.detect(video.current);
            if (found.length) { onCode(found[0].rawValue); return; }
          } catch { /* кадр ещё не готов */ }
          setTimeout(tick, 300);
        };
        tick();
      } catch { setSupported(false); }
    })();
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [open, onCode]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Код объекта</DialogTitle>
          <DialogDescription>Наведите камеру на QR-код на объекте или планшете. Код меняется каждую минуту.</DialogDescription>
        </DialogHeader>
        {supported ? <video ref={video} className="w-full rounded-md bg-black aspect-square object-cover" playsInline muted /> : (
          <p className="text-sm text-muted-foreground">Камера недоступна. Введите код вручную.</p>
        )}
        <Input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Код вида RV1…" aria-label="Код объекта" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button disabled={!manual.trim()} onClick={() => onCode(manual.trim())}>Отправить код</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
