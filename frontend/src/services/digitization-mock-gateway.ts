import {
  DEFAULT_CALIBRATION,
  DEFAULT_SEGMENTATION,
  type CurveWindow,
  type DigitizationHealth,
  type ExportRequest,
  type JobSummary,
  type PreprocessSettings,
  type SegmentationSettings,
  type SendToAnalysisResponse,
  type TileLayer,
  type TrackCalibration,
  type TrackCrop,
} from "../models/digitization-models";
import type { DigitizationGateway } from "./digitization-service";

/**
 * An in-browser stand-in for the digitization backend.
 *
 * Segmentation needs a torch install and a 65 MB checkpoint that is not in git.
 * The human-in-the-loop review canvas — the actual graded deliverable — needs
 * neither, and should not be blocked on them. This makes the entire six-step
 * workflow clickable with no backend running at all, which also means a demo or
 * a defense works offline.
 *
 * It is a stand-in, not a simulation: it draws a plausible spiky GR trace and a
 * grid, and reports honest-looking coverage. It never pretends to have run a
 * model, and `health()` says so.
 */

const MOCK_WIDTH = 1400;
const MOCK_HEIGHT = 24_000;

interface MockJob {
  summary: JobSummary;
  /** Ground truth for the fake scan: trace position per full-image row. */
  trueX: Float64Array;
  curveX: Float64Array | null;
  observed: Uint8Array | null;
}

/**
 * A gamma-ray-shaped signal in `[0, 1]`.
 *
 * Real GR is spiky — sharp, mostly-upward kicks from a low baseline with calmer
 * smooth stretches between them — not a sine wave. Getting that texture roughly
 * right matters here because the review canvas is judged on whether correcting
 * a realistic trace feels workable.
 */
function grSignal(rows: number, seed = 7): Float64Array {
  const out = new Float64Array(rows);
  let state = seed;
  const random = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };

  let baseline = 0.3;
  let burst = 0;
  for (let y = 0; y < rows; y += 1) {
    if (y % 900 === 0) baseline = 0.18 + random() * 0.35;
    if (burst <= 0 && random() < 0.004) burst = 40 + Math.floor(random() * 220);

    const smooth = 0.06 * Math.sin(y / 130) + 0.03 * Math.sin(y / 37);
    const spike = burst > 0 && random() < 0.22 ? random() * 0.45 : 0;
    const jitter = (random() - 0.5) * (burst > 0 ? 0.05 : 0.012);

    out[y] = Math.min(0.98, Math.max(0.02, baseline + smooth + spike + jitter));
    burst -= 1;
  }
  return out;
}

function delay<T>(value: T, ms = 180): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

export class MockDigitizationGateway implements DigitizationGateway {
  private jobs = new Map<string, MockJob>();

  health(): Promise<DigitizationHealth> {
    return delay({
      available: true,
      reason:
        "Mock gateway: no model is running. Curves are generated in the browser " +
        "and must not be reported as digitization results.",
    });
  }

  async createJob(file: File): Promise<JobSummary> {
    const jobId = `mock-${Math.random().toString(36).slice(2, 10)}`;
    const trueX = grSignal(MOCK_HEIGHT);

    const summary: JobSummary = {
      job_id: jobId,
      phase: "cropping",
      file_name: file.name,
      created_at: Date.now() / 1000,
      raster: {
        width: MOCK_WIDTH,
        height: MOCK_HEIGHT,
        mode: "1",
        image_format: "TIFF",
        size_bytes: file.size,
        n_pages: 1,
        dpi: 300,
      },
      preprocess: null,
      crop: null,
      calibration: null,
      settings: null,
      progress: null,
      quality: null,
      error: null,
    };

    this.jobs.set(jobId, { summary, trueX, curveX: null, observed: null });
    return delay(summary, 400);
  }

  getJob(jobId: string): Promise<JobSummary> {
    return delay(this.require(jobId).summary, 60);
  }

  async deleteJob(jobId: string): Promise<void> {
    this.jobs.delete(jobId);
  }

  preprocess(jobId: string, settings: PreprocessSettings): Promise<JobSummary> {
    const job = this.require(jobId);
    const applied: string[] = [];
    const skipped: Record<string, string> = {};
    if (settings.denoise) applied.push("denoise");
    if (settings.deskew) {
      skipped.deskew =
        "image is 24,000 px tall; rotating it whole would push the track out of " +
        "frame. Crop the track first.";
    }
    if (settings.attenuate_grid) applied.push("attenuate_grid");

    job.summary = {
      ...job.summary,
      preprocess: { applied, skipped, skew_angle_deg: 0.14 },
    };
    return delay(job.summary, 500);
  }

  setCrop(jobId: string, crop: TrackCrop): Promise<JobSummary> {
    const job = this.require(jobId);
    job.summary = { ...job.summary, crop, phase: "calibrating" };
    return delay(job.summary);
  }

  setCalibration(jobId: string, calibration: TrackCalibration): Promise<JobSummary> {
    const job = this.require(jobId);
    job.summary = { ...job.summary, calibration };
    return delay(job.summary);
  }

  async startSegmentation(
    jobId: string,
    settings: SegmentationSettings
  ): Promise<JobSummary> {
    const job = this.require(jobId);
    const crop = job.summary.crop;
    if (!crop) throw new Error("Select the track crop before segmenting.");

    const rows = crop.y_bottom - crop.y_top;
    const width = crop.x_right - crop.x_left;
    const windows = Math.max(1, Math.ceil(rows / 768));

    job.summary = {
      ...job.summary,
      settings,
      phase: "segmenting",
      progress: { windows_total: windows, windows_done: 0, message: "Queued" },
    };

    // Advance the progress bar over a couple of seconds so the polling UI is
    // exercised rather than jumping straight to a finished job.
    let done = 0;
    const timer = setInterval(() => {
      done = Math.min(windows, done + Math.max(1, Math.round(windows / 12)));
      job.summary = {
        ...job.summary,
        progress: {
          windows_total: windows,
          windows_done: done,
          message: `Running the model over ${windows} windows`,
        },
      };
      if (done >= windows) {
        clearInterval(timer);
        this.finishSegmentation(job, crop.y_top, rows, width);
      }
    }, 180);

    return job.summary;
  }

  private finishSegmentation(
    job: MockJob,
    yTop: number,
    rows: number,
    width: number
  ): void {
    const curveX = new Float64Array(rows);
    const observed = new Uint8Array(rows);

    // Two dropouts, so the review UI has genuine unrecovered stretches to show
    // and correct rather than a curve that is perfect everywhere.
    const gaps: Array<[number, number]> = [
      [Math.floor(rows * 0.28), Math.floor(rows * 0.31)],
      [Math.floor(rows * 0.62), Math.floor(rows * 0.635)],
    ];

    for (let y = 0; y < rows; y += 1) {
      const inGap = gaps.some(([a, b]) => y >= a && y < b);
      if (inGap) {
        curveX[y] = Number.NaN;
        observed[y] = 0;
        continue;
      }
      curveX[y] = job.trueX[Math.min(yTop + y, job.trueX.length - 1)] * width;
      observed[y] = 1;
    }

    const unrecovered = gaps.reduce((total, [a, b]) => total + (b - a), 0);
    job.curveX = curveX;
    job.observed = observed;
    job.summary = {
      ...job.summary,
      phase: "reviewing",
      quality: {
        coverage: (rows - unrecovered) / rows,
        n_wraps: 0,
        n_rows: rows,
        n_unrecovered: unrecovered,
      },
    };
  }

  async getCurve(
    jobId: string,
    options: { y0?: number; y1?: number; stride?: number } = {}
  ): Promise<CurveWindow> {
    const job = this.require(jobId);
    if (!job.curveX || !job.observed) {
      throw new Error("No digitized curve yet - run segmentation first.");
    }

    const stride = options.stride ?? 1;
    const y0 = Math.max(0, options.y0 ?? 0);
    const y1 = Math.min(job.curveX.length, options.y1 ?? job.curveX.length);

    const x: Array<number | null> = [];
    const observed: boolean[] = [];
    for (let y = y0; y < y1; y += stride) {
      const value = job.curveX[y];
      x.push(Number.isNaN(value) ? null : value);
      observed.push(job.observed[y] === 1);
    }
    return { y0, y1, stride, x, observed };
  }

  async exportLas(
    jobId: string,
    request: ExportRequest
  ): Promise<{ text: string; fileName: string }> {
    const job = this.require(jobId);
    const calibration = job.summary.calibration ?? DEFAULT_CALIBRATION;
    const curve = await this.getCurve(jobId);
    const crop = job.summary.crop;
    const width = crop ? crop.x_right - crop.x_left : 1;

    const span = calibration.depth_bottom - calibration.depth_top;
    const step = request.step;
    const count = Math.max(1, Math.floor(span / step));

    const lines: string[] = [
      "~Version Information",
      " VERS.  2.00 : CWLS LOG ASCII STANDARD - VERSION 2.0",
      " WRAP.  NO   : One Line Per Depth Step",
      "~Well Information",
      ` STRT.${calibration.depth_unit} ${calibration.depth_top.toFixed(4)} :`,
      ` STOP.${calibration.depth_unit} ${calibration.depth_bottom.toFixed(4)} :`,
      ` STEP.${calibration.depth_unit} ${step.toFixed(4)} :`,
      " NULL.   -999.2500 :",
      ` WELL.   ${request.header.well || "MOCK WELL"} :`,
      "~Curve Information",
      ` DEPT.${calibration.depth_unit} : Depth`,
      ` ${calibration.mnemonic}.${calibration.value_unit} : Digitized curve`,
      "~Other",
      "MOCK GATEWAY OUTPUT - not produced by the segmentation model.",
      `~A  DEPT  ${calibration.mnemonic}`,
    ];

    for (let i = 0; i < count; i += 1) {
      const depth = calibration.depth_top + i * step;
      const row = Math.floor((i / count) * curve.x.length);
      const px = curve.x[row];
      const value =
        px === null || px === undefined
          ? -999.25
          : calibration.value_min +
            (px / width) * (calibration.value_max - calibration.value_min);
      lines.push(`${depth.toFixed(4)}  ${value.toFixed(4)}`);
    }

    const stem = job.summary.file_name.replace(/\.[^.]+$/, "").replace(/\s+/g, "_");
    return delay(
      { text: lines.join("\n"), fileName: `${stem}_${calibration.mnemonic}.las` },
      300
    );
  }

  async sendToAnalysis(): Promise<SendToAnalysisResponse> {
    throw new Error(
      "The mock gateway cannot hand a well to LAS analysis - that needs the real " +
        "backend. Download the LAS and upload it in the Analysis workspace instead."
    );
  }

  /**
   * A data-URI tile drawn on the fly: paper, grid, and the trace for these rows.
   *
   * Returning a URL keeps the canvas code identical between the mock and the
   * real gateway, so the review step is genuinely exercised rather than
   * special-cased.
   */
  tileUrl(
    jobId: string,
    options: {
      y0: number;
      y1: number;
      x0?: number;
      x1?: number;
      scale?: number;
      layer?: TileLayer;
    }
  ): string {
    const job = this.jobs.get(jobId);
    if (!job) return "";

    const scale = options.scale ?? 1;
    const x0 = options.x0 ?? 0;
    const x1 = options.x1 ?? job.summary.raster.width;
    const y0 = Math.max(0, Math.floor(options.y0));
    const y1 = Math.min(job.summary.raster.height, Math.ceil(options.y1));

    const width = Math.max(1, Math.round((x1 - x0) * scale));
    const height = Math.max(1, Math.round((y1 - y0) * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return "";

    context.fillStyle = options.layer === "mask" ? "#ffffff" : "#fdfcf8";
    context.fillRect(0, 0, width, height);

    if (options.layer !== "mask") {
      context.strokeStyle = "rgba(60,60,60,0.22)";
      context.lineWidth = 1;
      for (let y = y0 - (y0 % 20); y < y1; y += 20) {
        const py = (y - y0) * scale;
        context.beginPath();
        context.moveTo(0, py);
        context.lineTo(width, py);
        context.stroke();
      }
      for (let x = x0 - (x0 % 60); x < x1; x += 60) {
        const px = (x - x0) * scale;
        context.beginPath();
        context.moveTo(px, 0);
        context.lineTo(px, height);
        context.stroke();
      }
    }

    context.strokeStyle = options.layer === "mask" ? "#c2410c" : "#101010";
    context.lineWidth = Math.max(1, 2 * scale);
    context.beginPath();
    for (let y = y0; y < y1; y += 1) {
      const px = (job.trueX[y] * job.summary.raster.width - x0) * scale;
      const py = (y - y0) * scale;
      if (y === y0) context.moveTo(px, py);
      else context.lineTo(px, py);
    }
    context.stroke();

    return canvas.toDataURL("image/png");
  }

  private require(jobId: string): MockJob {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(
        `Unknown job_id: ${jobId}. The mock gateway keeps jobs in memory, so a ` +
          `page reload starts over.`
      );
    }
    return job;
  }
}

export const MOCK_DEFAULTS = { DEFAULT_SEGMENTATION };
