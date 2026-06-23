import React from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught', error, info);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined });
  };

  handleReload = () => {
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-background">
          <div className="max-w-md w-full text-center space-y-4">
            <div className="mx-auto w-16 h-16 rounded-full bg-destructive/10 text-destructive flex items-center justify-center">
              <AlertTriangle className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold">Что-то пошло не так</h1>
            <p className="text-sm text-muted-foreground">
              Произошла непредвиденная ошибка. Попробуйте обновить страницу или вернуться на главную.
            </p>
            {this.state.error?.message && (
              <pre className="text-xs text-left bg-muted p-3 rounded-md overflow-auto max-h-32">
                {this.state.error.message}
              </pre>
            )}
            <div className="flex gap-3 justify-center">
              <Button onClick={this.handleReset} variant="outline">Попробовать снова</Button>
              <Button onClick={this.handleReload}>На главную</Button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
