"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/** Keeps a rendering fault contained to the smallest possible UI region. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Deliberately avoid exposing implementation details in the customer UI.
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="section-error" role="alert">
          此区域暂时无法显示，请刷新页面重试。
        </div>
      );
    }
    return this.props.children;
  }
}
