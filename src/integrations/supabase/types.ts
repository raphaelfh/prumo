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
      ai_assessment_configs: {
        Row: {
          created_at: string
          id: string
          instrument_id: string | null
          is_active: boolean
          max_tokens: number
          model_name: string
          project_id: string
          system_instruction: string | null
          temperature: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          instrument_id?: string | null
          is_active?: boolean
          max_tokens?: number
          model_name?: string
          project_id: string
          system_instruction?: string | null
          temperature?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          instrument_id?: string | null
          is_active?: boolean
          max_tokens?: number
          model_name?: string
          project_id?: string
          system_instruction?: string | null
          temperature?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_assessment_configs_instrument_id_fkey"
            columns: ["instrument_id"]
            isOneToOne: false
            referencedRelation: "assessment_instruments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_assessment_configs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_assessment_prompts: {
        Row: {
          assessment_item_id: string
          created_at: string
          id: string
          system_prompt: string
          updated_at: string
          user_prompt_template: string
        }
        Insert: {
          assessment_item_id: string
          created_at?: string
          id?: string
          system_prompt?: string
          updated_at?: string
          user_prompt_template?: string
        }
        Update: {
          assessment_item_id?: string
          created_at?: string
          id?: string
          system_prompt?: string
          updated_at?: string
          user_prompt_template?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_assessment_prompts_assessment_item_id_fkey"
            columns: ["assessment_item_id"]
            isOneToOne: true
            referencedRelation: "assessment_items"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_assessments: {
        Row: {
          ai_model_used: string
          article_file_id: string | null
          article_id: string
          assessment_item_id: string
          completion_tokens: number | null
          confidence_score: number | null
          created_at: string
          evidence_passages: Json
          human_response: string | null
          id: string
          instrument_id: string
          justification: string
          processing_time_ms: number | null
          project_id: string
          prompt_tokens: number | null
          reviewed_at: string | null
          selected_level: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_model_used: string
          article_file_id?: string | null
          article_id: string
          assessment_item_id: string
          completion_tokens?: number | null
          confidence_score?: number | null
          created_at?: string
          evidence_passages?: Json
          human_response?: string | null
          id?: string
          instrument_id: string
          justification: string
          processing_time_ms?: number | null
          project_id: string
          prompt_tokens?: number | null
          reviewed_at?: string | null
          selected_level: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_model_used?: string
          article_file_id?: string | null
          article_id?: string
          assessment_item_id?: string
          completion_tokens?: number | null
          confidence_score?: number | null
          created_at?: string
          evidence_passages?: Json
          human_response?: string | null
          id?: string
          instrument_id?: string
          justification?: string
          processing_time_ms?: number | null
          project_id?: string
          prompt_tokens?: number | null
          reviewed_at?: string | null
          selected_level?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_assessments_article_file_id_fkey"
            columns: ["article_file_id"]
            isOneToOne: false
            referencedRelation: "article_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_assessments_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_assessments_assessment_item_id_fkey"
            columns: ["assessment_item_id"]
            isOneToOne: false
            referencedRelation: "assessment_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_assessments_instrument_id_fkey"
            columns: ["instrument_id"]
            isOneToOne: false
            referencedRelation: "assessment_instruments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_assessments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_assessments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      article_annotations: {
        Row: {
          article_id: string
          author_id: string | null
          box_id: string | null
          content: string
          created_at: string
          highlight_id: string | null
          id: string
          is_resolved: boolean
          parent_id: string | null
          updated_at: string
        }
        Insert: {
          article_id: string
          author_id?: string | null
          box_id?: string | null
          content: string
          created_at?: string
          highlight_id?: string | null
          id?: string
          is_resolved?: boolean
          parent_id?: string | null
          updated_at?: string
        }
        Update: {
          article_id?: string
          author_id?: string | null
          box_id?: string | null
          content?: string
          created_at?: string
          highlight_id?: string | null
          id?: string
          is_resolved?: boolean
          parent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "article_annotations_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_annotations_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_annotations_box_id_fkey"
            columns: ["box_id"]
            isOneToOne: false
            referencedRelation: "article_boxes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_annotations_highlight_id_fkey"
            columns: ["highlight_id"]
            isOneToOne: false
            referencedRelation: "article_highlights"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_annotations_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "article_annotations"
            referencedColumns: ["id"]
          },
        ]
      }
      article_boxes: {
        Row: {
          article_file_id: string | null
          article_id: string
          author_id: string | null
          color: Json
          created_at: string
          id: string
          page_number: number
          scaled_position: Json
          updated_at: string
        }
        Insert: {
          article_file_id?: string | null
          article_id: string
          author_id?: string | null
          color?: Json
          created_at?: string
          id?: string
          page_number: number
          scaled_position: Json
          updated_at?: string
        }
        Update: {
          article_file_id?: string | null
          article_id?: string
          author_id?: string | null
          color?: Json
          created_at?: string
          id?: string
          page_number?: number
          scaled_position?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "article_boxes_article_file_id_fkey"
            columns: ["article_file_id"]
            isOneToOne: false
            referencedRelation: "article_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_boxes_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_boxes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      article_files: {
        Row: {
          article_id: string
          bytes: number | null
          created_at: string
          file_type: string
          id: string
          md5: string | null
          original_filename: string | null
          project_id: string
          storage_key: string
          updated_at: string
        }
        Insert: {
          article_id: string
          bytes?: number | null
          created_at?: string
          file_type: string
          id?: string
          md5?: string | null
          original_filename?: string | null
          project_id: string
          storage_key: string
          updated_at?: string
        }
        Update: {
          article_id?: string
          bytes?: number | null
          created_at?: string
          file_type?: string
          id?: string
          md5?: string | null
          original_filename?: string | null
          project_id?: string
          storage_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "article_files_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_files_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      article_highlights: {
        Row: {
          article_file_id: string | null
          article_id: string
          author_id: string | null
          color: Json
          created_at: string
          dom_target: Json | null
          id: string
          page_number: number
          scaled_position: Json
          selected_text: string
          updated_at: string
        }
        Insert: {
          article_file_id?: string | null
          article_id: string
          author_id?: string | null
          color?: Json
          created_at?: string
          dom_target?: Json | null
          id?: string
          page_number: number
          scaled_position: Json
          selected_text: string
          updated_at?: string
        }
        Update: {
          article_file_id?: string | null
          article_id?: string
          author_id?: string | null
          color?: Json
          created_at?: string
          dom_target?: Json | null
          id?: string
          page_number?: number
          scaled_position?: Json
          selected_text?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "article_highlights_article_file_id_fkey"
            columns: ["article_file_id"]
            isOneToOne: false
            referencedRelation: "article_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_highlights_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_highlights_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      articles: {
        Row: {
          abstract: string | null
          article_type: string | null
          arxiv_id: string | null
          authors: string[] | null
          conflicts_of_interest: string | null
          created_at: string
          data_availability: string | null
          doi: string | null
          funding: Json | null
          hash_fingerprint: string | null
          id: string
          ingestion_source: string | null
          issue: string | null
          journal_eissn: string | null
          journal_issn: string | null
          journal_publisher: string | null
          journal_title: string | null
          keywords: string[] | null
          language: string | null
          license: string | null
          mesh_terms: string[] | null
          open_access: boolean | null
          pages: string | null
          pii: string | null
          pmcid: string | null
          pmid: string | null
          project_id: string
          publication_day: number | null
          publication_month: number | null
          publication_status: string | null
          publication_year: number | null
          registration: Json | null
          row_version: number
          source_payload: Json | null
          study_design: string | null
          title: string
          updated_at: string
          url_landing: string | null
          url_pdf: string | null
          volume: string | null
        }
        Insert: {
          abstract?: string | null
          article_type?: string | null
          arxiv_id?: string | null
          authors?: string[] | null
          conflicts_of_interest?: string | null
          created_at?: string
          data_availability?: string | null
          doi?: string | null
          funding?: Json | null
          hash_fingerprint?: string | null
          id?: string
          ingestion_source?: string | null
          issue?: string | null
          journal_eissn?: string | null
          journal_issn?: string | null
          journal_publisher?: string | null
          journal_title?: string | null
          keywords?: string[] | null
          language?: string | null
          license?: string | null
          mesh_terms?: string[] | null
          open_access?: boolean | null
          pages?: string | null
          pii?: string | null
          pmcid?: string | null
          pmid?: string | null
          project_id: string
          publication_day?: number | null
          publication_month?: number | null
          publication_status?: string | null
          publication_year?: number | null
          registration?: Json | null
          row_version?: number
          source_payload?: Json | null
          study_design?: string | null
          title: string
          updated_at?: string
          url_landing?: string | null
          url_pdf?: string | null
          volume?: string | null
        }
        Update: {
          abstract?: string | null
          article_type?: string | null
          arxiv_id?: string | null
          authors?: string[] | null
          conflicts_of_interest?: string | null
          created_at?: string
          data_availability?: string | null
          doi?: string | null
          funding?: Json | null
          hash_fingerprint?: string | null
          id?: string
          ingestion_source?: string | null
          issue?: string | null
          journal_eissn?: string | null
          journal_issn?: string | null
          journal_publisher?: string | null
          journal_title?: string | null
          keywords?: string[] | null
          language?: string | null
          license?: string | null
          mesh_terms?: string[] | null
          open_access?: boolean | null
          pages?: string | null
          pii?: string | null
          pmcid?: string | null
          pmid?: string | null
          project_id?: string
          publication_day?: number | null
          publication_month?: number | null
          publication_status?: string | null
          publication_year?: number | null
          registration?: Json | null
          row_version?: number
          source_payload?: Json | null
          study_design?: string | null
          title?: string
          updated_at?: string
          url_landing?: string | null
          url_pdf?: string | null
          volume?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "articles_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      assessment_instruments: {
        Row: {
          aggregation_rules: Json | null
          created_at: string
          id: string
          is_active: boolean
          mode: string
          name: string
          schema: Json | null
          tool_type: string
          version: string
        }
        Insert: {
          aggregation_rules?: Json | null
          created_at?: string
          id?: string
          is_active?: boolean
          mode?: string
          name: string
          schema?: Json | null
          tool_type: string
          version: string
        }
        Update: {
          aggregation_rules?: Json | null
          created_at?: string
          id?: string
          is_active?: boolean
          mode?: string
          name?: string
          schema?: Json | null
          tool_type?: string
          version?: string
        }
        Relationships: []
      }
      assessment_items: {
        Row: {
          allowed_levels: Json
          allowed_levels_override: Json | null
          created_at: string
          domain: string
          id: string
          instrument_id: string
          item_code: string
          question: string
          required: boolean
          sort_order: number
        }
        Insert: {
          allowed_levels: Json
          allowed_levels_override?: Json | null
          created_at?: string
          domain: string
          id?: string
          instrument_id: string
          item_code: string
          question: string
          required?: boolean
          sort_order: number
        }
        Update: {
          allowed_levels?: Json
          allowed_levels_override?: Json | null
          created_at?: string
          domain?: string
          id?: string
          instrument_id?: string
          item_code?: string
          question?: string
          required?: boolean
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "assessment_items_instrument_id_fkey"
            columns: ["instrument_id"]
            isOneToOne: false
            referencedRelation: "assessment_instruments"
            referencedColumns: ["id"]
          },
        ]
      }
      assessments: {
        Row: {
          article_id: string
          assessed_by_type: string
          can_see_others: boolean
          comments: Json
          completion_percentage: number | null
          confidence_level: number | null
          created_at: string
          id: string
          instrument_id: string | null
          is_blind: boolean
          is_current_version: boolean
          overall_assessment: Json | null
          parent_assessment_id: string | null
          private_notes: string | null
          project_id: string | null
          responses: Json
          row_version: number
          run_id: string | null
          status: Database["public"]["Enums"]["assessment_status"]
          tool_type: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          article_id: string
          assessed_by_type?: string
          can_see_others?: boolean
          comments?: Json
          completion_percentage?: number | null
          confidence_level?: number | null
          created_at?: string
          id?: string
          instrument_id?: string | null
          is_blind?: boolean
          is_current_version?: boolean
          overall_assessment?: Json | null
          parent_assessment_id?: string | null
          private_notes?: string | null
          project_id?: string | null
          responses?: Json
          row_version?: number
          run_id?: string | null
          status?: Database["public"]["Enums"]["assessment_status"]
          tool_type: string
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          article_id?: string
          assessed_by_type?: string
          can_see_others?: boolean
          comments?: Json
          completion_percentage?: number | null
          confidence_level?: number | null
          created_at?: string
          id?: string
          instrument_id?: string | null
          is_blind?: boolean
          is_current_version?: boolean
          overall_assessment?: Json | null
          parent_assessment_id?: string | null
          private_notes?: string | null
          project_id?: string | null
          responses?: Json
          row_version?: number
          run_id?: string | null
          status?: Database["public"]["Enums"]["assessment_status"]
          tool_type?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "assessments_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessments_instrument_id_fkey"
            columns: ["instrument_id"]
            isOneToOne: false
            referencedRelation: "assessment_instruments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessments_parent_assessment_id_fkey"
            columns: ["parent_assessment_id"]
            isOneToOne: false
            referencedRelation: "assessments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      project_members: {
        Row: {
          created_at: string
          created_by_id: string | null
          id: string
          invitation_accepted_at: string | null
          invitation_email: string | null
          invitation_sent_at: string | null
          invitation_token: string | null
          permissions: Json
          project_id: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by_id?: string | null
          id?: string
          invitation_accepted_at?: string | null
          invitation_email?: string | null
          invitation_sent_at?: string | null
          invitation_token?: string | null
          permissions?: Json
          project_id: string
          role?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by_id?: string | null
          id?: string
          invitation_accepted_at?: string | null
          invitation_email?: string | null
          invitation_sent_at?: string | null
          invitation_token?: string | null
          permissions?: Json
          project_id?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_created_by_id_fkey"
            columns: ["created_by_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          condition_studied: string | null
          created_at: string
          created_by_id: string
          description: string | null
          eligibility_criteria: Json
          id: string
          is_active: boolean
          name: string
          picots_config_ai_review: Json | null
          review_context: string | null
          review_keywords: Json
          review_rationale: string | null
          review_title: string | null
          risk_of_bias_instrument_id: string | null
          search_strategy: string | null
          settings: Json
          study_design: Json
          updated_at: string
        }
        Insert: {
          condition_studied?: string | null
          created_at?: string
          created_by_id: string
          description?: string | null
          eligibility_criteria?: Json
          id?: string
          is_active?: boolean
          name: string
          picots_config_ai_review?: Json | null
          review_context?: string | null
          review_keywords?: Json
          review_rationale?: string | null
          review_title?: string | null
          risk_of_bias_instrument_id?: string | null
          search_strategy?: string | null
          settings?: Json
          study_design?: Json
          updated_at?: string
        }
        Update: {
          condition_studied?: string | null
          created_at?: string
          created_by_id?: string
          description?: string | null
          eligibility_criteria?: Json
          id?: string
          is_active?: boolean
          name?: string
          picots_config_ai_review?: Json | null
          review_context?: string | null
          review_keywords?: Json
          review_rationale?: string | null
          review_title?: string | null
          risk_of_bias_instrument_id?: string | null
          search_strategy?: string | null
          settings?: Json
          study_design?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_created_by_id_fkey"
            columns: ["created_by_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_custom_vocabulary: {
        Args: {
          project_uuid: string
          vocab_description?: string
          vocab_name: string
        }
        Returns: string
      }
      calculate_assessment_discordances: {
        Args: { project_id: string }
        Returns: {
          article_id: string
          discordance_percentage: number
          discordant_items: number
          instrument_id: string
          total_items: number
        }[]
      }
      can_access_article: {
        Args: { p_project_id: string; p_user_id: string }
        Returns: boolean
      }
      can_manage_article: {
        Args: { p_project_id: string; p_user_id: string }
        Returns: boolean
      }
      check_project_access: {
        Args: { p_project_id: string; p_user_id: string }
        Returns: boolean
      }
      create_project_bypass_rls: {
        Args: { creator_id: string; project_name: string }
        Returns: string
      }
      create_project_with_creator: {
        Args: { creator_id: string; project_name: string }
        Returns: string
      }
      debug_edge_function_call: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      final_edge_function_test: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      gtrgm_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gtrgm_decompress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gtrgm_in: {
        Args: { "": unknown }
        Returns: unknown
      }
      gtrgm_options: {
        Args: { "": unknown }
        Returns: undefined
      }
      gtrgm_out: {
        Args: { "": unknown }
        Returns: unknown
      }
      initialize_project_vocabularies: {
        Args: { project_uuid: string }
        Returns: undefined
      }
      is_project_manager: {
        Args: { p_project: string; p_user: string }
        Returns: boolean
      }
      is_project_member: {
        Args: { p_project: string; p_user: string }
        Returns: boolean
      }
      set_limit: {
        Args: { "": number }
        Returns: number
      }
      show_limit: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      show_trgm: {
        Args: { "": string }
        Returns: string[]
      }
      test_ai_assessment_comprehensive: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      test_ai_assessment_function: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      test_edge_function_call: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
    }
    Enums: {
      annotation_status: "active" | "deleted"
      annotation_type: "text" | "area" | "highlight" | "note" | "underline"
      assessment_status: "in_progress" | "submitted" | "locked" | "archived"
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
      annotation_status: ["active", "deleted"],
      annotation_type: ["text", "area", "highlight", "note", "underline"],
      assessment_status: ["in_progress", "submitted", "locked", "archived"],
    },
  },
} as const