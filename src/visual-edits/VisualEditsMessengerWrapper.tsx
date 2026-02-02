"use client";

import { Suspense, lazy } from "react";

const VisualEditsMessenger = lazy(() => import("./VisualEditsMessenger"));

export default function VisualEditsMessengerWrapper() {
  return (
    <Suspense fallback={null}>
      <VisualEditsMessenger />
    </Suspense>
  );
}
