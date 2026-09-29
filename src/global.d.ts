export {};

declare global {
  interface HTMLElement {
    // Cycle de vie
    __quizDestroy?: () => void;
    // Nullable : terminal.ts remet le cleanup à `null` après exécution (bindMathQuestion / bindTextQuestion).
    __quizTextQuestionCleanup?: (() => void) | null;
    // Track / animation (engine/track.ts)
    // Nullable : track.ts remet le handler à `null` après retrait (cancelRunningTrackAnimation / finishTrackSlideAnimation).
    __quizTransitionEndHandler?: ((e: TransitionEvent) => void) | null;
    __quizTargetX?: number;
    __quizTargetIndex?: number;
    __quizTargetHeight?: number;
    __quizLockedHeight?: number;
    // Nav tabs (engine/state.ts)
    __quizPressClearTimer?: number;
    // Viewport (engine/viewport.ts)
    __quizAppliedWidth?: number;
  }

  interface Window {
    // React global optionnel, injecté par un autre plugin (editor/utils.ts loadReact)
    React?: unknown;
    ReactDOM?: unknown;
  }
}
