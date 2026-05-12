import React, { useEffect, useRef, useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Camera, Loader2, User } from 'lucide-react';

interface AvatarUploadProps {
  userId: string;
  currentAvatarUrl?: string | null;
  userName?: string | null;
  onAvatarChange?: (url: string) => void;
  size?: 'sm' | 'md' | 'lg';
}

const sizeClasses = {
  sm: 'w-12 h-12',
  md: 'w-16 h-16',
  lg: 'w-24 h-24',
};

const iconSizeClasses = {
  sm: 'w-4 h-4',
  md: 'w-6 h-6',
  lg: 'w-10 h-10',
};

const buttonSizeClasses = {
  sm: 'w-5 h-5',
  md: 'w-6 h-6',
  lg: 'w-8 h-8',
};

export const AvatarUpload: React.FC<AvatarUploadProps> = ({
  userId,
  currentAvatarUrl,
  userName,
  onAvatarChange,
  size = 'md',
}) => {
  const { toast } = useToast();
  const { refetchProfile } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState(currentAvatarUrl);

  useEffect(() => {
    setAvatarUrl(currentAvatarUrl);
  }, [currentAvatarUrl]);

  const getInitials = (name?: string | null) => {
    if (!name) return <User className={iconSizeClasses[size]} />;
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file
    if (!file.type.startsWith('image/')) {
      toast({
        title: 'Ошибка',
        description: 'Выберите файл изображения',
        variant: 'destructive',
      });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: 'Ошибка',
        description: 'Размер файла не должен превышать 5 МБ',
        variant: 'destructive',
      });
      return;
    }

    setUploading(true);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${userId}/avatar.${fileExt}`;

      // Delete old avatar if exists
      await supabase.storage.from('avatars').remove([fileName]);

      // Upload new avatar
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data } = supabase.storage.from('avatars').getPublicUrl(fileName);
      const publicUrl = `${data.publicUrl}?t=${Date.now()}`;

      // Update profile
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('user_id', userId);

      if (updateError) throw updateError;

      setAvatarUrl(publicUrl);
      onAvatarChange?.(publicUrl);
      await refetchProfile();

      toast({
        title: 'Аватар обновлён',
        description: 'Фото профиля успешно загружено',
      });
    } catch (error: any) {
      console.error('Error uploading avatar:', error);
      toast({
        title: 'Ошибка загрузки',
        description: error.message || 'Не удалось загрузить аватар',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="relative inline-block">
      <Avatar className={`${sizeClasses[size]} border-2 border-border`}>
        <AvatarImage src={avatarUrl || undefined} alt={userName || 'Аватар'} />
        <AvatarFallback className="bg-primary/10 text-primary">
          {getInitials(userName)}
        </AvatarFallback>
      </Avatar>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
        disabled={uploading}
      />

      <Button
        type="button"
        variant="secondary"
        size="icon"
        className={`absolute -bottom-1 -right-1 ${buttonSizeClasses[size]} rounded-full p-0 shadow-md`}
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <Camera className="w-3 h-3" />
        )}
      </Button>
    </div>
  );
};
