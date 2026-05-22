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
      alembic_version: {
        Row: {
          version_num: string
        }
        Insert: {
          version_num: string
        }
        Update: {
          version_num?: string
        }
        Relationships: []
      }
      article_annotations: {
        Row: {
          article_file_id: string | null
          article_id: string
          content: string | null
          created_at: string
          id: string
          page_number: number | null
          position: Json | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          article_file_id?: string | null
          article_id: string
          content?: string | null
          created_at?: string
          id?: string
          page_number?: number | null
          position?: Json | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          article_file_id?: string | null
          article_id?: string
          content?: string | null
          created_at?: string
          id?: string
          page_number?: number | null
          position?: Json | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "article_annotations_article_file_id_fkey"
            columns: ["article_file_id"]
            isOneToOne: false
            referencedRelation: "article_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_annotations_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
        ]
      }
      article_author_links: {
        Row: {
          article_id: string
          author_id: string
          author_order: number
          created_at: string
          creator_type: string
          id: string
          raw_creator_payload: Json | null
          updated_at: string
        }
        Insert: {
          article_id: string
          author_id: string
          author_order: number
          created_at?: string
          creator_type?: string
          id?: string
          raw_creator_payload?: Json | null
          updated_at?: string
        }
        Update: {
          article_id?: string
          author_id?: string
          author_order?: number
          created_at?: string
          creator_type?: string
          id?: string
          raw_creator_payload?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "article_author_links_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_author_links_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "article_authors"
            referencedColumns: ["id"]
          },
        ]
      }
      article_authors: {
        Row: {
          created_at: string
          display_name: string
          id: string
          normalized_name: string
          orcid: string | null
          source_hint: Json | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          normalized_name: string
          orcid?: string | null
          source_hint?: Json | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          normalized_name?: string
          orcid?: string | null
          source_hint?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      article_boxes: {
        Row: {
          article_file_id: string | null
          article_id: string
          color: string | null
          created_at: string
          id: string
          label: string | null
          page_number: number | null
          position: Json | null
          user_id: string | null
        }
        Insert: {
          article_file_id?: string | null
          article_id: string
          color?: string | null
          created_at?: string
          id?: string
          label?: string | null
          page_number?: number | null
          position?: Json | null
          user_id?: string | null
        }
        Update: {
          article_file_id?: string | null
          article_id?: string
          color?: string | null
          created_at?: string
          id?: string
          label?: string | null
          page_number?: number | null
          position?: Json | null
          user_id?: string | null
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
          color: string | null
          created_at: string
          highlighted_text: string | null
          id: string
          page_number: number | null
          position: Json | null
          user_id: string | null
        }
        Insert: {
          article_file_id?: string | null
          article_id: string
          color?: string | null
          created_at?: string
          highlighted_text?: string | null
          id?: string
          page_number?: number | null
          position?: Json | null
          user_id?: string | null
        }
        Update: {
          article_file_id?: string | null
          article_id?: string
          color?: string | null
          created_at?: string
          highlighted_text?: string | null
          id?: string
          page_number?: number | null
          position?: Json | null
          user_id?: string | null
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
        ]
      }
      article_sync_events: {
        Row: {
          article_id: string | null
          authority_rule_applied: string | null
          created_at: string
          error_code: string | null
          error_message: string | null
          event_payload: Json | null
          id: string
          processed_at: string
          project_id: string
          status: string
          sync_run_id: string
          updated_at: string
          zotero_item_key: string | null
        }
        Insert: {
          article_id?: string | null
          authority_rule_applied?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          event_payload?: Json | null
          id?: string
          processed_at?: string
          project_id: string
          status: string
          sync_run_id: string
          updated_at?: string
          zotero_item_key?: string | null
        }
        Update: {
          article_id?: string | null
          authority_rule_applied?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          event_payload?: Json | null
          id?: string
          processed_at?: string
          project_id?: string
          status?: string
          sync_run_id?: string
          updated_at?: string
          zotero_item_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "article_sync_events_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_sync_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_sync_events_sync_run_id_fkey"
            columns: ["sync_run_id"]
            isOneToOne: false
            referencedRelation: "article_sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      article_sync_runs: {
        Row: {
          completed_at: string | null
          created_at: string
          failed: number
          failure_summary: Json | null
          id: string
          persisted: number
          project_id: string
          reactivated: number
          removed_at_source: number
          requested_by_user_id: string
          skipped: number
          source: string
          source_collection_key: string | null
          started_at: string
          status: string
          total_received: number
          updated: number
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          failed?: number
          failure_summary?: Json | null
          id?: string
          persisted?: number
          project_id: string
          reactivated?: number
          removed_at_source?: number
          requested_by_user_id: string
          skipped?: number
          source?: string
          source_collection_key?: string | null
          started_at?: string
          status?: string
          total_received?: number
          updated?: number
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          failed?: number
          failure_summary?: Json | null
          id?: string
          persisted?: number
          project_id?: string
          reactivated?: number
          removed_at_source?: number
          requested_by_user_id?: string
          skipped?: number
          source?: string
          source_collection_key?: string | null
          started_at?: string
          status?: string
          total_received?: number
          updated?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "article_sync_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      article_text_blocks: {
        Row: {
          article_file_id: string
          bbox: Json
          block_index: number
          block_type: string
          char_end: number
          char_start: number
          created_at: string
          id: string
          page_number: number
          text: string
          updated_at: string
        }
        Insert: {
          article_file_id: string
          bbox: Json
          block_index: number
          block_type: string
          char_end: number
          char_start: number
          created_at?: string
          id?: string
          page_number: number
          text: string
          updated_at?: string
        }
        Update: {
          article_file_id?: string
          bbox?: Json
          block_index?: number
          block_type?: string
          char_end?: number
          char_start?: number
          created_at?: string
          id?: string
          page_number?: number
          text?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "article_text_blocks_article_file_id_fkey"
            columns: ["article_file_id"]
            isOneToOne: false
            referencedRelation: "article_files"
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
          last_synced_at: string | null
          license: string | null
          mesh_terms: string[] | null
          open_access: boolean | null
          pages: string | null
          pdf_extracted_text: string | null
          pii: string | null
          pmcid: string | null
          pmid: string | null
          project_id: string
          publication_day: number | null
          publication_month: number | null
          publication_status: string | null
          publication_year: number | null
          registration: Json | null
          removed_at_source_at: string | null
          row_version: number
          semantic_abstract_text: string | null
          semantic_fulltext_text: string | null
          source_lineage: string | null
          source_payload: Json | null
          study_design: string | null
          sync_conflict_log: Json | null
          sync_state: string
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
          last_synced_at?: string | null
          license?: string | null
          mesh_terms?: string[] | null
          open_access?: boolean | null
          pages?: string | null
          pdf_extracted_text?: string | null
          pii?: string | null
          pmcid?: string | null
          pmid?: string | null
          project_id: string
          publication_day?: number | null
          publication_month?: number | null
          publication_status?: string | null
          publication_year?: number | null
          registration?: Json | null
          removed_at_source_at?: string | null
          row_version?: number
          semantic_abstract_text?: string | null
          semantic_fulltext_text?: string | null
          source_lineage?: string | null
          source_payload?: Json | null
          study_design?: string | null
          sync_conflict_log?: Json | null
          sync_state?: string
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
          last_synced_at?: string | null
          license?: string | null
          mesh_terms?: string[] | null
          open_access?: boolean | null
          pages?: string | null
          pdf_extracted_text?: string | null
          pii?: string | null
          pmcid?: string | null
          pmid?: string | null
          project_id?: string
          publication_day?: number | null
          publication_month?: number | null
          publication_status?: string | null
          publication_year?: number | null
          registration?: Json | null
          removed_at_source_at?: string | null
          row_version?: number
          semantic_abstract_text?: string | null
          semantic_fulltext_text?: string | null
          source_lineage?: string | null
          source_payload?: Json | null
          study_design?: string | null
          sync_conflict_log?: Json | null
          sync_state?: string
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
      extraction_consensus_decisions: {
        Row: {
          consensus_user_id: string
          created_at: string
          field_id: string
          id: string
          instance_id: string
          mode: Database["public"]["Enums"]["extraction_consensus_mode"]
          rationale: string | null
          run_id: string
          selected_decision_id: string | null
          updated_at: string
          value: Json | null
        }
        Insert: {
          consensus_user_id: string
          created_at?: string
          field_id: string
          id?: string
          instance_id: string
          mode: Database["public"]["Enums"]["extraction_consensus_mode"]
          rationale?: string | null
          run_id: string
          selected_decision_id?: string | null
          updated_at?: string
          value?: Json | null
        }
        Update: {
          consensus_user_id?: string
          created_at?: string
          field_id?: string
          id?: string
          instance_id?: string
          mode?: Database["public"]["Enums"]["extraction_consensus_mode"]
          rationale?: string | null
          run_id?: string
          selected_decision_id?: string | null
          updated_at?: string
          value?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "extraction_consensus_decisions_consensus_user_id_fkey"
            columns: ["consensus_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_consensus_decisions_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "extraction_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_consensus_decisions_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "extraction_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_consensus_decisions_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "extraction_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_extraction_consensus_decisions_selected_run_match"
            columns: ["run_id", "selected_decision_id"]
            isOneToOne: false
            referencedRelation: "extraction_reviewer_decisions"
            referencedColumns: ["run_id", "id"]
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
          role: Database["public"]["Enums"]["extraction_entity_role"]
          sort_order: number
          template_id: string | null
          updated_at: string
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
          role: Database["public"]["Enums"]["extraction_entity_role"]
          sort_order?: number
          template_id?: string | null
          updated_at?: string
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
          role?: Database["public"]["Enums"]["extraction_entity_role"]
          sort_order?: number
          template_id?: string | null
          updated_at?: string
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
          consensus_decision_id: string | null
          created_at: string
          created_by: string
          id: string
          page_number: number | null
          position: Json | null
          project_id: string
          proposal_record_id: string | null
          reviewer_decision_id: string | null
          run_id: string | null
          text_content: string | null
          updated_at: string
        }
        Insert: {
          article_file_id?: string | null
          article_id: string
          consensus_decision_id?: string | null
          created_at?: string
          created_by: string
          id?: string
          page_number?: number | null
          position?: Json | null
          project_id: string
          proposal_record_id?: string | null
          reviewer_decision_id?: string | null
          run_id?: string | null
          text_content?: string | null
          updated_at?: string
        }
        Update: {
          article_file_id?: string | null
          article_id?: string
          consensus_decision_id?: string | null
          created_at?: string
          created_by?: string
          id?: string
          page_number?: number | null
          position?: Json | null
          project_id?: string
          proposal_record_id?: string | null
          reviewer_decision_id?: string | null
          run_id?: string | null
          text_content?: string | null
          updated_at?: string
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
            foreignKeyName: "extraction_evidence_consensus_decision_id_fkey"
            columns: ["consensus_decision_id"]
            isOneToOne: false
            referencedRelation: "extraction_consensus_decisions"
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
          {
            foreignKeyName: "extraction_evidence_proposal_record_id_fkey"
            columns: ["proposal_record_id"]
            isOneToOne: false
            referencedRelation: "extraction_proposal_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_evidence_reviewer_decision_id_fkey"
            columns: ["reviewer_decision_id"]
            isOneToOne: false
            referencedRelation: "extraction_reviewer_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_evidence_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "extraction_runs"
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
          other_label: string | null
          other_placeholder: string | null
          sort_order: number
          unit: string | null
          updated_at: string
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
          other_label?: string | null
          other_placeholder?: string | null
          sort_order?: number
          unit?: string | null
          updated_at?: string
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
          other_label?: string | null
          other_placeholder?: string | null
          sort_order?: number
          unit?: string | null
          updated_at?: string
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
      extraction_hitl_configs: {
        Row: {
          arbitrator_id: string | null
          consensus_rule: Database["public"]["Enums"]["consensus_rule"]
          created_at: string
          id: string
          reviewer_count: number
          scope_id: string
          scope_kind: Database["public"]["Enums"]["hitl_config_scope_kind"]
          updated_at: string
        }
        Insert: {
          arbitrator_id?: string | null
          consensus_rule: Database["public"]["Enums"]["consensus_rule"]
          created_at?: string
          id?: string
          reviewer_count: number
          scope_id: string
          scope_kind: Database["public"]["Enums"]["hitl_config_scope_kind"]
          updated_at?: string
        }
        Update: {
          arbitrator_id?: string | null
          consensus_rule?: Database["public"]["Enums"]["consensus_rule"]
          created_at?: string
          id?: string
          reviewer_count?: number
          scope_id?: string
          scope_kind?: Database["public"]["Enums"]["hitl_config_scope_kind"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "extraction_hitl_configs_arbitrator_id_fkey"
            columns: ["arbitrator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
          status: Database["public"]["Enums"]["extraction_instance_status"]
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
          status?: Database["public"]["Enums"]["extraction_instance_status"]
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
          status?: Database["public"]["Enums"]["extraction_instance_status"]
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
      extraction_proposal_records: {
        Row: {
          confidence_score: number | null
          created_at: string
          field_id: string
          id: string
          instance_id: string
          proposed_value: Json
          rationale: string | null
          run_id: string
          source: Database["public"]["Enums"]["extraction_proposal_source"]
          source_user_id: string | null
          updated_at: string
        }
        Insert: {
          confidence_score?: number | null
          created_at?: string
          field_id: string
          id?: string
          instance_id: string
          proposed_value: Json
          rationale?: string | null
          run_id: string
          source: Database["public"]["Enums"]["extraction_proposal_source"]
          source_user_id?: string | null
          updated_at?: string
        }
        Update: {
          confidence_score?: number | null
          created_at?: string
          field_id?: string
          id?: string
          instance_id?: string
          proposed_value?: Json
          rationale?: string | null
          run_id?: string
          source?: Database["public"]["Enums"]["extraction_proposal_source"]
          source_user_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "extraction_proposal_records_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "extraction_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_proposal_records_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "extraction_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_proposal_records_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "extraction_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_proposal_records_source_user_id_fkey"
            columns: ["source_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      extraction_published_states: {
        Row: {
          created_at: string
          field_id: string
          id: string
          instance_id: string
          published_at: string
          published_by: string
          run_id: string
          updated_at: string
          value: Json
          version: number
        }
        Insert: {
          created_at?: string
          field_id: string
          id?: string
          instance_id: string
          published_at?: string
          published_by: string
          run_id: string
          updated_at?: string
          value: Json
          version?: number
        }
        Update: {
          created_at?: string
          field_id?: string
          id?: string
          instance_id?: string
          published_at?: string
          published_by?: string
          run_id?: string
          updated_at?: string
          value?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "extraction_published_states_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "extraction_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_published_states_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "extraction_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_published_states_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_published_states_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "extraction_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      extraction_reviewer_decisions: {
        Row: {
          created_at: string
          decision: Database["public"]["Enums"]["extraction_reviewer_decision"]
          field_id: string
          id: string
          instance_id: string
          proposal_record_id: string | null
          rationale: string | null
          reviewer_id: string
          run_id: string
          updated_at: string
          value: Json | null
        }
        Insert: {
          created_at?: string
          decision: Database["public"]["Enums"]["extraction_reviewer_decision"]
          field_id: string
          id?: string
          instance_id: string
          proposal_record_id?: string | null
          rationale?: string | null
          reviewer_id: string
          run_id: string
          updated_at?: string
          value?: Json | null
        }
        Update: {
          created_at?: string
          decision?: Database["public"]["Enums"]["extraction_reviewer_decision"]
          field_id?: string
          id?: string
          instance_id?: string
          proposal_record_id?: string | null
          rationale?: string | null
          reviewer_id?: string
          run_id?: string
          updated_at?: string
          value?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "extraction_reviewer_decisions_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "extraction_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_reviewer_decisions_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "extraction_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_reviewer_decisions_proposal_record_id_fkey"
            columns: ["proposal_record_id"]
            isOneToOne: false
            referencedRelation: "extraction_proposal_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_reviewer_decisions_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_reviewer_decisions_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "extraction_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      extraction_reviewer_states: {
        Row: {
          created_at: string
          current_decision_id: string
          field_id: string
          id: string
          instance_id: string
          last_updated: string
          reviewer_id: string
          run_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_decision_id: string
          field_id: string
          id?: string
          instance_id: string
          last_updated?: string
          reviewer_id: string
          run_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_decision_id?: string
          field_id?: string
          id?: string
          instance_id?: string
          last_updated?: string
          reviewer_id?: string
          run_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "extraction_reviewer_states_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "extraction_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_reviewer_states_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "extraction_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_reviewer_states_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_reviewer_states_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "extraction_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_extraction_reviewer_states_decision_run_match"
            columns: ["run_id", "current_decision_id"]
            isOneToOne: false
            referencedRelation: "extraction_reviewer_decisions"
            referencedColumns: ["run_id", "id"]
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
          hitl_config_snapshot: Json
          id: string
          kind: Database["public"]["Enums"]["template_kind"]
          parameters: Json
          project_id: string
          results: Json
          stage: Database["public"]["Enums"]["extraction_run_stage"]
          started_at: string | null
          status: Database["public"]["Enums"]["extraction_run_status"]
          template_id: string
          version_id: string
        }
        Insert: {
          article_id: string
          completed_at?: string | null
          created_at?: string
          created_by: string
          error_message?: string | null
          hitl_config_snapshot?: Json
          id?: string
          kind?: Database["public"]["Enums"]["template_kind"]
          parameters?: Json
          project_id: string
          results?: Json
          stage?: Database["public"]["Enums"]["extraction_run_stage"]
          started_at?: string | null
          status?: Database["public"]["Enums"]["extraction_run_status"]
          template_id: string
          version_id: string
        }
        Update: {
          article_id?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string
          error_message?: string | null
          hitl_config_snapshot?: Json
          id?: string
          kind?: Database["public"]["Enums"]["template_kind"]
          parameters?: Json
          project_id?: string
          results?: Json
          stage?: Database["public"]["Enums"]["extraction_run_stage"]
          started_at?: string | null
          status?: Database["public"]["Enums"]["extraction_run_status"]
          template_id?: string
          version_id?: string
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
          {
            foreignKeyName: "fk_extraction_runs_template_kind_coherence"
            columns: ["template_id", "kind"]
            isOneToOne: false
            referencedRelation: "project_extraction_templates"
            referencedColumns: ["id", "kind"]
          },
          {
            foreignKeyName: "fk_extraction_runs_version_id"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "extraction_template_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      extraction_template_versions: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          project_template_id: string
          published_at: string
          published_by: string
          schema: Json
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          project_template_id: string
          published_at?: string
          published_by: string
          schema: Json
          updated_at?: string
          version: number
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          project_template_id?: string
          published_at?: string
          published_by?: string
          schema?: Json
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "extraction_template_versions_project_template_id_fkey"
            columns: ["project_template_id"]
            isOneToOne: false
            referencedRelation: "project_extraction_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_template_versions_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
          kind: Database["public"]["Enums"]["template_kind"]
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
          kind?: Database["public"]["Enums"]["template_kind"]
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
          kind?: Database["public"]["Enums"]["template_kind"]
          name?: string
          schema?: Json
          updated_at?: string
          version?: string
        }
        Relationships: []
      }
      feedback_reports: {
        Row: {
          category: string
          created_at: string
          id: string
          message: string
          metadata: Json
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          category: string
          created_at?: string
          id?: string
          message: string
          metadata?: Json
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          message?: string
          metadata?: Json
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
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
          kind: Database["public"]["Enums"]["template_kind"]
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
          kind?: Database["public"]["Enums"]["template_kind"]
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
          kind?: Database["public"]["Enums"]["template_kind"]
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
          review_type?: Database["public"]["Enums"]["review_type"] | null
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
          review_type?: Database["public"]["Enums"]["review_type"] | null
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
      user_api_keys: {
        Row: {
          created_at: string
          encrypted_api_key: string
          id: string
          is_active: boolean
          is_default: boolean
          key_name: string | null
          last_used_at: string | null
          last_validated_at: string | null
          metadata: Json | null
          provider: string
          updated_at: string
          user_id: string
          validation_status: string | null
        }
        Insert: {
          created_at?: string
          encrypted_api_key: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          key_name?: string | null
          last_used_at?: string | null
          last_validated_at?: string | null
          metadata?: Json | null
          provider: string
          updated_at?: string
          user_id: string
          validation_status?: string | null
        }
        Update: {
          created_at?: string
          encrypted_api_key?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          key_name?: string | null
          last_used_at?: string | null
          last_validated_at?: string | null
          metadata?: Json | null
          provider?: string
          updated_at?: string
          user_id?: string
          validation_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_api_keys_user_id_fkey"
            columns: ["user_id"]
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
      calculate_model_progress: {
        Args: { p_article_id: string; p_model_id: string }
        Returns: {
          completed_fields: number
          percentage: number
          total_fields: number
        }[]
      }
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
          p_created_by?: string
          p_description?: string
          p_name: string
          p_review_type?: Database["public"]["Enums"]["review_type"]
        }
        Returns: string
      }
      find_user_id_by_email: {
        Args: { p_email: string; p_project_id: string }
        Returns: string
      }
      get_project_members: {
        Args: { p_project_id: string }
        Returns: {
          created_at: string
          id: string
          permissions: Json
          role: Database["public"]["Enums"]["project_member_role"]
          user_avatar_url: string
          user_email: string
          user_full_name: string
          user_id: string
        }[]
      }
      is_project_manager: {
        Args: { p_project_id: string; p_user_id: string }
        Returns: boolean
      }
      is_project_member: {
        Args: { p_project_id: string; p_user_id: string }
        Returns: boolean
      }
      is_project_reviewer: {
        Args: { p_project_id: string; p_user_id: string }
        Returns: boolean
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      consensus_rule: "unanimous" | "majority" | "arbitrator"
      extraction_cardinality: "one" | "many"
      extraction_consensus_mode: "select_existing" | "manual_override"
      extraction_entity_role:
        | "study_section"
        | "model_container"
        | "model_section"
      extraction_field_type:
        | "text"
        | "number"
        | "date"
        | "select"
        | "multiselect"
        | "boolean"
      extraction_framework: "CHARMS" | "PICOS" | "CUSTOM"
      extraction_instance_status:
        | "pending"
        | "in_progress"
        | "completed"
        | "reviewed"
        | "archived"
      extraction_proposal_source: "ai" | "human" | "system"
      extraction_reviewer_decision: "accept_proposal" | "reject" | "edit"
      extraction_run_stage:
        | "pending"
        | "proposal"
        | "review"
        | "consensus"
        | "finalized"
        | "cancelled"
      extraction_run_status: "pending" | "running" | "completed" | "failed"
      file_role:
        | "MAIN"
        | "SUPPLEMENT"
        | "PROTOCOL"
        | "DATASET"
        | "APPENDIX"
        | "FIGURE"
        | "OTHER"
      hitl_config_scope_kind: "project" | "template"
      project_member_role: "manager" | "reviewer" | "viewer" | "consensus"
      review_type:
        | "interventional"
        | "predictive_model"
        | "diagnostic"
        | "prognostic"
        | "qualitative"
        | "other"
      template_kind: "extraction" | "quality_assessment"
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
      consensus_rule: ["unanimous", "majority", "arbitrator"],
      extraction_cardinality: ["one", "many"],
      extraction_consensus_mode: ["select_existing", "manual_override"],
      extraction_entity_role: [
        "study_section",
        "model_container",
        "model_section",
      ],
      extraction_field_type: [
        "text",
        "number",
        "date",
        "select",
        "multiselect",
        "boolean",
      ],
      extraction_framework: ["CHARMS", "PICOS", "CUSTOM"],
      extraction_instance_status: [
        "pending",
        "in_progress",
        "completed",
        "reviewed",
        "archived",
      ],
      extraction_proposal_source: ["ai", "human", "system"],
      extraction_reviewer_decision: ["accept_proposal", "reject", "edit"],
      extraction_run_stage: [
        "pending",
        "proposal",
        "review",
        "consensus",
        "finalized",
        "cancelled",
      ],
      extraction_run_status: ["pending", "running", "completed", "failed"],
      file_role: [
        "MAIN",
        "SUPPLEMENT",
        "PROTOCOL",
        "DATASET",
        "APPENDIX",
        "FIGURE",
        "OTHER",
      ],
      hitl_config_scope_kind: ["project", "template"],
      project_member_role: ["manager", "reviewer", "viewer", "consensus"],
      review_type: [
        "interventional",
        "predictive_model",
        "diagnostic",
        "prognostic",
        "qualitative",
        "other",
      ],
      template_kind: ["extraction", "quality_assessment"],
    },
  },
} as const

