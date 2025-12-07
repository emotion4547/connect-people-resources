import React, { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Paperclip, X, FileText, Image as ImageIcon, File } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

export interface Attachment {
  name: string;
  url: string;
  type: string;
  size: number;
}

interface ChatAttachmentsProps {
  attachments: Attachment[];
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>;
  userId: string;
  disabled?: boolean;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv'
];

const ChatAttachments: React.FC<ChatAttachmentsProps> = ({ 
  attachments, 
  setAttachments, 
  userId,
  disabled 
}) => {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);

    for (const file of Array.from(files)) {
      // Validate file size
      if (file.size > MAX_FILE_SIZE) {
        toast({
          title: 'Файл слишком большой',
          description: `${file.name} превышает 10MB`,
          variant: 'destructive',
        });
        continue;
      }

      // Validate file type
      if (!ALLOWED_TYPES.includes(file.type)) {
        toast({
          title: 'Неподдерживаемый формат',
          description: `${file.name} имеет неподдерживаемый формат`,
          variant: 'destructive',
        });
        continue;
      }

      try {
        const fileName = `${userId}/${Date.now()}-${file.name}`;
        const { data, error } = await supabase.storage
          .from('chat-attachments')
          .upload(fileName, file);

        if (error) throw error;

        const { data: urlData } = supabase.storage
          .from('chat-attachments')
          .getPublicUrl(data.path);

        const attachment: Attachment = {
          name: file.name,
          url: urlData.publicUrl,
          type: file.type,
          size: file.size,
        };

        setAttachments(prev => [...prev, attachment]);
      } catch (error) {
        console.error('Error uploading file:', error);
        toast({
          title: 'Ошибка загрузки',
          description: `Не удалось загрузить ${file.name}`,
          variant: 'destructive',
        });
      }
    }

    setUploading(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const getFileIcon = (type: string) => {
    if (type.startsWith('image/')) return <ImageIcon className="w-4 h-4" />;
    if (type === 'application/pdf') return <FileText className="w-4 h-4" />;
    return <File className="w-4 h-4" />;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <div className="flex items-center gap-2">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ALLOWED_TYPES.join(',')}
        onChange={handleFileSelect}
        className="hidden"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => fileInputRef.current?.click()}
        disabled={disabled || uploading}
        className="flex-shrink-0"
      >
        <Paperclip className={cn("w-5 h-5", uploading && "animate-pulse")} />
      </Button>

      {attachments.length > 0 && (
        <div className="flex gap-2 overflow-x-auto py-1">
          {attachments.map((att, index) => (
            <div
              key={index}
              className="flex items-center gap-2 bg-muted rounded-lg px-3 py-1.5 text-sm flex-shrink-0"
            >
              {getFileIcon(att.type)}
              <span className="max-w-[100px] truncate">{att.name}</span>
              <span className="text-xs text-muted-foreground">
                {formatFileSize(att.size)}
              </span>
              <button
                type="button"
                onClick={() => removeAttachment(index)}
                className="p-0.5 hover:bg-destructive/20 rounded"
              >
                <X className="w-3 h-3 text-destructive" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ChatAttachments;
