"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Error boundary that silently catches WebGL / effects crashes so the
 * rest of the app continues to render against the CSS-only background
 * instead of going white.
 */
export class EffectsErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.warn("[EffectsErrorBoundary] A visual effect crashed and was disabled:", error);
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}
