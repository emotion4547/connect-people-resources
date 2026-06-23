export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      chat_messages: {
        Row: {
          attachments: Json | null
          chat_id: string
          created_at: string
          id: string
          is_read: boolean | null
          message: string
          sender_type: Database["public"]["Enums"]["sender_type"]
        }
        Insert: {
          attachments?: Json | null
          chat_id: string
          created_at?: string
          id?: string
          is_read?: boolean | null
          message: string
          sender_type: Database["public"]["Enums"]["sender_type"]
        }
        Update: {
          attachments?: Json | null
          chat_id?: string
          created_at?: string
          id?: string
          is_read?: boolean | null
          message?: string
          sender_type?: Database["public"]["Enums"]["sender_type"]
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "support_chats"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_messages: {
        Row: {
          created_at: string
          email: string
          id: string
          is_read: boolean
          message: string
          name: string
          phone: string | null
          subject: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          is_read?: boolean
          message: string
          name: string
          phone?: string | null
          subject: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          is_read?: boolean
          message?: string
          name?: string
          phone?: string | null
          subject?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          admin_notes: string | null
          avatar_url: string | null
          block_reason: string | null
          city: string | null
          company: string | null
          created_at: string
          email: string
          experience: string | null
          full_name: string | null
          id: string
          is_active: boolean | null
          login: string | null
          phone: string | null
          preferred_positions: string[] | null
          preferred_schedule: string | null
          rating: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_notes?: string | null
          avatar_url?: string | null
          block_reason?: string | null
          city?: string | null
          company?: string | null
          created_at?: string
          email: string
          experience?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean | null
          login?: string | null
          phone?: string | null
          preferred_positions?: string[] | null
          preferred_schedule?: string | null
          rating?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_notes?: string | null
          avatar_url?: string | null
          block_reason?: string | null
          city?: string | null
          company?: string | null
          created_at?: string
          email?: string
          experience?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean | null
          login?: string | null
          phone?: string | null
          preferred_positions?: string[] | null
          preferred_schedule?: string | null
          rating?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      request_templates: {
        Row: {
          address: string | null
          comments: string | null
          created_at: string
          end_time: string | null
          hr_id: string
          id: string
          name: string
          pay: string | null
          position: string
          quantity: number | null
          requirements: string | null
          start_time: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          comments?: string | null
          created_at?: string
          end_time?: string | null
          hr_id: string
          id?: string
          name: string
          pay?: string | null
          position: string
          quantity?: number | null
          requirements?: string | null
          start_time?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          comments?: string | null
          created_at?: string
          end_time?: string | null
          hr_id?: string
          id?: string
          name?: string
          pay?: string | null
          position?: string
          quantity?: number | null
          requirements?: string | null
          start_time?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      requests: {
        Row: {
          address: string
          comments: string | null
          created_at: string
          end_date: string
          end_time: string | null
          hr_id: string
          id: string
          pay: string | null
          position: string
          quantity: number
          requirements: string | null
          site_id: string | null
          start_date: string
          start_time: string | null
          status: Database["public"]["Enums"]["request_status"]
          updated_at: string
          webhook_sent: boolean | null
        }
        Insert: {
          address: string
          comments?: string | null
          created_at?: string
          end_date: string
          end_time?: string | null
          hr_id: string
          id?: string
          pay?: string | null
          position: string
          quantity?: number
          requirements?: string | null
          site_id?: string | null
          start_date: string
          start_time?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          updated_at?: string
          webhook_sent?: boolean | null
        }
        Update: {
          address?: string
          comments?: string | null
          created_at?: string
          end_date?: string
          end_time?: string | null
          hr_id?: string
          id?: string
          pay?: string | null
          position?: string
          quantity?: number
          requirements?: string | null
          site_id?: string | null
          start_date?: string
          start_time?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          updated_at?: string
          webhook_sent?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "requests_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      responses: {
        Row: {
          created_at: string
          id: string
          request_id: string
          status: Database["public"]["Enums"]["response_status"]
          updated_at: string
          worker_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          request_id: string
          status?: Database["public"]["Enums"]["response_status"]
          updated_at?: string
          worker_id: string
        }
        Update: {
          created_at?: string
          id?: string
          request_id?: string
          status?: Database["public"]["Enums"]["response_status"]
          updated_at?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "responses_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      site_managers: {
        Row: {
          created_at: string
          hr_user_id: string
          id: string
          site_id: string
        }
        Insert: {
          created_at?: string
          hr_user_id: string
          id?: string
          site_id: string
        }
        Update: {
          created_at?: string
          hr_user_id?: string
          id?: string
          site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_managers_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      site_workers: {
        Row: {
          created_at: string
          id: string
          site_id: string
          worker_user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          site_id: string
          worker_user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          site_id?: string
          worker_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_workers_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      sites: {
        Row: {
          address: string | null
          city: string | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      support_chats: {
        Row: {
          created_at: string
          id: string
          is_closed: boolean | null
          request_id: string | null
          unread_count: number | null
          updated_at: string
          user_id: string
          user_type: Database["public"]["Enums"]["user_type"]
        }
        Insert: {
          created_at?: string
          id?: string
          is_closed?: boolean | null
          request_id?: string | null
          unread_count?: number | null
          updated_at?: string
          user_id: string
          user_type: Database["public"]["Enums"]["user_type"]
        }
        Update: {
          created_at?: string
          id?: string
          is_closed?: boolean | null
          request_id?: string | null
          unread_count?: number | null
          updated_at?: string
          user_id?: string
          user_type?: Database["public"]["Enums"]["user_type"]
        }
        Relationships: [
          {
            foreignKeyName: "support_chats_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      webhook_logs: {
        Row: {
          created_at: string
          id: string
          request_id: string
          response: string | null
          success: boolean
          url: string
        }
        Insert: {
          created_at?: string
          id?: string
          request_id: string
          response?: string | null
          success: boolean
          url: string
        }
        Update: {
          created_at?: string
          id?: string
          request_id?: string
          response?: string | null
          success?: boolean
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_logs_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_settings: {
        Row: {
          created_at: string
          id: string
          is_active: boolean | null
          updated_at: string
          webhook_url: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean | null
          updated_at?: string
          webhook_url?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean | null
          updated_at?: string
          webhook_url?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      hr_assigned_to_site: {
        Args: { _hr: string; _site: string }
        Returns: boolean
      }
      hr_can_rate_worker: {
        Args: { _hr: string; _worker: string }
        Returns: boolean
      }
      hr_has_worker: {
        Args: { _hr_id: string; _worker_user_id: string }
        Returns: boolean
      }
      hr_owns_request: {
        Args: { _hr_id: string; _request_id: string }
        Returns: boolean
      }
      hr_shares_site_with_worker: {
        Args: { _hr: string; _worker: string }
        Returns: boolean
      }
      worker_assigned_to_site: {
        Args: { _site: string; _worker: string }
        Returns: boolean
      }
      worker_responded_to_request: {
        Args: { _request_id: string; _worker_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "hr" | "worker" | "admin"
      request_status:
        | "new"
        | "in_progress"
        | "assigned"
        | "completed"
        | "cancelled"
        | "pending_confirmation"
      response_status:
        | "pending"
        | "assigned"
        | "rejected"
        | "completed"
        | "no_show"
      sender_type: "user" | "admin"
      user_type: "hr" | "worker"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["hr", "worker", "admin"],
      request_status: [
        "new",
        "in_progress",
        "assigned",
        "completed",
        "cancelled",
        "pending_confirmation",
      ],
      response_status: [
        "pending",
        "assigned",
        "rejected",
        "completed",
        "no_show",
      ],
      sender_type: ["user", "admin"],
      user_type: ["hr", "worker"],
    },
  },
} as const
