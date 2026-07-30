import React, { useState, useEffect } from 'react';
import { ZeroTierDiagnostics, CheckResult, StatusLevel } from '@shared/types';

export const ZeroTierDiagnosticsView: React.FC = () => {
  const [diagnostics, setDiagnostics] = useState<ZeroTierDiagnostics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedChecks, setExpandedChecks] = useState<Set<string>>(new Set());

  const runDiagnostics = async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await window.electron.zerotier.diagnostics();

      if (result.success && result.data) {
        setDiagnostics(result.data);
      } else {
        setError(result.error || 'Failed to run diagnostics');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runDiagnostics();
  }, []);

  const toggleDetails = (checkId: string) => {
    setExpandedChecks(prev => {
      const next = new Set(prev);
      if (next.has(checkId)) {
        next.delete(checkId);
      } else {
        next.add(checkId);
      }
      return next;
    });
  };

  const copyToClipboard = async () => {
    if (!diagnostics) return;

    const reportText = formatDiagnosticsReport(diagnostics);

    try {
      await navigator.clipboard.writeText(reportText);
      alert('Diagnostic report copied to clipboard!');
    } catch (err) {
      alert('Failed to copy to clipboard');
    }
  };

  const formatDiagnosticsReport = (diag: ZeroTierDiagnostics): string => {
    const lines: string[] = [];

    lines.push('='.repeat(60));
    lines.push('ZeroTier Diagnostics Report');
    lines.push('='.repeat(60));
    lines.push('');
    lines.push(`Timestamp: ${new Date(diag.timestamp).toLocaleString()}`);
    lines.push('');

    diag.checks.forEach(check => {
      const statusSymbol =
        check.status === 'ok' ? '✓' :
        check.status === 'warn' ? '⚠' :
        '✗';

      lines.push(`${statusSymbol} ${check.label}: ${check.status.toUpperCase()}`);
      lines.push(`  ${check.message}`);

      if (check.details) {
        lines.push('');
        lines.push('  Details:');
        check.details.split('\n').forEach(line => {
          lines.push(`    ${line}`);
        });
      }

      lines.push('');
    });

    return lines.join('\n');
  };

  const getStatusColor = (status: StatusLevel): string => {
    switch (status) {
      case 'ok':
        return 'bg-green-500';
      case 'warn':
        return 'bg-yellow-500';
      case 'error':
        return 'bg-red-500';
    }
  };

  const getStatusIcon = (status: StatusLevel) => {
    switch (status) {
      case 'ok':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        );
      case 'warn':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        );
      case 'error':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        );
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
          <p className="text-gray-600">Running diagnostics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="bg-red-500 rounded-full p-2 text-white">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-red-900">Diagnostics Failed</h3>
          </div>
          <p className="text-red-700">{error}</p>
        </div>

        <button
          onClick={runDiagnostics}
          className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (!diagnostics) {
    return null;
  }

  const hasErrors = diagnostics.checks.some(c => c.status === 'error');
  const hasWarnings = diagnostics.checks.some(c => c.status === 'warn');

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">ZeroTier Diagnostics</h2>
        <p className="text-gray-600">
          Last run: {new Date(diagnostics.timestamp).toLocaleString()}
        </p>
      </div>

      {/* Summary */}
      <div className="mb-6 flex items-center gap-4">
        <button
          onClick={runDiagnostics}
          disabled={loading}
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Run Diagnostics Again
        </button>

        <button
          onClick={copyToClipboard}
          className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors"
        >
          Copy Report to Clipboard
        </button>

        {hasErrors && (
          <span className="text-red-600 font-medium">
            {diagnostics.checks.filter(c => c.status === 'error').length} error(s)
          </span>
        )}

        {hasWarnings && (
          <span className="text-yellow-600 font-medium">
            {diagnostics.checks.filter(c => c.status === 'warn').length} warning(s)
          </span>
        )}
      </div>

      {/* Checks List */}
      <div className="space-y-3">
        {diagnostics.checks.map(check => (
          <CheckResultCard
            key={check.id}
            check={check}
            expanded={expandedChecks.has(check.id)}
            onToggle={() => toggleDetails(check.id)}
            getStatusColor={getStatusColor}
            getStatusIcon={getStatusIcon}
          />
        ))}
      </div>
    </div>
  );
};

interface CheckResultCardProps {
  check: CheckResult;
  expanded: boolean;
  onToggle: () => void;
  getStatusColor: (status: StatusLevel) => string;
  getStatusIcon: (status: StatusLevel) => React.ReactNode;
}

const CheckResultCard: React.FC<CheckResultCardProps> = ({
  check,
  expanded,
  onToggle,
  getStatusColor,
  getStatusIcon,
}) => {
  const borderColor =
    check.status === 'ok' ? 'border-green-200' :
    check.status === 'warn' ? 'border-yellow-200' :
    'border-red-200';

  const bgColor =
    check.status === 'ok' ? 'bg-green-50' :
    check.status === 'warn' ? 'bg-yellow-50' :
    'bg-red-50';

  return (
    <div className={`border ${borderColor} ${bgColor} rounded-xl p-4`}>
      <div className="flex items-start gap-3">
        <div className={`${getStatusColor(check.status)} rounded-full p-2 text-white flex-shrink-0`}>
          {getStatusIcon(check.status)}
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 mb-1">{check.label}</h3>
          <p className="text-sm text-gray-700">{check.message}</p>

          {check.details && (
            <div className="mt-3">
              <button
                onClick={onToggle}
                className="text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
              >
                {expanded ? 'Hide' : 'Show'} Details
                <svg
                  className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {expanded && (
                <div className="mt-2 p-3 bg-white bg-opacity-50 rounded-lg border border-gray-200">
                  <pre className="text-xs text-gray-800 whitespace-pre-wrap font-mono overflow-x-auto">
                    {check.details}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
