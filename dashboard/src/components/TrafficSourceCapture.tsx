"use client";

import { useEffect } from "react";
import { captureTrafficSource } from "@/lib/trafficSource";

/** Remembers where a visitor came from (?src=, ?utm_source=, the linking site) for their sign-up. */
export default function TrafficSourceCapture() {
  useEffect(() => {
    captureTrafficSource();
  }, []);
  return null;
}
