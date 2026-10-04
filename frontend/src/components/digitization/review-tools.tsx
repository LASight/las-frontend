import { Ban, Hand, Pencil } from "lucide-react";
import type { ReviewTool } from "../../hooks/use-curve-review";

export const REVIEW_TOOLS = [
  { id: "inspect", label: "Pan / Inspect", icon: Hand, hint: "Drag to pan; read depth and value under the pointer." },
  { id: "redraw", label: "Redraw", icon: Pencil, hint: "Draw a replacement trace. Middle mouse or Space + drag temporarily pans." },
  { id: "discard", label: "Mark missing", icon: Ban, hint: "Drag a depth range to mark its values NULL. Does not erase the source TIFF." },
] satisfies Array<{ id: ReviewTool; label: string; icon: typeof Hand; hint: string }>;
