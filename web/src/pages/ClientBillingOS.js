import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/App';
import { runtime } from '@/runtime';
import { ApiError } from '@/runtime-client';
import { payInvoiceWithGate } from '@/lib/payWithGate';
import {
  ArrowLeft,
  DollarSign,
  CheckCircle2,
  Clock,
  CreditCard
} from 'lucide-react';

// WEB-P4 — Backend Authority Contract.
// All business state (totals, pending/paid buckets) comes from
// `/api/client/billing/invoices-summary`. This page renders JSON;
// it no longer computes anything with `.reduce`, `.filter` or `useMemo`.
const ClientBillingOS = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [summary, setSummary] = useState({
    totals: { pending: 0, paid: 0, pending_count: 0, paid_count: 0 },
    pending: [],
    paid: [],
  });
  const [loading, setLoading] = useState(true);
  const [paymentLoading, setPaymentLoading] = useState(null);

  const fetchSummary = async () => {
    try {
      const { data } = await runtime.get('/api/client/billing/invoices-summary');
      setSummary({
        totals: data.totals || { pending: 0, paid: 0, pending_count: 0, paid_count: 0 },
        pending: Array.isArray(data.pending) ? data.pending : [],
        paid: Array.isArray(data.paid) ? data.paid : [],
      });
    } catch (error) {
      if (error instanceof ApiError) {
        console.error('[billing] fetch invoices-summary failed', {
          code: error.code, requestId: error.requestId, message: error.message,
        });
      } else {
        console.error('Error fetching invoices summary:', error);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSummary();
  }, []);

  const handlePayment = async (invoiceId, amount, projectId) => {
    setPaymentLoading(invoiceId);
    try {
      const r = await payInvoiceWithGate(invoiceId, { projectId: projectId || null, navigate });
      if (r.ok === true) {
        alert(`✅ Payment confirmed!\n\n💰 $${amount} paid\n🚀 Project resumed`);
        await fetchSummary();
      } else if (r.ok === false && !r.redirected) {
        console.error('Error processing payment:', r.error);
        alert('Failed to process payment');
      }
    } finally {
      setPaymentLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" data-testid="billing-loading">
        <div className="w-8 h-8 border-2 border-border border-t-signal rounded-full animate-spin" />
      </div>
    );
  }

  const { totals, pending: pendingInvoices, paid: paidInvoices } = summary;

  return (
    <div className="min-h-screen p-6 lg:p-8" data-testid="client-billing-os">
      {/* Back button */}
      <button
        onClick={() => navigate('/client/dashboard-os')}
        className="flex items-center gap-2 text-muted-foreground hover:text-white mb-6 transition-colors"
        data-testid="back-btn"
      >
        <ArrowLeft className="w-4 h-4" />
        <span className="text-sm">Back to Dashboard</span>
      </button>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-semibold text-white mb-2">Billing & Payments</h1>
        <p className="text-muted-foreground text-sm">Manage invoices and payments</p>
      </div>

      {/* Summary Cards (server-authored totals) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <div className="border border-yellow-500/30 bg-yellow-500/5 rounded-lg p-6" data-testid="pending-summary">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-12 h-12 rounded-lg bg-yellow-500/20 flex items-center justify-center">
              <Clock className="w-6 h-6 text-yellow-400" />
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Pending</div>
              <div className="text-2xl font-semibold text-yellow-400">
                ${Number(totals.pending || 0).toLocaleString()}
              </div>
            </div>
          </div>
          <div className="text-muted-foreground text-xs">{totals.pending_count} pending invoice(s)</div>
        </div>

        <div className="border border-green-500/30 bg-green-500/5 rounded-lg p-6" data-testid="paid-summary">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-12 h-12 rounded-lg bg-green-500/20 flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6 text-green-400" />
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Paid</div>
              <div className="text-2xl font-semibold text-green-400">
                ${Number(totals.paid || 0).toLocaleString()}
              </div>
            </div>
          </div>
          <div className="text-muted-foreground text-xs">{totals.paid_count} paid invoice(s)</div>
        </div>
      </div>

      {/* Pending Invoices (server-bucketed) */}
      {pendingInvoices.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-yellow-400" />
            Pending Invoices
          </h2>
          <div className="space-y-3" data-testid="pending-invoices-list">
            {pendingInvoices.map((invoice) => {
              const isOverdue = !!invoice.overdue;

              return (
                <div
                  key={invoice.invoice_id}
                  className={`border rounded-lg p-4 ${
                    isOverdue
                      ? 'border-red-500/40 bg-red-500/10'
                      : 'border-yellow-500/30 bg-yellow-500/5'
                  }`}
                  data-testid={`invoice-${invoice.invoice_id}`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="text-white font-medium mb-1 flex items-center gap-2">
                        {invoice.title || invoice.module_name}
                        {isOverdue && (
                          <span className="text-xs bg-red-500/30 text-red-300 px-2 py-0.5 rounded font-medium">
                            OVERDUE
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {invoice.project_name || invoice.project_id} · {new Date(invoice.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`text-xl font-semibold ${isOverdue ? 'text-red-400' : 'text-yellow-400'}`}>
                        ${Number(invoice.amount || 0).toLocaleString()}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => handlePayment(invoice.invoice_id, invoice.amount, invoice.project_id)}
                    disabled={paymentLoading === invoice.invoice_id}
                    className={`w-full flex items-center justify-center gap-2 border py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50 ${
                      isOverdue
                        ? 'bg-red-500/20 hover:bg-red-500/30 border-red-500/30 text-red-300'
                        : 'bg-signal/20 hover:bg-signal/30 border-signal/30 text-signal'
                    }`}
                    data-testid={`pay-btn-${invoice.invoice_id}`}
                  >
                    <CreditCard className="w-4 h-4" />
                    {paymentLoading === invoice.invoice_id ? 'Processing...' : (isOverdue ? 'Pay Now (Urgent)' : 'Pay Now')}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Paid Invoices (server-bucketed) */}
      {paidInvoices.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-400" />
            Paid Invoices
          </h2>
          <div className="space-y-3" data-testid="paid-invoices-list">
            {paidInvoices.map((invoice) => (
              <div
                key={invoice.invoice_id}
                className="border border-border rounded-lg p-4 opacity-70"
                data-testid={`invoice-${invoice.invoice_id}`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-white font-medium mb-1">
                      {invoice.title || invoice.module_name}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {invoice.project_name || invoice.project_id} · Paid {invoice.paid_at ? new Date(invoice.paid_at).toLocaleDateString() : '—'}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-semibold text-green-400">
                      ${Number(invoice.amount || 0).toLocaleString()}
                    </div>
                    <div className="text-xs text-green-400/70 flex items-center gap-1 justify-end">
                      <CheckCircle2 className="w-3 h-3" />
                      Paid
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {totals.pending_count === 0 && totals.paid_count === 0 && (
        <div className="border border-border rounded-lg p-12 text-center" data-testid="no-invoices">
          <DollarSign className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
          <div className="text-muted-foreground text-sm">No invoices yet</div>
        </div>
      )}
    </div>
  );
};

export default ClientBillingOS;
