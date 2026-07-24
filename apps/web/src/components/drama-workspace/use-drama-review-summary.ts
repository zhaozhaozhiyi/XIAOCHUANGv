"use client";

import { useCallback, useEffect, useState } from "react";

import { dramaWorkspaceAPI, type DramaReviewSummary } from "@/lib/api";

export function useDramaReviewSummary(dramaId: number) {
  const [data, setData] = useState<DramaReviewSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setData(await dramaWorkspaceAPI.getReviewSummary(dramaId, { bypassCache: true }));
    } finally {
      setLoading(false);
    }
  }, [dramaId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh().catch(() => setData(null));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  return { data, loading, refresh };
}
