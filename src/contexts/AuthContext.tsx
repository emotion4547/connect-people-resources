import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

type AppRole = 'hr' | 'worker' | 'admin';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  role: AppRole | null;
  profile: any | null;
  loading: boolean;
  signUp: (email: string, password: string, metadata: { role: AppRole; full_name?: string; company?: string; login?: string }) => Promise<{ error: any }>;
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
  // Whose role/profile is currently loaded (or loading).
  const loadedUserId = useRef<string | null>(null);

  const fetchUserData = async (userId: string) => {
    try {
      // Role and profile are independent — fetch them in parallel.
      const [{ data: roleData, error: roleError }, { data: profileData }] = await Promise.all([
        supabase.from('user_roles').select('role').eq('user_id', userId).maybeSingle(),
        supabase.from('profiles').select('*').eq('user_id', userId).maybeSingle(),
      ]);
      if (roleError) throw roleError;
      // Another user signed in while this request was in flight.
      if (loadedUserId.current !== userId) return;

      setRole((roleData?.role as AppRole) ?? null);
      setProfile(profileData ?? null);
    } catch (error) {
      console.error('Error fetching user data:', error);
      setRole(null);
    }
  };

  useEffect(() => {
    // onAuthStateChange fires INITIAL_SESSION on subscribe, so a separate
    // getSession() call would only fetch the same user data a second time.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        // Keep the same object while the user is unchanged: pages depend on
        // `user` in effects and would otherwise reload on every hourly token refresh.
        setUser((prev) => (prev && session?.user && prev.id === session.user.id ? prev : session?.user ?? null));

        if (!session?.user) {
          loadedUserId.current = null;
          setRole(null);
          setProfile(null);
          setLoading(false);
          return;
        }

        // SIGNED_IN is re-emitted when the tab regains focus; refetch only
        // when the user actually changed, or the page would flash a loader.
        const userId = session.user.id;
        // Deferred: supabase-js deadlocks if the callback awaits another supabase call.
        if (loadedUserId.current !== userId) {
          loadedUserId.current = userId;
          setLoading(true);
          setTimeout(() => {
            fetchUserData(userId).finally(() => setLoading(false));
          }, 0);
        } else if (event === 'USER_UPDATED') {
          setTimeout(() => fetchUserData(userId), 0);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string, metadata: { role: AppRole; full_name?: string; company?: string; login?: string }) => {
    const redirectUrl = `${window.location.origin}/`;
    
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: metadata,
      },
    });
    
    return { error };
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    loadedUserId.current = null;
    setUser(null);
    setSession(null);
    setRole(null);
    setProfile(null);
  };

  const refetchProfile = async () => {
    if (user) await fetchUserData(user.id);
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
