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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      agent_steps: {
        Row: {
          agent: Database["public"]["Enums"]["agent_name"]
          cost_usd: number | null
          id: string
          input_summary: string | null
          latency_ms: number | null
          model: string
          output_summary: string | null
          raw_input: Json | null
          raw_output: Json | null
          role: string | null
          started_at: string | null
          step_index: number
          tokens_cached: number
          tokens_in: number
          tokens_out: number
          trace_id: string
        }
        Insert: {
          agent: Database["public"]["Enums"]["agent_name"]
          cost_usd?: number | null
          id?: string
          input_summary?: string | null
          latency_ms?: number | null
          model: string
          output_summary?: string | null
          raw_input?: Json | null
          raw_output?: Json | null
          role?: string | null
          started_at?: string | null
          step_index: number
          tokens_cached?: number
          tokens_in?: number
          tokens_out?: number
          trace_id: string
        }
        Update: {
          agent?: Database["public"]["Enums"]["agent_name"]
          cost_usd?: number | null
          id?: string
          input_summary?: string | null
          latency_ms?: number | null
          model?: string
          output_summary?: string | null
          raw_input?: Json | null
          raw_output?: Json | null
          role?: string | null
          started_at?: string | null
          step_index?: number
          tokens_cached?: number
          tokens_in?: number
          tokens_out?: number
          trace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_steps_trace_id_fkey"
            columns: ["trace_id"]
            isOneToOne: false
            referencedRelation: "turn_traces"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_records: {
        Row: {
          clock_in: string | null
          clock_out: string | null
          employee_id: string
          flag_reason: string | null
          id: string
          is_flagged: boolean
          regularized: boolean
          status: Database["public"]["Enums"]["attendance_status"]
          work_date: string
        }
        Insert: {
          clock_in?: string | null
          clock_out?: string | null
          employee_id: string
          flag_reason?: string | null
          id?: string
          is_flagged?: boolean
          regularized?: boolean
          status?: Database["public"]["Enums"]["attendance_status"]
          work_date: string
        }
        Update: {
          clock_in?: string | null
          clock_out?: string | null
          employee_id?: string
          flag_reason?: string | null
          id?: string
          is_flagged?: boolean
          regularized?: boolean
          status?: Database["public"]["Enums"]["attendance_status"]
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_records_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_regularizations: {
        Row: {
          corrected_in: string | null
          corrected_out: string | null
          created_at: string
          employee_id: string
          id: string
          idempotency_key: string | null
          reason: string
          status: Database["public"]["Enums"]["request_status"]
          work_date: string
        }
        Insert: {
          corrected_in?: string | null
          corrected_out?: string | null
          created_at?: string
          employee_id: string
          id?: string
          idempotency_key?: string | null
          reason: string
          status?: Database["public"]["Enums"]["request_status"]
          work_date: string
        }
        Update: {
          corrected_in?: string | null
          corrected_out?: string | null
          created_at?: string
          employee_id?: string
          id?: string
          idempotency_key?: string | null
          reason?: string
          status?: Database["public"]["Enums"]["request_status"]
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_regularizations_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          employee_id: string
          id: string
          last_active_at: string
          outcome: Database["public"]["Enums"]["conv_outcome"]
          started_at: string
          title: string | null
          total_cost_usd: number
          total_tokens: number
          turn_count: number
        }
        Insert: {
          employee_id: string
          id?: string
          last_active_at?: string
          outcome?: Database["public"]["Enums"]["conv_outcome"]
          started_at?: string
          title?: string | null
          total_cost_usd?: number
          total_tokens?: number
          turn_count?: number
        }
        Update: {
          employee_id?: string
          id?: string
          last_active_at?: string
          outcome?: Database["public"]["Enums"]["conv_outcome"]
          started_at?: string
          title?: string | null
          total_cost_usd?: number
          total_tokens?: number
          turn_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "conversations_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          auth_user_id: string | null
          created_at: string
          date_of_joining: string
          employee_code: string
          employment_type: Database["public"]["Enums"]["employment_type"]
          full_name: string
          gender: string | null
          geo: string
          grade_band: string | null
          id: string
          is_hr_ops: boolean
          manager_name: string | null
          work_location: string | null
        }
        Insert: {
          auth_user_id?: string | null
          created_at?: string
          date_of_joining: string
          employee_code: string
          employment_type?: Database["public"]["Enums"]["employment_type"]
          full_name: string
          gender?: string | null
          geo?: string
          grade_band?: string | null
          id?: string
          is_hr_ops?: boolean
          manager_name?: string | null
          work_location?: string | null
        }
        Update: {
          auth_user_id?: string | null
          created_at?: string
          date_of_joining?: string
          employee_code?: string
          employment_type?: Database["public"]["Enums"]["employment_type"]
          full_name?: string
          gender?: string | null
          geo?: string
          grade_band?: string | null
          id?: string
          is_hr_ops?: boolean
          manager_name?: string | null
          work_location?: string | null
        }
        Relationships: []
      }
      engine_messages: {
        Row: {
          actor: string | null
          chips: Json
          citations: Json
          content: string
          created_at: string
          id: string
          receipt: Json | null
          role: string
          session_id: string
          turn_index: number
          verdict: string | null
        }
        Insert: {
          actor?: string | null
          chips?: Json
          citations?: Json
          content: string
          created_at?: string
          id?: string
          receipt?: Json | null
          role: string
          session_id: string
          turn_index: number
          verdict?: string | null
        }
        Update: {
          actor?: string | null
          chips?: Json
          citations?: Json
          content?: string
          created_at?: string
          id?: string
          receipt?: Json | null
          role?: string
          session_id?: string
          turn_index?: number
          verdict?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "engine_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "engine_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      engine_sessions: {
        Row: {
          baseline_mode: boolean
          created_at: string
          employee_id: string
          id: string
          last_active_at: string
          pending_action: Json | null
          total_cost_usd: number
          turn_count: number
        }
        Insert: {
          baseline_mode?: boolean
          created_at?: string
          employee_id: string
          id?: string
          last_active_at?: string
          pending_action?: Json | null
          total_cost_usd?: number
          turn_count?: number
        }
        Update: {
          baseline_mode?: boolean
          created_at?: string
          employee_id?: string
          id?: string
          last_active_at?: string
          pending_action?: Json | null
          total_cost_usd?: number
          turn_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "engine_sessions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback: {
        Row: {
          conversation_id: string
          created_at: string
          id: string
          note: string | null
          rating: string
          turn_index: number
        }
        Insert: {
          conversation_id: string
          created_at?: string
          id?: string
          note?: string | null
          rating: string
          turn_index: number
        }
        Update: {
          conversation_id?: string
          created_at?: string
          id?: string
          note?: string | null
          rating?: string
          turn_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "feedback_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ops_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_tickets: {
        Row: {
          conversation_id: string | null
          created_at: string
          d_line: string | null
          employee_id: string
          id: string
          offramp_code: string
          question: string
          status: string
          turn_id: string | null
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          d_line?: string | null
          employee_id: string
          id?: string
          offramp_code: string
          question: string
          status?: string
          turn_id?: string | null
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          d_line?: string | null
          employee_id?: string
          id?: string
          offramp_code?: string
          question?: string
          status?: string
          turn_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hr_tickets_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_balances: {
        Row: {
          available: number | null
          cycle_year: number
          employee_id: string
          entitled: number
          id: string
          leave_code: Database["public"]["Enums"]["leave_code"]
          updated_at: string
          used: number
        }
        Insert: {
          available?: number | null
          cycle_year: number
          employee_id: string
          entitled?: number
          id?: string
          leave_code: Database["public"]["Enums"]["leave_code"]
          updated_at?: string
          used?: number
        }
        Update: {
          available?: number | null
          cycle_year?: number
          employee_id?: string
          entitled?: number
          id?: string
          leave_code?: Database["public"]["Enums"]["leave_code"]
          updated_at?: string
          used?: number
        }
        Relationships: [
          {
            foreignKeyName: "leave_balances_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_requests: {
        Row: {
          created_at: string
          employee_id: string
          end_date: string
          half_day: string | null
          id: string
          idempotency_key: string | null
          leave_code: Database["public"]["Enums"]["leave_code"]
          reason: string | null
          start_date: string
          status: Database["public"]["Enums"]["request_status"]
          updated_at: string
          working_days: number
        }
        Insert: {
          created_at?: string
          employee_id: string
          end_date: string
          half_day?: string | null
          id?: string
          idempotency_key?: string | null
          leave_code: Database["public"]["Enums"]["leave_code"]
          reason?: string | null
          start_date: string
          status?: Database["public"]["Enums"]["request_status"]
          updated_at?: string
          working_days: number
        }
        Update: {
          created_at?: string
          employee_id?: string
          end_date?: string
          half_day?: string | null
          id?: string
          idempotency_key?: string | null
          leave_code?: Database["public"]["Enums"]["leave_code"]
          reason?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["request_status"]
          updated_at?: string
          working_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "leave_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          card_type: string | null
          chips: Json | null
          clause_refs: Json | null
          content: string
          conversation_id: string
          created_at: string
          id: string
          pending: Json | null
          role: Database["public"]["Enums"]["message_role"]
          turn_index: number
          verdict: Database["public"]["Enums"]["verdict_type"] | null
        }
        Insert: {
          card_type?: string | null
          chips?: Json | null
          clause_refs?: Json | null
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          pending?: Json | null
          role: Database["public"]["Enums"]["message_role"]
          turn_index: number
          verdict?: Database["public"]["Enums"]["verdict_type"] | null
        }
        Update: {
          card_type?: string | null
          chips?: Json | null
          clause_refs?: Json | null
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          pending?: Json | null
          role?: Database["public"]["Enums"]["message_role"]
          turn_index?: number
          verdict?: Database["public"]["Enums"]["verdict_type"] | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ops_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      payslips: {
        Row: {
          created_at: string
          deductions: Json
          employee_id: string
          gross_amount: number
          id: string
          net_amount: number
          pay_month: string
        }
        Insert: {
          created_at?: string
          deductions?: Json
          employee_id: string
          gross_amount: number
          id?: string
          net_amount: number
          pay_month: string
        }
        Update: {
          created_at?: string
          deductions?: Json
          employee_id?: string
          gross_amount?: number
          id?: string
          net_amount?: number
          pay_month?: string
        }
        Relationships: [
          {
            foreignKeyName: "payslips_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      policy_chunks: {
        Row: {
          clause_id: string
          content: string
          created_at: string
          embedding: string | null
          heading: string
          id: string
          policy_area: Database["public"]["Enums"]["policy_area"]
          policy_version: string
          subject: string
          token_count: number | null
        }
        Insert: {
          clause_id: string
          content: string
          created_at?: string
          embedding?: string | null
          heading: string
          id?: string
          policy_area: Database["public"]["Enums"]["policy_area"]
          policy_version: string
          subject: string
          token_count?: number | null
        }
        Update: {
          clause_id?: string
          content?: string
          created_at?: string
          embedding?: string | null
          heading?: string
          id?: string
          policy_area?: Database["public"]["Enums"]["policy_area"]
          policy_version?: string
          subject?: string
          token_count?: number | null
        }
        Relationships: []
      }
      policy_chunks_small: {
        Row: {
          chunk_id: string
          content: string
          created_at: string
          embedding: string | null
          heading: string
          id: string
          object_tags: string[]
          section: string
          token_count: number | null
        }
        Insert: {
          chunk_id: string
          content: string
          created_at?: string
          embedding?: string | null
          heading: string
          id?: string
          object_tags?: string[]
          section: string
          token_count?: number | null
        }
        Update: {
          chunk_id?: string
          content?: string
          created_at?: string
          embedding?: string | null
          heading?: string
          id?: string
          object_tags?: string[]
          section?: string
          token_count?: number | null
        }
        Relationships: []
      }
      retrieval_logs: {
        Row: {
          chunks: Json
          id: string
          latency_ms: number | null
          max_similarity: number | null
          mode: string | null
          model: string | null
          query_text: string
          status: string
          subjects: string[]
          threshold: number
          trace_id: string
        }
        Insert: {
          chunks: Json
          id?: string
          latency_ms?: number | null
          max_similarity?: number | null
          mode?: string | null
          model?: string | null
          query_text: string
          status: string
          subjects?: string[]
          threshold: number
          trace_id: string
        }
        Update: {
          chunks?: Json
          id?: string
          latency_ms?: number | null
          max_similarity?: number | null
          mode?: string | null
          model?: string | null
          query_text?: string
          status?: string
          subjects?: string[]
          threshold?: number
          trace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "retrieval_logs_trace_id_fkey"
            columns: ["trace_id"]
            isOneToOne: false
            referencedRelation: "turn_traces"
            referencedColumns: ["id"]
          },
        ]
      }
      session_slots: {
        Row: {
          conversation_id: string
          current_intent: string | null
          last_tool_error: string | null
          missing_slots: string[]
          paused_intent: string | null
          paused_slots: Json | null
          pending_confirmation: Json | null
          probe_count: number
          slots: Json
          updated_at: string
        }
        Insert: {
          conversation_id: string
          current_intent?: string | null
          last_tool_error?: string | null
          missing_slots?: string[]
          paused_intent?: string | null
          paused_slots?: Json | null
          pending_confirmation?: Json | null
          probe_count?: number
          slots?: Json
          updated_at?: string
        }
        Update: {
          conversation_id?: string
          current_intent?: string | null
          last_tool_error?: string | null
          missing_slots?: string[]
          paused_intent?: string | null
          paused_slots?: Json | null
          pending_confirmation?: Json | null
          probe_count?: number
          slots?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_slots_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: true
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_slots_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: true
            referencedRelation: "ops_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      tool_calls: {
        Row: {
          attempts: number
          error_code: string | null
          error_message: string | null
          id: string
          latency_ms: number | null
          params: Json
          result: Json | null
          risk: Database["public"]["Enums"]["tool_risk"]
          tool_name: string
          trace_id: string
        }
        Insert: {
          attempts?: number
          error_code?: string | null
          error_message?: string | null
          id?: string
          latency_ms?: number | null
          params: Json
          result?: Json | null
          risk: Database["public"]["Enums"]["tool_risk"]
          tool_name: string
          trace_id: string
        }
        Update: {
          attempts?: number
          error_code?: string | null
          error_message?: string | null
          id?: string
          latency_ms?: number | null
          params?: Json
          result?: Json | null
          risk?: Database["public"]["Enums"]["tool_risk"]
          tool_name?: string
          trace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tool_calls_trace_id_fkey"
            columns: ["trace_id"]
            isOneToOne: false
            referencedRelation: "turn_traces"
            referencedColumns: ["id"]
          },
        ]
      }
      trace_events: {
        Row: {
          action: string
          actor: string
          cost_usd: number
          created_at: string
          id: string
          latency_ms: number
          mode: string | null
          model: string | null
          payload: Json | null
          result: Json | null
          session_id: string
          status: string
          step_index: number
          tokens_in: number
          tokens_out: number
          turn_index: number
        }
        Insert: {
          action: string
          actor: string
          cost_usd?: number
          created_at?: string
          id?: string
          latency_ms?: number
          mode?: string | null
          model?: string | null
          payload?: Json | null
          result?: Json | null
          session_id: string
          status: string
          step_index: number
          tokens_in?: number
          tokens_out?: number
          turn_index: number
        }
        Update: {
          action?: string
          actor?: string
          cost_usd?: number
          created_at?: string
          id?: string
          latency_ms?: number
          mode?: string | null
          model?: string | null
          payload?: Json | null
          result?: Json | null
          session_id?: string
          status?: string
          step_index?: number
          tokens_in?: number
          tokens_out?: number
          turn_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "trace_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "engine_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      turn_traces: {
        Row: {
          agents_called: Database["public"]["Enums"]["agent_name"][]
          confirmation_token: boolean
          conversation_id: string
          cost_baseline_usd: number | null
          cost_optimized_usd: number | null
          created_at: string
          d_line_fired: string | null
          id: string
          intent: string | null
          path: string | null
          total_latency_ms: number | null
          total_tokens: number | null
          turn_index: number
          user_input: string
          verdict: Database["public"]["Enums"]["verdict_type"] | null
        }
        Insert: {
          agents_called?: Database["public"]["Enums"]["agent_name"][]
          confirmation_token?: boolean
          conversation_id: string
          cost_baseline_usd?: number | null
          cost_optimized_usd?: number | null
          created_at?: string
          d_line_fired?: string | null
          id?: string
          intent?: string | null
          path?: string | null
          total_latency_ms?: number | null
          total_tokens?: number | null
          turn_index: number
          user_input: string
          verdict?: Database["public"]["Enums"]["verdict_type"] | null
        }
        Update: {
          agents_called?: Database["public"]["Enums"]["agent_name"][]
          confirmation_token?: boolean
          conversation_id?: string
          cost_baseline_usd?: number | null
          cost_optimized_usd?: number | null
          created_at?: string
          d_line_fired?: string | null
          id?: string
          intent?: string | null
          path?: string | null
          total_latency_ms?: number | null
          total_tokens?: number | null
          turn_index?: number
          user_input?: string
          verdict?: Database["public"]["Enums"]["verdict_type"] | null
        }
        Relationships: [
          {
            foreignKeyName: "turn_traces_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "turn_traces_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ops_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      wfh_requests: {
        Row: {
          created_at: string
          employee_id: string
          end_date: string
          id: string
          idempotency_key: string | null
          reason: string | null
          start_date: string
          status: Database["public"]["Enums"]["request_status"]
        }
        Insert: {
          created_at?: string
          employee_id: string
          end_date: string
          id?: string
          idempotency_key?: string | null
          reason?: string | null
          start_date: string
          status?: Database["public"]["Enums"]["request_status"]
        }
        Update: {
          created_at?: string
          employee_id?: string
          end_date?: string
          id?: string
          idempotency_key?: string | null
          reason?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["request_status"]
        }
        Relationships: [
          {
            foreignKeyName: "wfh_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      ops_conversations: {
        Row: {
          employee_code: string | null
          full_name: string | null
          id: string | null
          last_active_at: string | null
          outcome: Database["public"]["Enums"]["conv_outcome"] | null
          started_at: string | null
          title: string | null
          total_cost_usd: number | null
          total_tokens: number | null
          turn_count: number | null
        }
        Relationships: []
      }
      ops_cost_summary: {
        Row: {
          baseline_usd: number | null
          day: string | null
          optimized_usd: number | null
          pct_saved: number | null
          turns: number | null
        }
        Relationships: []
      }
      ops_coverage_gaps: {
        Row: {
          ask_count: number | null
          best_similarity: number | null
          last_asked: string | null
          query_text: string | null
        }
        Relationships: []
      }
      ops_grounding: {
        Row: {
          abstentions: number | null
          avg_similarity: number | null
          citation_count: number | null
          top_clause: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      current_employee_id: { Args: never; Returns: string }
      is_hr_ops: { Args: never; Returns: boolean }
      match_policy_chunks: {
        Args: {
          filter_subjects?: string[]
          match_count?: number
          match_threshold?: number
          query_embedding: string
          version?: string
        }
        Returns: {
          clause_id: string
          content: string
          heading: string
          similarity: number
          subject: string
        }[]
      }
      match_policy_small: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          chunk_id: string
          content: string
          heading: string
          object_tags: string[]
          section: string
          similarity: number
        }[]
      }
      tenure_months: { Args: { emp: string }; Returns: number }
    }
    Enums: {
      agent_name: "agent_1" | "agent_2" | "agent_3"
      attendance_status:
        | "PRESENT"
        | "ABSENT"
        | "FLAGGED"
        | "WFH"
        | "LEAVE"
        | "HALF_DAY"
      conv_outcome: "ACTIVE" | "RESOLVED" | "ESCALATED" | "ABANDONED"
      employment_type: "full_time" | "contract" | "intern"
      leave_code: "CL" | "SL" | "EL" | "ML" | "PL" | "BL" | "UL"
      message_role: "user" | "assistant"
      policy_area: "LEAVE" | "ATTENDANCE" | "WFH"
      request_status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED"
      tool_risk: "LOW" | "MEDIUM" | "HIGH"
      verdict_type: "FULL" | "PARTIAL" | "NONE" | "UNKNOWN"
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
      agent_name: ["agent_1", "agent_2", "agent_3"],
      attendance_status: [
        "PRESENT",
        "ABSENT",
        "FLAGGED",
        "WFH",
        "LEAVE",
        "HALF_DAY",
      ],
      conv_outcome: ["ACTIVE", "RESOLVED", "ESCALATED", "ABANDONED"],
      employment_type: ["full_time", "contract", "intern"],
      leave_code: ["CL", "SL", "EL", "ML", "PL", "BL", "UL"],
      message_role: ["user", "assistant"],
      policy_area: ["LEAVE", "ATTENDANCE", "WFH"],
      request_status: ["PENDING", "APPROVED", "REJECTED", "CANCELLED"],
      tool_risk: ["LOW", "MEDIUM", "HIGH"],
      verdict_type: ["FULL", "PARTIAL", "NONE", "UNKNOWN"],
    },
  },
} as const
