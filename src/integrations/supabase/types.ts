/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

Connecting to db 5432
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
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
      ai_suggestions: {
        Row: {
          confidence_score: number | null
          created_at: string
          field_id: string
          id: string
          instance_id: string | null
          metadata: Json
          reasoning: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          run_id: string
          status: Database["public"]["Enums"]["suggestion_status"]
          suggested_value: Json
        }
        Insert: {
          confidence_score?: number | null
          created_at?: string
          field_id: string
          id?: string
          instance_id?: string | null
          metadata?: Json
          reasoning?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          run_id: string
          status?: Database["public"]["Enums"]["suggestion_status"]
          suggested_value: Json
        }
        Update: {
          confidence_score?: number | null
          created_at?: string
          field_id?: string
          id?: string
          instance_id?: string | null
          metadata?: Json
          reasoning?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          run_id?: string
          status?: Database["public"]["Enums"]["suggestion_status"]
          suggested_value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "ai_suggestions_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "extraction_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_suggestions_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "extraction_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_suggestions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_suggestions_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "extraction_runs"
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
          extracted_at: string | null
          extraction_error: string | null
          extraction_status: string | null
          file_role: Database["public"]["Enums"]["file_role"] | null
          file_type: string
          id: string
          md5: string | null
          original_filename: string | null
          project_id: string
          storage_key: string
          text_html: string | null
          text_raw: string | null
          updated_at: string
        }
        Insert: {
          article_id: string
          bytes?: number | null
          created_at?: string
          extracted_at?: string | null
          extraction_error?: string | null
          extraction_status?: string | null
          file_role?: Database["public"]["Enums"]["file_role"] | null
          file_type: string
          id?: string
          md5?: string | null
          original_filename?: string | null
          project_id: string
          storage_key: string
          text_html?: string | null
          text_raw?: string | null
          updated_at?: string
        }
        Update: {
          article_id?: string
          bytes?: number | null
          created_at?: string
          extracted_at?: string | null
          extraction_error?: string | null
          extraction_status?: string | null
          file_role?: Database["public"]["Enums"]["file_role"] | null
          file_type?: string
          id?: string
          md5?: string | null
          original_filename?: string | null
          project_id?: string
          storage_key?: string
          text_html?: string | null
          text_raw?: string | null
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
          zotero_collection_key: string | null
          zotero_item_key: string | null
          zotero_version: number | null
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
          zotero_collection_key?: string | null
          zotero_item_key?: string | null
          zotero_version?: number | null
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
          zotero_collection_key?: string | null
          zotero_item_key?: string | null
          zotero_version?: number | null
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
          extraction_instance_id: string | null
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
          extraction_instance_id?: string | null
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
          extraction_instance_id?: string | null
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
            foreignKeyName: "assessments_extraction_instance_id_fkey"
            columns: ["extraction_instance_id"]
            isOneToOne: false
            referencedRelation: "extraction_instances"
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
      extracted_values: {
        Row: {
          ai_suggestion_id: string | null
          article_id: string
          confidence_score: number | null
          created_at: string
          evidence: Json
          field_id: string
          id: string
          instance_id: string
          is_consensus: boolean
          project_id: string
          reviewer_id: string | null
          source: Database["public"]["Enums"]["extraction_source"]
          unit: string | null
          updated_at: string
          value: Json
        }
        Insert: {
          ai_suggestion_id?: string | null
          article_id: string
          confidence_score?: number | null
          created_at?: string
          evidence?: Json
          field_id: string
          id?: string
          instance_id: string
          is_consensus?: boolean
          project_id: string
          reviewer_id?: string | null
          source: Database["public"]["Enums"]["extraction_source"]
          unit?: string | null
          updated_at?: string
          value?: Json
        }
        Update: {
          ai_suggestion_id?: string | null
          article_id?: string
          confidence_score?: number | null
          created_at?: string
          evidence?: Json
          field_id?: string
          id?: string
          instance_id?: string
          is_consensus?: boolean
          project_id?: string
          reviewer_id?: string | null
          source?: Database["public"]["Enums"]["extraction_source"]
          unit?: string | null
          updated_at?: string
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "extracted_values_ai_suggestion_id_fkey"
            columns: ["ai_suggestion_id"]
            isOneToOne: false
            referencedRelation: "ai_suggestions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extracted_values_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extracted_values_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "extraction_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extracted_values_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "extraction_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extracted_values_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extracted_values_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      extraction_entity_types: {
        Row: {
          cardinality: Database["public"]["Enums"]["extraction_cardinality"]
          created_at: string
          description: string | null
          id: string
          is_required: boolean
          label: string
          name: string
          parent_entity_type_id: string | null
          project_template_id: string | null
          sort_order: number
          template_id: string | null
        }
        Insert: {
          cardinality?: Database["public"]["Enums"]["extraction_cardinality"]
          created_at?: string
          description?: string | null
          id?: string
          is_required?: boolean
          label: string
          name: string
          parent_entity_type_id?: string | null
          project_template_id?: string | null
          sort_order?: number
          template_id?: string | null
        }
        Update: {
          cardinality?: Database["public"]["Enums"]["extraction_cardinality"]
          created_at?: string
          description?: string | null
          id?: string
          is_required?: boolean
          label?: string
          name?: string
          parent_entity_type_id?: string | null
          project_template_id?: string | null
          sort_order?: number
          template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "extraction_entity_types_parent_entity_type_id_fkey"
            columns: ["parent_entity_type_id"]
            isOneToOne: false
            referencedRelation: "extraction_entity_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_entity_types_project_template_id_fkey"
            columns: ["project_template_id"]
            isOneToOne: false
            referencedRelation: "project_extraction_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_entity_types_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "extraction_templates_global"
            referencedColumns: ["id"]
          },
        ]
      }
      extraction_evidence: {
        Row: {
          article_file_id: string | null
          article_id: string
          created_at: string
          created_by: string
          id: string
          page_number: number | null
          position: Json | null
          project_id: string
          target_id: string
          target_type: string
          text_content: string | null
        }
        Insert: {
          article_file_id?: string | null
          article_id: string
          created_at?: string
          created_by: string
          id?: string
          page_number?: number | null
          position?: Json | null
          project_id: string
          target_id: string
          target_type: string
          text_content?: string | null
        }
        Update: {
          article_file_id?: string | null
          article_id?: string
          created_at?: string
          created_by?: string
          id?: string
          page_number?: number | null
          position?: Json | null
          project_id?: string
          target_id?: string
          target_type?: string
          text_content?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "extraction_evidence_article_file_id_fkey"
            columns: ["article_file_id"]
            isOneToOne: false
            referencedRelation: "article_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_evidence_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_evidence_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_evidence_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      extraction_fields: {
        Row: {
          allow_other: boolean
          allowed_units: Json | null
          allowed_values: Json | null
          created_at: string
          description: string | null
          entity_type_id: string
          field_type: Database["public"]["Enums"]["extraction_field_type"]
          id: string
          is_required: boolean
          label: string
          llm_description: string | null
          name: string
          other_label: string
          other_placeholder: string | null
          sort_order: number
          unit: string | null
          validation_schema: Json | null
        }
        Insert: {
          allow_other?: boolean
          allowed_units?: Json | null
          allowed_values?: Json | null
          created_at?: string
          description?: string | null
          entity_type_id: string
          field_type: Database["public"]["Enums"]["extraction_field_type"]
          id?: string
          is_required?: boolean
          label: string
          llm_description?: string | null
          name: string
          other_label?: string
          other_placeholder?: string | null
          sort_order?: number
          unit?: string | null
          validation_schema?: Json | null
        }
        Update: {
          allow_other?: boolean
          allowed_units?: Json | null
          allowed_values?: Json | null
          created_at?: string
          description?: string | null
          entity_type_id?: string
          field_type?: Database["public"]["Enums"]["extraction_field_type"]
          id?: string
          is_required?: boolean
          label?: string
          llm_description?: string | null
          name?: string
          other_label?: string
          other_placeholder?: string | null
          sort_order?: number
          unit?: string | null
          validation_schema?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "extraction_fields_entity_type_id_fkey"
            columns: ["entity_type_id"]
            isOneToOne: false
            referencedRelation: "extraction_entity_types"
            referencedColumns: ["id"]
          },
        ]
      }
      extraction_instances: {
        Row: {
          article_id: string | null
          created_at: string
          created_by: string
          entity_type_id: string
          id: string
          is_template: boolean | null
          label: string
          metadata: Json
          parent_instance_id: string | null
          project_id: string
          sort_order: number
          status: string | null
          template_id: string
          updated_at: string
        }
        Insert: {
          article_id?: string | null
          created_at?: string
          created_by: string
          entity_type_id: string
          id?: string
          is_template?: boolean | null
          label: string
          metadata?: Json
          parent_instance_id?: string | null
          project_id: string
          sort_order?: number
          status?: string | null
          template_id: string
          updated_at?: string
        }
        Update: {
          article_id?: string | null
          created_at?: string
          created_by?: string
          entity_type_id?: string
          id?: string
          is_template?: boolean | null
          label?: string
          metadata?: Json
          parent_instance_id?: string | null
          project_id?: string
          sort_order?: number
          status?: string | null
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "extraction_instances_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_instances_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_instances_entity_type_id_fkey"
            columns: ["entity_type_id"]
            isOneToOne: false
            referencedRelation: "extraction_entity_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_instances_parent_instance_id_fkey"
            columns: ["parent_instance_id"]
            isOneToOne: false
            referencedRelation: "extraction_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_instances_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_instances_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "project_extraction_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      extraction_runs: {
        Row: {
          article_id: string
          completed_at: string | null
          created_at: string
          created_by: string
          error_message: string | null
          id: string
          parameters: Json
          project_id: string
          results: Json
          stage: Database["public"]["Enums"]["extraction_run_stage"]
          started_at: string | null
          status: Database["public"]["Enums"]["extraction_run_status"]
          template_id: string
        }
        Insert: {
          article_id: string
          completed_at?: string | null
          created_at?: string
          created_by: string
          error_message?: string | null
          id?: string
          parameters?: Json
          project_id: string
          results?: Json
          stage: Database["public"]["Enums"]["extraction_run_stage"]
          started_at?: string | null
          status?: Database["public"]["Enums"]["extraction_run_status"]
          template_id: string
        }
        Update: {
          article_id?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string
          error_message?: string | null
          id?: string
          parameters?: Json
          project_id?: string
          results?: Json
          stage?: Database["public"]["Enums"]["extraction_run_stage"]
          started_at?: string | null
          status?: Database["public"]["Enums"]["extraction_run_status"]
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "extraction_runs_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_runs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_runs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "project_extraction_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      extraction_templates_global: {
        Row: {
          created_at: string
          description: string | null
          framework: Database["public"]["Enums"]["extraction_framework"]
          id: string
          is_global: boolean
          name: string
          schema: Json
          updated_at: string
          version: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          framework: Database["public"]["Enums"]["extraction_framework"]
          id?: string
          is_global?: boolean
          name: string
          schema?: Json
          updated_at?: string
          version?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          framework?: Database["public"]["Enums"]["extraction_framework"]
          id?: string
          is_global?: boolean
          name?: string
          schema?: Json
          updated_at?: string
          version?: string
        }
        Relationships: []
      }
      feedback_reports: {
        Row: {
          admin_notes: string | null
          article_id: string | null
          created_at: string | null
          description: string
          id: string
          priority: number | null
          project_id: string | null
          screenshot_url: string | null
          severity: string | null
          status: string | null
          type: string
          updated_at: string | null
          url: string
          user_agent: string | null
          user_id: string | null
          viewport_size: Json | null
        }
        Insert: {
          admin_notes?: string | null
          article_id?: string | null
          created_at?: string | null
          description: string
          id?: string
          priority?: number | null
          project_id?: string | null
          screenshot_url?: string | null
          severity?: string | null
          status?: string | null
          type: string
          updated_at?: string | null
          url: string
          user_agent?: string | null
          user_id?: string | null
          viewport_size?: Json | null
        }
        Update: {
          admin_notes?: string | null
          article_id?: string | null
          created_at?: string | null
          description?: string
          id?: string
          priority?: number | null
          project_id?: string | null
          screenshot_url?: string | null
          severity?: string | null
          status?: string | null
          type?: string
          updated_at?: string | null
          url?: string
          user_agent?: string | null
          user_id?: string | null
          viewport_size?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "feedback_reports_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_reports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
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
      project_extraction_templates: {
        Row: {
          created_at: string
          created_by: string
          description: string | null
          framework: Database["public"]["Enums"]["extraction_framework"]
          global_template_id: string | null
          id: string
          is_active: boolean
          name: string
          project_id: string
          schema: Json
          updated_at: string
          version: string
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          framework: Database["public"]["Enums"]["extraction_framework"]
          global_template_id?: string | null
          id?: string
          is_active?: boolean
          name: string
          project_id: string
          schema?: Json
          updated_at?: string
          version?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          framework?: Database["public"]["Enums"]["extraction_framework"]
          global_template_id?: string | null
          id?: string
          is_active?: boolean
          name?: string
          project_id?: string
          schema?: Json
          updated_at?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_extraction_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_extraction_templates_global_template_id_fkey"
            columns: ["global_template_id"]
            isOneToOne: false
            referencedRelation: "extraction_templates_global"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_extraction_templates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
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
          role: Database["public"]["Enums"]["project_member_role"]
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
          role?: Database["public"]["Enums"]["project_member_role"]
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
          role?: Database["public"]["Enums"]["project_member_role"]
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
          assessment_entity_type_id: string | null
          assessment_scope: string | null
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
          review_type: Database["public"]["Enums"]["review_type"] | null
          risk_of_bias_instrument_id: string | null
          search_strategy: string | null
          settings: Json
          study_design: Json
          updated_at: string
        }
        Insert: {
          assessment_entity_type_id?: string | null
          assessment_scope?: string | null
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
          review_type?: Database["public"]["Enums"]["review_type"] | null
          risk_of_bias_instrument_id?: string | null
          search_strategy?: string | null
          settings?: Json
          study_design?: Json
          updated_at?: string
        }
        Update: {
          assessment_entity_type_id?: string | null
          assessment_scope?: string | null
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
          review_type?: Database["public"]["Enums"]["review_type"] | null
          risk_of_bias_instrument_id?: string | null
          search_strategy?: string | null
          settings?: Json
          study_design?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_assessment_entity_type_id_fkey"
            columns: ["assessment_entity_type_id"]
            isOneToOne: false
            referencedRelation: "extraction_entity_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_created_by_id_fkey"
            columns: ["created_by_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      zotero_integrations: {
        Row: {
          created_at: string
          encrypted_api_key: string | null
          id: string
          is_active: boolean
          last_sync_at: string | null
          library_type: string
          updated_at: string
          user_id: string
          zotero_user_id: string
        }
        Insert: {
          created_at?: string
          encrypted_api_key?: string | null
          id?: string
          is_active?: boolean
          last_sync_at?: string | null
          library_type: string
          updated_at?: string
          user_id: string
          zotero_user_id: string
        }
        Update: {
          created_at?: string
          encrypted_api_key?: string | null
          id?: string
          is_active?: boolean
          last_sync_at?: string | null
          library_type?: string
          updated_at?: string
          user_id?: string
          zotero_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "zotero_integrations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
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
      check_cardinality_one: {
        Args: {
          p_article_id: string
          p_entity_type_id: string
          p_parent_instance_id?: string
        }
        Returns: boolean
      }
      create_project_with_member: {
        Args: {
          p_description?: string
          p_name: string
          p_review_title?: string
        }
        Returns: string
      }
      is_project_manager: {
        Args: { p_project: string; p_user: string }
        Returns: boolean
      }
      is_project_member: {
        Args: { p_project: string; p_user: string }
        Returns: boolean
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      assessment_status: "in_progress" | "submitted" | "locked" | "archived"
      extraction_cardinality: "one" | "many"
      extraction_field_type:
        | "text"
        | "number"
        | "date"
        | "select"
        | "multiselect"
        | "boolean"
      extraction_framework: "CHARMS" | "PICOS" | "CUSTOM"
      extraction_run_stage:
        | "data_suggest"
        | "parsing"
        | "validation"
        | "consensus"
      extraction_run_status: "pending" | "running" | "completed" | "failed"
      extraction_source: "human" | "ai" | "rule"
      file_role:
        | "MAIN"
        | "SUPPLEMENT"
        | "PROTOCOL"
        | "DATASET"
        | "APPENDIX"
        | "FIGURE"
        | "OTHER"
      project_member_role: "manager" | "reviewer" | "viewer" | "consensus"
      review_type:
        | "interventional"
        | "predictive_model"
        | "diagnostic"
        | "prognostic"
        | "qualitative"
        | "other"
      suggestion_status: "pending" | "accepted" | "rejected"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      assessment_status: ["in_progress", "submitted", "locked", "archived"],
      extraction_cardinality: ["one", "many"],
      extraction_field_type: [
        "text",
        "number",
        "date",
        "select",
        "multiselect",
        "boolean",
      ],
      extraction_framework: ["CHARMS", "PICOS", "CUSTOM"],
      extraction_run_stage: [
        "data_suggest",
        "parsing",
        "validation",
        "consensus",
      ],
      extraction_run_status: ["pending", "running", "completed", "failed"],
      extraction_source: ["human", "ai", "rule"],
      file_role: [
        "MAIN",
        "SUPPLEMENT",
        "PROTOCOL",
        "DATASET",
        "APPENDIX",
        "FIGURE",
        "OTHER",
      ],
      project_member_role: ["manager", "reviewer", "viewer", "consensus"],
      review_type: [
        "interventional",
        "predictive_model",
        "diagnostic",
        "prognostic",
        "qualitative",
        "other",
      ],
      suggestion_status: ["pending", "accepted", "rejected"],
    },
  },
} as const

