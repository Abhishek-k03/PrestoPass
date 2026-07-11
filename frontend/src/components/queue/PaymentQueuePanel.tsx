"use client";

import { motion } from "motion/react";
import { Check, Clock, Pause, TriangleAlert, Zap } from "lucide-react";
import { seatType } from "@/lib/types";

interface QueueState {
  status: "idle" | "waiting" | "processing" | "success" | "failed";
  message: string;
}

interface Props {
  seat: seatType | null;
  queueState: QueueState;
}

const STEPS = ["waiting", "processing", "success"] as const;

const STEP_LABELS: Record<(typeof STEPS)[number], string> = {
  waiting: "Waiting",
  processing: "Processing",
  success: "Confirmed",
};

const AnimatedCheck = () => (
  <motion.svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="size-4"
  >
    <motion.path
      d="M20 6 9 17l-5-5"
      initial={{ pathLength: 0, opacity: 0 }}
      animate={{ pathLength: 1, opacity: 1 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
    />
  </motion.svg>
);

const PaymentQueuePanel = ({ seat, queueState }: Props) => {
  if (!seat) return null;

  // Blue is in-flight, green is done, red is stop. Amber stays out of this
  // panel on purpose: by now the user has already acted, so the clock hue
  // would misdescribe what is being asked of them.
  const statusClasses = {
    idle: "bg-muted text-muted-foreground",
    waiting: "bg-accent/12 text-accent",
    processing: "bg-accent/12 text-accent animate-pulse",
    success: "bg-success/12 text-success",
    failed: "bg-destructive/12 text-destructive",
  };

  const statusIcons = {
    idle: <Pause className="size-3.5" />,
    waiting: <Clock className="size-3.5" />,
    processing: <Zap className="size-3.5" />,
    success: <AnimatedCheck />,
    failed: <TriangleAlert className="size-3.5" />,
  };

  const statusLabels = {
    idle: "Waiting to start",
    waiting: "Request received",
    processing: "Confirming",
    success: "Confirmed",
    failed: "Could not confirm",
  };

  const statusDescriptions = {
    idle: "Your request is queued. Keep this page open.",
    waiting: "Your request has been accepted and is about to be processed.",
    processing: "Confirming your seat. This takes a few moments.",
    success: `Seat ${seat.seatNumber} is yours.`,
    failed: `Something went wrong. Seat ${seat.seatNumber} has been released.`,
  };

  const isFailed = queueState.status === "failed";
  const currentStepIndex = isFailed
    ? -1
    : STEPS.indexOf(queueState.status as (typeof STEPS)[number]);

  // Each step resolves to exactly one state. "success" is the last step, so
  // reaching it marks that step complete rather than leaving it current —
  // otherwise the final step reads as complete AND in-flight at once.
  const stepStateAt = (
    index: number,
  ): "complete" | "current" | "failed" | "pending" => {
    if (isFailed) {
      if (index === 0) return "complete";
      return index === 1 ? "failed" : "pending";
    }
    if (currentStepIndex < 0) return "pending"; // idle
    if (index < currentStepIndex) return "complete";
    if (index > currentStepIndex) return "pending";
    return queueState.status === "success" ? "complete" : "current";
  };

  const toneBorder = isFailed
    ? "border-destructive/32"
    : queueState.status === "success"
      ? "border-success/30"
      : "border-border";

  return (
    <div className={`rounded-xl border bg-card p-6.5 ${toneBorder}`}>
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          {/* Not "payment status": nothing is charged. */}
          <p className="text-kicker uppercase text-muted-foreground">
            Confirming your seat
          </p>
          <p className="mt-1.5 font-mono text-[17px] leading-none text-ivory">
            Seat {seat.seatNumber}
          </p>
        </div>

        <motion.div
          layout
          className={`inline-flex h-[26px] items-center gap-1.5 self-start rounded-md px-2.5 text-caption transition-colors sm:self-auto ${statusClasses[queueState.status]}`}
        >
          {statusIcons[queueState.status]}
          <span>{statusLabels[queueState.status]}</span>
        </motion.div>
      </div>

      <div className="flex items-start px-2">
        {STEPS.map((step, index) => {
          const state = stepStateAt(index);
          const isLast = index === STEPS.length - 1;

          const circleClasses =
            state === "failed"
              ? "border-destructive bg-destructive/12 text-destructive"
              : state === "complete"
                ? "border-success bg-success text-success-foreground"
                : state === "current"
                  ? "border-accent bg-accent text-accent-foreground"
                  : "border-border bg-muted text-muted-foreground";

          const labelClasses =
            state === "failed"
              ? "text-destructive"
              : state === "complete"
                ? "text-ink-300"
                : state === "current"
                  ? "text-accent"
                  : "text-muted-foreground";

          return (
            <div key={step} className="flex flex-1 items-start last:flex-none">
              <div className="flex w-23 flex-col items-center gap-2.5">
                {/* Only the one in-flight step animates. Completed steps sit
                    still — otherwise every circle replays its pop together
                    on each re-render. */}
                <div
                  className={`flex size-9 items-center justify-center rounded-full border-2 font-mono text-[13px] transition-colors ${circleClasses} ${
                    state === "current" ? "animate-pulse" : ""
                  }`}
                >
                  {state === "failed" ? (
                    <TriangleAlert className="size-4" />
                  ) : state === "complete" ? (
                    <Check className="size-4" strokeWidth={3} />
                  ) : state === "current" ? (
                    <Zap className="size-4" />
                  ) : (
                    index + 1
                  )}
                </div>
                <span className={`text-caption ${labelClasses}`}>
                  {STEP_LABELS[step]}
                </span>
              </div>

              {!isLast && (
                <div className="mt-4.5 h-0.5 flex-1 overflow-hidden rounded-full bg-border">
                  <motion.div
                    className="h-full origin-left bg-success"
                    initial={{ scaleX: 0 }}
                    animate={{
                      // Fills once the step it leaves is genuinely done, so a
                      // completed step never trails an empty connector.
                      scaleX: state === "complete" ? 1 : 0,
                    }}
                    transition={{ duration: 0.6, ease: "easeInOut" }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div
        className={`mt-8 rounded-md p-4.5 ${
          isFailed
            ? "bg-destructive/12"
            : queueState.status === "success"
              ? "bg-success/12"
              : queueState.status === "idle"
                ? "bg-muted"
                : "bg-accent/12"
        }`}
      >
        <p
          className={`text-kicker uppercase ${
            isFailed
              ? "text-destructive"
              : queueState.status === "success"
                ? "text-success"
                : queueState.status === "idle"
                  ? "text-muted-foreground"
                  : "text-accent"
          }`}
        >
          Latest update
        </p>
        <p
          className={`mt-2 text-label ${
            isFailed
              ? "text-destructive"
              : queueState.status === "success"
                ? "text-success"
                : queueState.status === "idle"
                  ? "text-ink-300"
                  : "text-accent"
          }`}
        >
          {queueState.message || statusDescriptions[queueState.status]}
        </p>
      </div>
    </div>
  );
};

export default PaymentQueuePanel;
