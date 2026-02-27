import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
        errorInfo: null
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error, errorInfo: null };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('Uncaught error:', error, errorInfo);
        this.setState({
            error,
            errorInfo
        });
    }

    public render() {
        if (this.state.hasError) {
            return (
                <div className="p-8 max-w-2xl mx-auto mt-10 text-white bg-slate-900 rounded-lg shadow-xl border border-red-500/30">
                    <h1 className="text-2xl font-bold text-red-400 mb-4">エラーが発生しました / Something went wrong</h1>

                    <div className="mb-6 bg-black/50 p-4 rounded override-scroll">
                        <h2 className="text-sm font-bold text-slate-400 mb-2 uppercase tracking-wider">Error Message</h2>
                        <pre className="text-red-300 whitespace-pre-wrap font-mono text-sm">
                            {this.state.error?.toString()}
                        </pre>
                    </div>

                    {this.state.errorInfo && (
                        <div className="bg-black/50 p-4 rounded overflow-auto max-h-96 override-scroll">
                            <h2 className="text-sm font-bold text-slate-400 mb-2 uppercase tracking-wider">Component Stack</h2>
                            <pre className="text-slate-400 whitespace-pre-wrap font-mono text-xs">
                                {this.state.errorInfo.componentStack}
                            </pre>
                        </div>
                    )}

                    <div className="mt-6 pt-6 border-t border-slate-700">
                        <button
                            onClick={() => window.location.reload()}
                            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm transition-colors"
                        >
                            ページを再読み込み / Reload Page
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
