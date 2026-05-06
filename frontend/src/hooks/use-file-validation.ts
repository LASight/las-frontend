import { useState, useCallback } from "react";
import type { FileValidationReport, PreValidatePayload, ValidationDecision } from "../models/analyze-models";
import { preValidateFiles } from "../services/api-service";

export type ValidationState = "idle" | "validating" | "confirming" | "confirmed" | "cancelled";

interface FileValidationHook {
  state: ValidationState;
  validationPayload: PreValidatePayload | null;
  decisions: ValidationDecision[];
  error: string | null;
  validate: (files: FileList) => Promise<void>;
  confirm: (decisions: ValidationDecision[]) => void;
  cancel: () => void;
  reset: () => void;
}

function buildDefaultDecisions(reports: FileValidationReport[]): ValidationDecision[] {
  return reports.map((r) => ({
    file_name: r.file_name,
    proceed: r.can_proceed,
    depth_curve_override: undefined,
    null_value_override: undefined,
    sort_depth: false,
  }));
}

export function useFileValidation(): FileValidationHook {
  const [state, setState] = useState<ValidationState>("idle");
  const [validationPayload, setValidationPayload] = useState<PreValidatePayload | null>(null);
  const [decisions, setDecisions] = useState<ValidationDecision[]>([]);
  const [error, setError] = useState<string | null>(null);

  const validate = useCallback(async (files: FileList) => {
    setState("validating");
    setError(null);
    try {
      const result = await preValidateFiles(files);
      setValidationPayload(result);
      setDecisions(buildDefaultDecisions(result.files));
      setState("confirming");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Validation failed.");
      setState("idle");
    }
  }, []);

  const confirm = useCallback((finalDecisions: ValidationDecision[]) => {
    setDecisions(finalDecisions);
    setState("confirmed");
  }, []);

  const cancel = useCallback(() => {
    setState("cancelled");
  }, []);

  const reset = useCallback(() => {
    setState("idle");
    setValidationPayload(null);
    setDecisions([]);
    setError(null);
  }, []);

  return { state, validationPayload, decisions, error, validate, confirm, cancel, reset };
}
