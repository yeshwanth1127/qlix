"use client";

import {
  Children,
  type ButtonHTMLAttributes,
  type ReactNode,
  useState,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import styles from "./Stepper.module.css";

type IndicatorArgs = {
  readonly step: number;
  readonly currentStep: number;
  readonly onStepClick: (step: number) => void;
};

export function Step({ children }: { readonly children: ReactNode }) {
  return <div className={styles.step}>{children}</div>;
}

export default function Stepper({
  children,
  initialStep = 1,
  onStepChange = () => undefined,
  onFinalStepCompleted = () => undefined,
  backButtonText = "Previous",
  nextButtonText = "Next",
  finalButtonText = "Review answers",
  disableStepIndicators = false,
  renderStepIndicator,
  backButtonProps = {},
  nextButtonProps = {},
}: {
  readonly children: ReactNode;
  readonly initialStep?: number;
  readonly onStepChange?: (step: number) => void;
  readonly onFinalStepCompleted?: () => boolean | void | Promise<boolean | void>;
  readonly backButtonText?: string;
  readonly nextButtonText?: string;
  readonly finalButtonText?: string;
  readonly disableStepIndicators?: boolean;
  readonly renderStepIndicator?: (args: IndicatorArgs) => ReactNode;
  readonly backButtonProps?: ButtonHTMLAttributes<HTMLButtonElement>;
  readonly nextButtonProps?: ButtonHTMLAttributes<HTMLButtonElement>;
}) {
  const [currentStep, setCurrentStep] = useState(initialStep);
  const [direction, setDirection] = useState(0);
  const [completing, setCompleting] = useState(false);
  const reduceMotion = useReducedMotion();
  const steps = Children.toArray(children);
  const isLastStep = currentStep === steps.length;

  function updateStep(next: number) {
    setDirection(next > currentStep ? 1 : -1);
    setCurrentStep(next);
    onStepChange(next);
  }

  async function complete() {
    setCompleting(true);
    const result = await onFinalStepCompleted();
    setCompleting(false);
    if (result !== false) setCurrentStep(steps.length + 1);
  }

  return (
    <div className={styles.outer}>
      <div className={styles.container}>
        <div className={styles.indicators} aria-label={`Step ${Math.min(currentStep, steps.length)} of ${steps.length}`}>
          {steps.map((_, index) => {
            const step = index + 1;
            const complete = currentStep > step;
            const active = currentStep === step;
            return (
              <div key={step} className="contents">
                {renderStepIndicator ? renderStepIndicator({ step, currentStep, onStepClick: updateStep }) : (
                  <button
                    type="button"
                    aria-label={`Go to step ${step}`}
                    aria-current={active ? "step" : undefined}
                    disabled={disableStepIndicators}
                    onClick={() => updateStep(step)}
                    className={`${styles.indicator} ${active ? styles.indicatorActive : ""} ${complete ? styles.indicatorComplete : ""}`}
                  >
                    {complete ? "✓" : step}
                  </button>
                )}
                {step < steps.length ? (
                  <div className={styles.connector} aria-hidden>
                    <motion.div
                      className={styles.connectorFill}
                      initial={false}
                      animate={{ scaleX: complete ? 1 : 0 }}
                      transition={{ duration: reduceMotion ? 0 : 0.18 }}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className={styles.content}>
          <AnimatePresence initial={false} mode="wait" custom={direction}>
            {currentStep <= steps.length ? (
              <motion.div
                key={currentStep}
                custom={direction}
                initial={{ x: reduceMotion ? 0 : direction >= 0 ? 12 : -12, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: reduceMotion ? 0 : direction >= 0 ? -8 : 8, opacity: 0 }}
                transition={{ duration: reduceMotion ? 0 : 0.16 }}
              >
                {steps[currentStep - 1]}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        {currentStep <= steps.length ? (
          <div className={styles.footer}>
            <div className={`${styles.navigation} ${currentStep > 1 ? styles.navigationSpread : ""}`}>
              {currentStep > 1 ? <button type="button" className={styles.back} onClick={() => updateStep(currentStep - 1)} {...backButtonProps}>{backButtonText}</button> : null}
              <button
                type="button"
                className={styles.next}
                onClick={() => isLastStep ? void complete() : updateStep(currentStep + 1)}
                {...nextButtonProps}
                disabled={completing || nextButtonProps.disabled}
              >
                {completing ? "Preparing…" : isLastStep ? finalButtonText : nextButtonText}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
