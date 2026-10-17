import React from 'react';
import { Building } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useOrg } from '@/contexts/OrgContext';
import { cn } from '@/lib/utils';

// Переключатель организации в шапке (ТЗ, А-2). Если организация одна, выбирать нечего,
// и показывается только её название.
export const OrgSwitcher: React.FC<{ collapsed?: boolean }> = ({ collapsed }) => {
  const { orgs, orgId, org, setOrgId } = useOrg();
  if (!org || collapsed) return null;

  return (
    <div className={cn('px-4 pb-2')}>
      {orgs.length > 1 ? (
        <Select value={orgId ?? undefined} onValueChange={setOrgId}>
          <SelectTrigger className="bg-sidebar-accent/40 border-sidebar-border text-sidebar-foreground" aria-label="Организация">
            <SelectValue placeholder="Организация" />
          </SelectTrigger>
          <SelectContent>
            {orgs.map((o) => (
              <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <div className="flex items-center gap-2 text-sm text-sidebar-foreground/80">
          <Building className="w-4 h-4 flex-shrink-0" />
          <span className="truncate">{org.name}</span>
        </div>
      )}
    </div>
  );
};
