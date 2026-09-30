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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      academic_years: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json | null
          id: string
          target_entity: string | null
          target_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          target_entity?: string | null
          target_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          target_entity?: string | null
          target_id?: string | null
        }
        Relationships: []
      }
      cam_panels: {
        Row: {
          cols: number
          created_at: string
          created_by: string
          id: string
          name: string
          pitch_mm: number
          rows: number
          series_id: string
          slots: Json
          zip_path: string | null
        }
        Insert: {
          cols?: number
          created_at?: string
          created_by: string
          id?: string
          name: string
          pitch_mm?: number
          rows?: number
          series_id: string
          slots?: Json
          zip_path?: string | null
        }
        Update: {
          cols?: number
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          pitch_mm?: number
          rows?: number
          series_id?: string
          slots?: Json
          zip_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cam_panels_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "series"
            referencedColumns: ["id"]
          },
        ]
      }
      drc_settings: {
        Row: {
          id: string
          series_id: string | null
          settings: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: string
          series_id?: string | null
          settings?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: string
          series_id?: string | null
          settings?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "drc_settings_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "series"
            referencedColumns: ["id"]
          },
        ]
      }
      group_instructors: {
        Row: {
          group_id: string
          id: string
          user_id: string
        }
        Insert: {
          group_id: string
          id?: string
          user_id: string
        }
        Update: {
          group_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_instructors_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          created_at: string
          id: string
          is_archived: boolean
          name: string
          open_enrollment: boolean
          series_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_archived?: boolean
          name: string
          open_enrollment?: boolean
          series_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_archived?: boolean
          name?: string
          open_enrollment?: boolean
          series_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "groups_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "series"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      project_files: {
        Row: {
          created_at: string
          description: string | null
          file_name: string
          file_path: string
          folder: string
          id: string
          mime_type: string | null
          points: number | null
          points_by: string | null
          points_note: string | null
          size_bytes: number | null
          student_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          file_name: string
          file_path: string
          folder?: string
          id?: string
          mime_type?: string | null
          points?: number | null
          points_by?: string | null
          points_note?: string | null
          size_bytes?: number | null
          student_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          file_name?: string
          file_path?: string
          folder?: string
          id?: string
          mime_type?: string | null
          points?: number | null
          points_by?: string | null
          points_note?: string | null
          size_bytes?: number | null
          student_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_files_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      series: {
        Row: {
          academic_year_id: string
          created_at: string
          default_variant: Database["public"]["Enums"]["project_variant"]
          id: string
          is_archived: boolean
          name: string
        }
        Insert: {
          academic_year_id: string
          created_at?: string
          default_variant?: Database["public"]["Enums"]["project_variant"]
          id?: string
          is_archived?: boolean
          name: string
        }
        Update: {
          academic_year_id?: string
          created_at?: string
          default_variant?: Database["public"]["Enums"]["project_variant"]
          id?: string
          is_archived?: boolean
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "series_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
        ]
      }
      series_managers: {
        Row: {
          id: string
          series_id: string
          user_id: string
        }
        Insert: {
          id?: string
          series_id: string
          user_id: string
        }
        Update: {
          id?: string
          series_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "series_managers_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "series"
            referencedColumns: ["id"]
          },
        ]
      }
      sheet_links: {
        Row: {
          created_at: string
          id: string
          last_direction: string | null
          last_synced_at: string | null
          series_id: string
          sheet_name: string
          spreadsheet_id: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          last_direction?: string | null
          last_synced_at?: string | null
          series_id: string
          sheet_name?: string
          spreadsheet_id: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          last_direction?: string | null
          last_synced_at?: string | null
          series_id?: string
          sheet_name?: string
          spreadsheet_id?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sheet_links_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: true
            referencedRelation: "series"
            referencedColumns: ["id"]
          },
        ]
      }
      students: {
        Row: {
          created_at: string
          email: string | null
          file_prefix: string | null
          full_name: string
          grade_doc: number | null
          grade_final: number | null
          grade_schema: number | null
          group_id: string
          id: string
          status: string
          teacher_notes: string | null
          theme_name: string | null
          theme_number: number | null
          user_id: string | null
          variant: Database["public"]["Enums"]["project_variant"]
        }
        Insert: {
          created_at?: string
          email?: string | null
          file_prefix?: string | null
          full_name: string
          grade_doc?: number | null
          grade_final?: number | null
          grade_schema?: number | null
          group_id: string
          id?: string
          status?: string
          teacher_notes?: string | null
          theme_name?: string | null
          theme_number?: number | null
          user_id?: string | null
          variant?: Database["public"]["Enums"]["project_variant"]
        }
        Update: {
          created_at?: string
          email?: string | null
          file_prefix?: string | null
          full_name?: string
          grade_doc?: number | null
          grade_final?: number | null
          grade_schema?: number | null
          group_id?: string
          id?: string
          status?: string
          teacher_notes?: string | null
          theme_name?: string | null
          theme_number?: number | null
          user_id?: string | null
          variant?: Database["public"]["Enums"]["project_variant"]
        }
        Relationships: [
          {
            foreignKeyName: "students_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      submissions: {
        Row: {
          blocking_count: number
          created_at: string
          drc_score: number | null
          file_name: string | null
          id: string
          kind: string
          report: Json | null
          review_reason: string | null
          review_status: string
          reviewed_at: string | null
          reviewed_by: string | null
          revision: number
          student_id: string
          user_id: string
          variant: Database["public"]["Enums"]["project_variant"]
          zip_path: string | null
        }
        Insert: {
          blocking_count?: number
          created_at?: string
          drc_score?: number | null
          file_name?: string | null
          id?: string
          kind?: string
          report?: Json | null
          review_reason?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          revision?: number
          student_id: string
          user_id: string
          variant?: Database["public"]["Enums"]["project_variant"]
          zip_path?: string | null
        }
        Update: {
          blocking_count?: number
          created_at?: string
          drc_score?: number | null
          file_name?: string | null
          id?: string
          kind?: string
          report?: Json | null
          review_reason?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          revision?: number
          student_id?: string
          user_id?: string
          variant?: Database["public"]["Enums"]["project_variant"]
          zip_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "submissions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_manage_group: {
        Args: { _group: string; _uid: string }
        Returns: boolean
      }
      can_view_group: {
        Args: { _group: string; _uid: string }
        Returns: boolean
      }
      ensure_profile: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"][]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_staff: { Args: { _uid: string }; Returns: boolean }
      manages_series: {
        Args: { _series: string; _uid: string }
        Returns: boolean
      }
      set_role: {
        Args: {
          _grant: boolean
          _role: Database["public"]["Enums"]["app_role"]
          _target: string
        }
        Returns: undefined
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "series_manager"
        | "instructor"
        | "student"
        | "cam_tech"
      project_variant: "SMT" | "THT"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: [
        "admin",
        "series_manager",
        "instructor",
        "student",
        "cam_tech",
      ],
      project_variant: ["SMT", "THT"],
    },
  },
} as const
