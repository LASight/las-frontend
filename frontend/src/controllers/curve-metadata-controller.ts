/** Operator-declared metadata suggestions, never model/OCR identification.
 * Codes are written only by explicit selection; arbitrary source aliases and
 * units remain valid under the existing calibration validator. */
export interface MetadataChoice { value: string; label: string }
export interface CurveMetadataChoice extends MetadataChoice { units: MetadataChoice[] }
const unit = (value: string, label: string): MetadataChoice => ({ value, label });
const resistivity = [unit("OHMM", "Ohm metre"), unit("OHM.M", "Ohm metre (alternate notation)")];
export const CURVE_METADATA: CurveMetadataChoice[] = [
  { value: "GR", label: "Gamma ray", units: [unit("GAPI", "Gamma API units"), unit("API", "API units")] },
  { value: "RHOB", label: "Bulk density", units: [unit("G/C3", "Grams per cubic centimetre"), unit("G/CC", "Grams per cc"), unit("KG/M3", "Kilograms per cubic metre")] },
  { value: "NPHI", label: "Neutron porosity", units: [unit("V/V", "Volume fraction"), unit("PU", "Porosity units"), unit("%", "Percent")] },
  { value: "DT", label: "Sonic transit time", units: [unit("US/FT", "Microseconds per foot"), unit("US/M", "Microseconds per metre")] },
  { value: "CALI", label: "Caliper", units: [unit("IN", "Inches"), unit("MM", "Millimetres")] },
  { value: "SP", label: "Spontaneous potential", units: [unit("MV", "Millivolts")] },
  { value: "RESD", label: "Deep resistivity", units: resistivity },
  { value: "RESS", label: "Shallow resistivity", units: resistivity },
  { value: "ILD", label: "Deep induction resistivity", units: resistivity },
  { value: "ILM", label: "Medium induction resistivity", units: resistivity },
  { value: "LLD", label: "Deep laterolog resistivity", units: resistivity },
  { value: "LLS", label: "Shallow laterolog resistivity", units: resistivity },
  { value: "MSFL", label: "Micro-spherically focused resistivity", units: resistivity },
];

export function curveMetadata(mnemonic: string): CurveMetadataChoice | undefined {
  // Case-insensitive lookup is for recommendations only. Never rewrite input.
  return CURVE_METADATA.find((choice) => choice.value.toLowerCase() === mnemonic.toLowerCase());
}
export function searchMetadata(choices: MetadataChoice[], query: string): MetadataChoice[] {
  const text = query.trim().toLowerCase();
  return choices.filter((choice) => `${choice.value} ${choice.label}`.toLowerCase().includes(text));
}
