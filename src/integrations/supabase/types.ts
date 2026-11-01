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
          is_demo: boolean
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_demo?: boolean
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_demo?: boolean
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
      deadlines: {
        Row: {
          group_id: string | null
          hard_deadline: string | null
          id: string
          late_penalty_per_day: number
          series_id: string | null
          soft_deadline: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          group_id?: string | null
          hard_deadline?: string | null
          id?: string
          late_penalty_per_day?: number
          series_id?: string | null
          soft_deadline?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          group_id?: string | null
          hard_deadline?: string | null
          id?: string
          late_penalty_per_day?: number
          series_id?: string | null
          soft_deadline?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deadlines_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deadlines_series_id_fkey"
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
      exam_tokens: {
        Row: {
          code: string
          created_at: string
          created_by: string
          expires_at: string
          group_id: string
          id: string
          label: string | null
          used_at: string | null
          used_by: string | null
        }
        Insert: {
          code: string
          created_at?: string
          created_by: string
          expires_at: string
          group_id: string
          id?: string
          label?: string | null
          used_at?: string | null
          used_by?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string
          expires_at?: string
          group_id?: string
          id?: string
          label?: string | null
          used_at?: string | null
          used_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exam_tokens_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      grade_audit_logs: {
        Row: {
          changed_by: string
          created_at: string
          field: string
          id: string
          new_value: string | null
          old_value: string | null
          student_id: string
        }
        Insert: {
          changed_by: string
          created_at?: string
          field: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          student_id: string
        }
        Update: {
          changed_by?: string
          created_at?: string
          field?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grade_audit_logs_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
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
          exam_mode: boolean
          id: string
          is_archived: boolean
          name: string
          open_enrollment: boolean
          series_id: string
        }
        Insert: {
          created_at?: string
          exam_mode?: boolean
          id?: string
          is_archived?: boolean
          name: string
          open_enrollment?: boolean
          series_id: string
        }
        Update: {
          created_at?: string
          exam_mode?: boolean
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
      integrity_alerts: {
        Row: {
          adjusted: number
          created_at: string
          detail: Json
          id: string
          other_student_id: string
          similarity: number
          status: string
          student_id: string
          submission_id: string
        }
        Insert: {
          adjusted: number
          created_at?: string
          detail: Json
          id?: string
          other_student_id: string
          similarity: number
          status?: string
          student_id: string
          submission_id: string
        }
        Update: {
          adjusted?: number
          created_at?: string
          detail?: Json
          id?: string
          other_student_id?: string
          similarity?: number
          status?: string
          student_id?: string
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integrity_alerts_other_student_id_fkey"
            columns: ["other_student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integrity_alerts_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integrity_alerts_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      integrity_references: {
        Row: {
          created_at: string
          created_by: string
          note: string | null
          student_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          note?: string | null
          student_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          note?: string | null
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integrity_references_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: true
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      integrity_reviews: {
        Row: {
          id: string
          note: string | null
          reviewed_by: string
          similarity: number | null
          status: string
          student_a: string
          student_b: string
          updated_at: string
        }
        Insert: {
          id?: string
          note?: string | null
          reviewed_by?: string
          similarity?: number | null
          status: string
          student_a: string
          student_b: string
          updated_at?: string
        }
        Update: {
          id?: string
          note?: string | null
          reviewed_by?: string
          similarity?: number | null
          status?: string
          student_a?: string
          student_b?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integrity_reviews_student_a_fkey"
            columns: ["student_a"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integrity_reviews_student_b_fkey"
            columns: ["student_b"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      layout_fingerprints: {
        Row: {
          created_at: string
          data: Json
          student_id: string
          submission_id: string
          version: number
        }
        Insert: {
          created_at?: string
          data: Json
          student_id: string
          submission_id: string
          version: number
        }
        Update: {
          created_at?: string
          data?: Json
          student_id?: string
          submission_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "layout_fingerprints_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "layout_fingerprints_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: true
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      layout_similarity_pairs: {
        Row: {
          created_at: string
          detail: Json
          student_a: string
          student_b: string
          submission_a: string
          submission_b: string
          total: number
          version: number
        }
        Insert: {
          created_at?: string
          detail: Json
          student_a: string
          student_b: string
          submission_a: string
          submission_b: string
          total: number
          version: number
        }
        Update: {
          created_at?: string
          detail?: Json
          student_a?: string
          student_b?: string
          submission_a?: string
          submission_b?: string
          total?: number
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "layout_similarity_pairs_student_a_fkey"
            columns: ["student_a"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "layout_similarity_pairs_student_b_fkey"
            columns: ["student_b"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "layout_similarity_pairs_submission_a_fkey"
            columns: ["submission_a"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "layout_similarity_pairs_submission_b_fkey"
            columns: ["submission_b"]
            isOneToOne: false
            referencedRelation: "submissions"
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
          drive_file_id: string | null
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
          drive_file_id?: string | null
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
          drive_file_id?: string | null
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
      review_annotations: {
        Row: {
          created_at: string
          created_by: string
          id: string
          note: string
          student_id: string
          submission_id: string | null
          x: number
          y: number
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          note: string
          student_id: string
          submission_id?: string | null
          x: number
          y: number
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          note?: string
          student_id?: string
          submission_id?: string | null
          x?: number
          y?: number
        }
        Relationships: [
          {
            foreignKeyName: "review_annotations_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_annotations_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      review_requests: {
        Row: {
          created_at: string
          id: string
          message: string
          resolved_at: string | null
          resolved_by: string | null
          status: string
          student_id: string
          submission_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          student_id: string
          submission_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          student_id?: string
          submission_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "review_requests_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_requests_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      rule_test_runs: {
        Row: {
          activated: boolean
          baseline: Json | null
          candidate: Json
          confirmed_count: number
          created_at: string
          id: string
          note: string | null
          project_count: number
          rejected_count: number
          results: Json
          series_id: string | null
          tested_by: string
        }
        Insert: {
          activated?: boolean
          baseline?: Json | null
          candidate: Json
          confirmed_count?: number
          created_at?: string
          id?: string
          note?: string | null
          project_count?: number
          rejected_count?: number
          results?: Json
          series_id?: string | null
          tested_by: string
        }
        Update: {
          activated?: boolean
          baseline?: Json | null
          candidate?: Json
          confirmed_count?: number
          created_at?: string
          id?: string
          note?: string | null
          project_count?: number
          rejected_count?: number
          results?: Json
          series_id?: string | null
          tested_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "rule_test_runs_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "series"
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
      student_fabrication_slots: {
        Row: {
          drive_file_id: string | null
          file_name: string
          id: string
          size_bytes: number
          slot_key: string
          storage_path: string
          student_id: string
          updated_at: string
          uploaded_by: string
        }
        Insert: {
          drive_file_id?: string | null
          file_name: string
          id?: string
          size_bytes?: number
          slot_key: string
          storage_path: string
          student_id: string
          updated_at?: string
          uploaded_by: string
        }
        Update: {
          drive_file_id?: string | null
          file_name?: string
          id?: string
          size_bytes?: number
          slot_key?: string
          storage_path?: string
          student_id?: string
          updated_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_fabrication_slots_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      students: {
        Row: {
          created_at: string
          deadline_extension_until: string | null
          drive_folder_id: string | null
          drive_layout_folder_id: string | null
          drive_project_folder_id: string | null
          email: string | null
          file_prefix: string | null
          full_name: string
          grade_doc: number | null
          grade_final: number | null
          grade_interview: number | null
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
          deadline_extension_until?: string | null
          drive_folder_id?: string | null
          drive_layout_folder_id?: string | null
          drive_project_folder_id?: string | null
          email?: string | null
          file_prefix?: string | null
          full_name: string
          grade_doc?: number | null
          grade_final?: number | null
          grade_interview?: number | null
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
          deadline_extension_until?: string | null
          drive_folder_id?: string | null
          drive_layout_folder_id?: string | null
          drive_project_folder_id?: string | null
          email?: string | null
          file_prefix?: string | null
          full_name?: string
          grade_doc?: number | null
          grade_final?: number | null
          grade_interview?: number | null
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
          late_days: number | null
          report: Json | null
          report_sha256: string | null
          review_reason: string | null
          review_status: string
          reviewed_at: string | null
          reviewed_by: string | null
          revision: number
          student_id: string
          user_id: string
          variant: Database["public"]["Enums"]["project_variant"]
          zip_path: string | null
          zip_sha256: string | null
        }
        Insert: {
          blocking_count?: number
          created_at?: string
          drc_score?: number | null
          file_name?: string | null
          id?: string
          kind?: string
          late_days?: number | null
          report?: Json | null
          report_sha256?: string | null
          review_reason?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          revision?: number
          student_id: string
          user_id: string
          variant?: Database["public"]["Enums"]["project_variant"]
          zip_path?: string | null
          zip_sha256?: string | null
        }
        Update: {
          blocking_count?: number
          created_at?: string
          drc_score?: number | null
          file_name?: string | null
          id?: string
          kind?: string
          late_days?: number | null
          report?: Json | null
          report_sha256?: string | null
          review_reason?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          revision?: number
          student_id?: string
          user_id?: string
          variant?: Database["public"]["Enums"]["project_variant"]
          zip_path?: string | null
          zip_sha256?: string | null
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
      is_member: { Args: { _uid: string }; Returns: boolean }
      is_staff: { Args: { _uid: string }; Returns: boolean }
      manages_series: {
        Args: { _series: string; _uid: string }
        Returns: boolean
      }
      redeem_exam_token: {
        Args: { _code: string; _student: string }
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
