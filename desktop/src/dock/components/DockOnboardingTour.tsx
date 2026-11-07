import React, { useState, useEffect, useCallback, useRef } from "react";
import Icon from "../DockIcon";

export const DOCK_ONBOARDING_KEY = "mce_dock_onboarding_completed_v1";
export const DOCK_ONBOARDING_COMPLETED_EVENT = "mce-dock-onboarding-completed";

interface TourStep {
  targetSelector: string;
  title: string;
  description: string;
  placement?: "bottom" | "top";
}

const TOUR_STEPS: TourStep[] = [
  {
    targetSelector: ".dock-bible-search-row__input .dock_search__input, .dock_search__input",
    title: "Quick Scripture Search",
    description: "Type any reference (e.g. John 3:16, Psalm 23, or Gen 1:1) and press Enter to search and project instantly.",
    placement: "bottom",
  },
  {
    targetSelector: ".dock-bible-reader__quick-edit-toolbar-btn",
    title: "Quick Edits & Styling",
    description: "Customize verse backgrounds, colors, fonts, and typography directly for your stream or screens.",
    placement: "bottom",
  },
];

export const DockOnboardingTour: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const rafIdRef = useRef<number | null>(null);

  // Initialize: check if user already finished the tour
  useEffect(() => {
    try {
      const completed = localStorage.getItem(DOCK_ONBOARDING_KEY);
      if (completed !== "true") {
        // Small delay so dock UI finishes mounting
        const timer = setTimeout(() => {
          setIsOpen(true);
        }, 600);
        return () => clearTimeout(timer);
      }
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  // Listen for custom trigger to replay tour
  useEffect(() => {
    const handleReplay = () => {
      setCurrentStep(0);
      setIsOpen(true);
    };
    window.addEventListener("mce-start-dock-tour", handleReplay);
    return () => window.removeEventListener("mce-start-dock-tour", handleReplay);
  }, []);

  // Update target rect on step change, resize, scroll
  const updateRect = useCallback(() => {
    if (!isOpen) return;
    const step = TOUR_STEPS[currentStep];
    if (!step) return;

    const el = document.querySelector(step.targetSelector);
    if (el) {
      const rect = el.getBoundingClientRect();
      setTargetRect(rect);
    } else {
      setTargetRect(null);
    }
  }, [isOpen, currentStep]);

  useEffect(() => {
    if (!isOpen) return;

    updateRect();
    const handleResizeOrScroll = () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = requestAnimationFrame(updateRect);
    };

    window.addEventListener("resize", handleResizeOrScroll, { passive: true });
    window.addEventListener("scroll", handleResizeOrScroll, { passive: true, capture: true });

    // Poll briefly to ensure target is mounted if still rendering
    const interval = setInterval(updateRect, 300);

    return () => {
      window.removeEventListener("resize", handleResizeOrScroll);
      window.removeEventListener("scroll", handleResizeOrScroll, true);
      clearInterval(interval);
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
  }, [isOpen, updateRect]);

  const handleDismiss = useCallback(() => {
    try {
      localStorage.setItem(DOCK_ONBOARDING_KEY, "true");
    } catch { /* ignore */ }
    setIsOpen(false);
    try {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(DOCK_ONBOARDING_COMPLETED_EVENT));
      }
    } catch { /* ignore */ }
  }, []);

  const handleNext = useCallback(() => {
    if (currentStep < TOUR_STEPS.length - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      handleDismiss();
    }
  }, [currentStep, handleDismiss]);

  const handlePrev = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  }, [currentStep]);

  if (!isOpen) return null;

  const step = TOUR_STEPS[currentStep];

  // Tooltip positioning
  let tooltipStyle: React.CSSProperties = {
    position: "fixed",
    zIndex: 9995,
  };

  const pad = 8;
  const tooltipWidth = Math.min(320, window.innerWidth - 32);

  if (targetRect) {
    let top = targetRect.bottom + 12;
    let left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;

    // Check bounds
    if (left < 16) left = 16;
    if (left + tooltipWidth > window.innerWidth - 16) {
      left = window.innerWidth - tooltipWidth - 16;
    }

    if (top + 180 > window.innerHeight) {
      top = Math.max(16, targetRect.top - 180);
    }

    tooltipStyle = {
      ...tooltipStyle,
      top: `${top}px`,
      left: `${left}px`,
      width: `${tooltipWidth}px`,
    };
  } else {
    // Center fallback if target not found in DOM
    tooltipStyle = {
      ...tooltipStyle,
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      width: `${tooltipWidth}px`,
    };
  }

  return (
    <>
      {/* Semi-transparent Backdrop */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(0, 0, 0, 0.55)",
          zIndex: 9990,
          transition: "opacity 0.2s ease",
        }}
        onClick={handleDismiss}
      />

      {/* Spotlight Ring around target */}
      {targetRect && (
        <div
          style={{
            position: "fixed",
            top: targetRect.top - pad,
            left: targetRect.left - pad,
            width: targetRect.width + pad * 2,
            height: targetRect.height + pad * 2,
            borderRadius: 8,
            boxShadow: "0 0 0 4px #3b82f6, 0 0 20px rgba(59, 130, 246, 0.6)",
            border: "2px solid #60a5fa",
            pointerEvents: "none",
            zIndex: 9992,
            transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
            animation: "dockSpotlightPulse 2s infinite ease-in-out",
          }}
        />
      )}

      {/* Tooltip Card */}
      <div
        role="dialog"
        aria-label="MakeChurchEazy Dock Onboarding"
        style={{
          ...tooltipStyle,
          backgroundColor: "var(--surface)",
          color: "var(--text-primary)",
          borderRadius: 12,
          border: "1px solid var(--border)",
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)",
          padding: 16,
          boxSizing: "border-box",
          fontFamily: "inherit",
          fontSize: 13,
          lineHeight: 1.5,
          animation: "dockTooltipFade 0.2s ease-out",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                backgroundColor: "var(--primary)",
                color: "#fff",
                padding: "2px 8px",
                borderRadius: 9999,
              }}
            >
              Step {currentStep + 1} of {TOUR_STEPS.length}
            </span>
            <span style={{ fontWeight: 600, fontSize: 14, color: "var(--text-primary)" }}>{step.title}</span>
          </div>
          <button
            onClick={handleDismiss}
            aria-label="Skip tour"
            title="Skip tour"
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              padding: 4,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 4,
            }}
          >
            <Icon name="close" size={14} />
          </button>
        </div>

        {/* Content */}
        <p style={{ margin: "0 0 16px 0", color: "#d4d4d8", fontSize: 13 }}>
          {step.description}
        </p>

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <button
            onClick={handleDismiss}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              fontSize: 12,
              cursor: "pointer",
              padding: "4px 8px",
              borderRadius: 4,
            }}
          >
            Skip tour
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {currentStep > 0 && (
              <button
                onClick={handlePrev}
                style={{
                  background: "var(--surface-raised)",
                  border: "1px solid var(--border)",
                  color: "var(--text-primary)",
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                  padding: "6px 12px",
                  borderRadius: 6,
                }}
              >
                Back
              </button>
            )}
            <button
              onClick={handleNext}
              style={{
                background: "var(--primary)",
                border: "none",
                color: "#fff",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                padding: "6px 14px",
                borderRadius: 6,
                boxShadow: "0 1px 2px rgba(0, 0, 0, 0.2)",
              }}
            >
              {currentStep < TOUR_STEPS.length - 1 ? "Next" : "Got it!"}
            </button>
          </div>
        </div>
      </div>

      {/* Embedded keyframe styles */}
      <style>{`
        @keyframes dockSpotlightPulse {
          0%, 100% {
            box-shadow: 0 0 0 3px #3b82f6, 0 0 15px rgba(59, 130, 246, 0.4);
          }
          50% {
            box-shadow: 0 0 0 5px #60a5fa, 0 0 25px rgba(59, 130, 246, 0.8);
          }
        }
        @keyframes dockTooltipFade {
          from {
            opacity: 0;
            transform: scale(0.96) translateY(-4px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
      `}</style>
    </>
  );
};
