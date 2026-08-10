"use client";

import { use } from "react";
import { VisualBuilderView } from "@/components/qlix/builder/visual/VisualBuilderView";

export default function IndividualVisualBuilderCanvasPage({
  params,
}: {
  params: Promise<{ canvasId: string }>;
}) {
  const { canvasId } = use(params);
  return <VisualBuilderView canvasId={canvasId} routePrefix="/individual" />;
}
