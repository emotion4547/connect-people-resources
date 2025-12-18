import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { supabaseAuth } from '@/integrations/supabase/authClient';

type AppRole = 'hr' | 'worker' | 'admin';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  role: AppRole | null;
  profile: any | null;
  loading: boolean;
  signUp: (email: string, password: string, metadata: { role: AppRole; full_name?: string; company?: string }) => Promise<{ error: any }>;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  refetchProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [profile, setProfile] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUserData = async (userId: string) => {
    try {
      // Fetch role
      const { data: roleData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .maybeSingle();
      
      if (roleData) {
        setRole(roleData.role as AppRole);
      }

      // Fetch profile
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      
      if (profileData) {
        setProfile(profileData);
      }
    } catch (error) {
      console.error('Error fetching user data:', error);
    }
  };

  useEffect(() => {
    const { data: { subscription } } = supabaseAuth.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        
        if (session?.user) {
          setTimeout(() => {
            fetchUserData(session.user.id);
          }, 0);
        } else {
          setRole(null);
          setProfile(null);
        }
        setLoading(false);
      }
    );

    supabaseAuth.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      if (session?.user) {
        fetchUserData(session.user.id);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string, metadata: { role: AppRole; full_name?: string; company?: string }) => {
    // Minimal signup - no options at all to isolate the issue
    const { data, error } = await supabaseAuth.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
    });

    // If signup successful, save role and profile data manually
    if (!error && data.user) {
      // Insert role
      await supabase.from('user_roles').insert({
        user_id: data.user.id,
        role: metadata.role,
      });

      // Update profile with user data
      await supabase
        .from('profiles')
        .update({
          full_name: metadata.full_name,
          company: metadata.company,
        })
        .eq('user_id', data.user.id);
    }
    
    return { error };
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabaseAuth.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    return { error };
  };

  const signOut = async () => {
    await supabaseAuth.auth.signOut();
    setUser(null);
    setSession(null);
    setRole(null);
    setProfile(null);
  };

  const refetchProfile = async () => {
    if (user) {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      
      if (profileData) {
        setProfile(profileData);
      }
    }
  };

  return (
    <AuthContext.Provider value={{ user, session, role, profile, loading, signUp, signIn, signOut, refetchProfile }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
