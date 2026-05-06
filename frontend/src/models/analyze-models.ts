export type IdxStatus = "pending" | "accepted" | "rejected";

export interface PortfolioSummary {
  well_count: number;
  avg_qc_score: number | null;
  total_depth_points: number;
  wells_with_pay: number;
  avg_anomaly_pct: number | null;
}

export interface SimilarityPair {
  well_a: string;
  well_b: string;
  similarity: number;
}

export interface FaciesSimilarity {
  labels: string[];
  matrix: number[][];
  top_pairs: SimilarityPair[];
  method?: string;
  value_interpretation?: string;
}

export interface PayRiskPoint {
  well_name: string;
  qc_score?: number | null;
  anomaly_pct?: number | null;
  net_reservoir_fraction?: number | null;
  pay_index?: number | null;
  risk_index?: number | null;
  quadrant?: string;
}

export interface GeophysicsPoint {
  well_name: string;
  pay_index?: number | null;
  risk_index?: number | null;
  avg_velocity_ft_s?: number | null;
  reflectivity_energy?: number | null;
}

export interface SomQualityPoint {
  well_name: string;
  quantization_error?: number | null;
  topological_error?: number | null;
}

export interface RankingRow {
  rank: number;
  well_name: string;
  api?: string;
  composite_score: number;
  pay_index: number;
  risk_index: number;
  quadrant: string;
  qc_score?: number | null;
  anomaly_pct?: number | null;
  avg_velocity_ft_s: number | null;
  reflectivity_energy: number | null;
}

export interface SequenceBoundary {
  id: string;
  depth: number;
  confidence: number;
  from_tract: string;
  to_tract: string;
}

export interface SequenceInterval {
  id: string;
  top: number;
  base: number;
  thickness: number;
  tract: string;
  confidence: number;
}

export interface SequenceTracks {
  depth: number[];
  signal: number[];
  signal_smooth: number[];
  trend: number[];
  tract_idx: number[];
  tract: string[];
  confidence: number[];
}

export interface SequenceSummary {
  n_boundaries_auto: number;
  n_intervals_auto: number;
  mean_boundary_confidence: number | null;
  dominant_tract: string;
}

export interface SequenceData {
  status: string;
  reason?: string;
  source_curve?: string;
  source_curve_actual?: string;
  summary?: SequenceSummary;
  boundaries_auto: SequenceBoundary[];
  intervals_auto: SequenceInterval[];
  tracks: Partial<SequenceTracks>;
}

export interface WellReport {
  well_name: string;
  file_name: string;
  api: string;
  company?: string;
  n_rows: number;
  las_version: string;
  curve_map?: Record<string, string>;
  curve_units?: Record<string, string>;
  qc?: {
    data_score?: number | null;
    status?: string;
    checks?: Array<{ severity: string; message: string }>;
  };
  petrophysics?: {
    summary?: {
      avg_vsh?: number | null;
      avg_phi?: number | null;
      avg_sw?: number | null;
      net_reservoir_points?: number | null;
    };
  };
  ml?: {
    status?: string;
    anomalies?: { pct?: number | null };
    electrofacies?: { n_clusters?: number | null };
    som?: {
      status?: string;
      grid?: { rows?: number; cols?: number };
      training?: {
        quantization_error?: number | null;
        topological_error?: number | null;
      };
      u_matrix?: number[][];
      node_hits?: number[][];
    };
  };
  geophysics?: {
    avg_velocity_ft_s?: number | null;
    avg_density_g_cc?: number | null;
    avg_ai_proxy?: number | null;
    reflectivity_energy?: number | null;
    high_reflectivity_fraction?: number | null;
    density_method?: string | null;
    assumption?: string | null;
  };
  tracks: {
    depth?: Array<number | null>;
    raw?: Record<string, Array<number | null>>;
    anomaly_flags?: Array<number | null>;
    derived?: Record<string, Array<number | null>>;
    geophysics?: {
      depth?: Array<number | null>;
      velocity_ft_s?: Array<number | null>;
      density_g_cc?: Array<number | null>;
      ai_proxy?: Array<number | null>;
      reflectivity?: Array<number | null>;
    };
    som_bmu?: Array<number | null>;
  };
  sequence_stratigraphy?: SequenceData;
}

export interface SequenceCorrelation {
  status: string;
  method?: string;
  notes?: string;
  surface_names: string[];
  well_names: string[];
  depth_matrix: Array<Array<number | null>>;
  relative_matrix: Array<Array<number | null>>;
}

export interface PortfolioAnalytics {
  well_ranking: RankingRow[];
  facies_similarity: FaciesSimilarity;
  pay_risk_matrix: PayRiskPoint[];
  geophysics_crossplot: GeophysicsPoint[];
  som_quality: SomQualityPoint[];
  sequence_correlation?: SequenceCorrelation;
}

export interface AnalyzePayload {
  analysis_id: string;
  portfolio_summary: PortfolioSummary;
  portfolio_analytics: PortfolioAnalytics;
  wells: WellReport[];
  ai_interpretation: string;
  ai_meta: {
    source?: string;
    model?: string;
    reason?: string;
  };
  density_transform?: {
    method?: string;
    support_points?: number;
  };
  errors: Array<{ file_name?: string; error: string }>;
}

export interface AiResponse {
  analysis_id: string;
  ai_interpretation: string;
  ai_meta: { source?: string; model?: string; reason?: string };
}

export interface ChatResponse {
  analysis_id: string;
  answer: string;
  meta: { source?: string; model?: string; reason?: string };
}

export interface CurveValidation {
  name: string;
  unit: string;
  missing_pct: number;
  is_constant: boolean;
}

export type ValidationIssueSeverity = "error" | "warn" | "info";

export interface FileValidationIssue {
  severity: ValidationIssueSeverity;
  code: string;
  message: string;
}

export interface FileValidationReport {
  file_name: string;
  las_version: string;
  well_name: string;
  depth_range: [number, number] | null;
  depth_unit: string;
  depth_curve: string;
  available_curves: string[];
  null_value: number | null;
  curve_count: number;
  row_count: number;
  curves: CurveValidation[];
  issues: FileValidationIssue[];
  parsing_warnings: string[];
  can_proceed: boolean;
}

export interface PreValidatePayload {
  files: FileValidationReport[];
}

export interface ValidationDecision {
  file_name: string;
  proceed: boolean;
  depth_curve_override?: string;
  null_value_override?: number;
  sort_depth?: boolean;
}
