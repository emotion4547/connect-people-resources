import React from 'react';
import { FileText, Image as ImageIcon, File, Download } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Attachment {
  name: string;
  url: string;
  type: string;
  size: number;
}

interface MessageAttachmentsProps {
  attachments: Attachment[];
  isOwnMessage: boolean;
}

const MessageAttachments: React.FC<MessageAttachmentsProps> = ({ attachments, isOwnMessage }) => {
  if (!attachments || attachments.length === 0) return null;

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
    <div className="mt-2 space-y-2">
      {attachments.map((att, index) => (
        <div key={index}>
          {att.type.startsWith('image/') ? (
            <a href={att.url} target="_blank" rel="noopener noreferrer">
              <img
                src={att.url}
                alt={att.name}
                className="max-w-[200px] max-h-[200px] rounded-lg object-cover cursor-pointer hover:opacity-90 transition-opacity"
              />
            </a>
          ) : (
            <a
              href={att.url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "flex items-center gap-2 p-2 rounded-lg transition-colors",
                isOwnMessage 
                  ? "bg-primary-foreground/10 hover:bg-primary-foreground/20" 
                  : "bg-background/50 hover:bg-background/80"
              )}
            >
              {getFileIcon(att.type)}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{att.name}</p>
                <p className={cn(
                  "text-xs",
                  isOwnMessage ? "text-primary-foreground/70" : "text-muted-foreground"
                )}>
                  {formatFileSize(att.size)}
                </p>
              </div>
              <Download className="w-4 h-4 flex-shrink-0" />
            </a>
          )}
        </div>
      ))}
    </div>
  );
};

export default MessageAttachments;
