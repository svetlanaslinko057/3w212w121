import { useState, useEffect } from 'react';
import { useAuth } from '@/App';
import {
  CheckCircle2,
  AlertCircle,
  Clock,
  TrendingUp,
  BarChart3,
  Star,
  Zap
} from 'lucide-react';
import { runtime } from '@/runtime';

// WEB-P4 — Backend Authority Contract.
// All performance metrics (totals, success rate, avg hours) come from
// `/api/developer/performance/summary`. Page renders JSON; no `.reduce`,
// `.filter` or `useMemo` for business state.
const DeveloperPerformance = () => {
  const { user } = useAuth();
  const [totals, setTotals] = useState({
    total_hours: 0,
    total_completed: 0,
    total_revisions: 0,
    success_rate_pct: 100,
    avg_hours_per_completed: 0,
  });
  const [completedRecent, setCompletedRecent] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await runtime.get('/api/developer/performance/summary');
        const data = res.data || {};
        setTotals(data.totals || totals);
        setCompletedRecent(Array.isArray(data.completed_recent) ? data.completed_recent : []);
      } catch (error) {
        console.error('Error:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-border border-t-signal rounded-full animate-spin" />
      </div>
    );
  }

  // presentation-only: clamp progress bar visual width to [0..100] of next-level threshold.
  // Server holds authoritative totals; this is pure CSS-width math.
  // eslint-disable-next-line no-restricted-syntax
  // presentation-only: CSS progress-bar visual width clamp [0..100]
  const progressPct = Math.min(Number(totals.total_hours) || 0, 100);

  return (
    <div className="min-h-screen p-8" data-testid="developer-performance">
      {/* Header */}
      <div className="relative mb-10">
        <h1 className="text-3xl font-semibold tracking-tight">Performance</h1>
        <p className="text-muted-foreground mt-2">Your stats and achievements</p>
      </div>

      {/* Profile Card */}
      <div className="rounded-2xl border border-border bg-signal/15 p-8 mb-8">
        <div className="flex items-start gap-6">
          <div className="w-20 h-20 rounded-2xl bg-signal/15 flex items-center justify-center shadow-lg shadow-signal/20">
            <span className="text-3xl font-bold text-white">
              {user?.name?.[0]?.toUpperCase() || 'D'}
            </span>
          </div>
          <div className="flex-1">
            <h2 className="text-2xl font-semibold">{user?.name || 'Developer'}</h2>
            <p className="text-muted-foreground mt-1">{user?.level || 'Junior'} Developer</p>
            <div className="flex items-center gap-6 mt-4">
              <div className="flex items-center gap-2">
                <Star className="w-4 h-4 text-amber-400" />
                <span className="text-muted-foreground">{user?.rating || '5.0'} rating</span>
              </div>
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-signal" />
                <span className="text-muted-foreground">{totals.total_hours}h total</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Grid (server-authored) */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Completed Tasks"
          value={totals.total_completed}
          icon={<CheckCircle2 className="w-5 h-5" />}
          color="emerald"
        />
        <StatCard
          label="Success Rate"
          value={`${totals.success_rate_pct}%`}
          icon={<TrendingUp className="w-5 h-5" />}
          color="blue"
        />
        <StatCard
          label="Revisions"
          value={totals.total_revisions}
          icon={<AlertCircle className="w-5 h-5" />}
          color="red"
          highlight={totals.total_revisions > 0}
        />
        <StatCard
          label="Avg Time"
          value={`${totals.avg_hours_per_completed}h`}
          icon={<Clock className="w-5 h-5" />}
          color="amber"
        />
      </div>

      {/* Total Hours Block */}
      <div className="rounded-2xl border border-border bg-[var(--t-surface-raised)] p-8 mb-8">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Total Hours Logged</div>
            <div className="text-5xl font-bold text-white">{totals.total_hours}<span className="text-2xl text-muted-foreground ml-2">hours</span></div>
          </div>
          <div className="w-16 h-16 rounded-2xl bg-signal/10 flex items-center justify-center">
            <BarChart3 className="w-8 h-8 text-signal" />
          </div>
        </div>

        {/* presentation-only: visual progress bar against next-tier hours */}
        <div className="mt-6">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-muted-foreground">Progress to next level</span>
            <span className="text-signal">{progressPct}/100h</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-signal/15 rounded-full transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Recent Completed (server-ordered, top 10) */}
      <div className="rounded-2xl border border-border bg-[var(--t-surface-raised)] overflow-hidden">
        <div className="px-6 py-5 border-b border-border flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          <h2 className="font-semibold">Recently Completed</h2>
        </div>

        <div className="p-4">
          {completedRecent.length === 0 ? (
            <div className="py-12 text-center">
              <div className="w-16 h-16 rounded-2xl bg-muted mx-auto mb-4 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground">No completed tasks yet</p>
              <p className="text-muted-foreground text-sm mt-1">Complete tasks to see them here</p>
            </div>
          ) : (
            <div className="space-y-2">
              {completedRecent.map((unit) => (
                <div
                  key={unit.unit_id}
                  className="p-4 rounded-xl border border-border bg-white/[0.02] flex items-center justify-between hover:bg-white/[0.04] transition-all"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div>
                      <span className="font-medium">{unit.title}</span>
                      <span className="text-muted-foreground text-sm ml-2">{unit.project_name}</span>
                    </div>
                  </div>
                  <span className="text-muted-foreground text-sm font-mono">{unit.actual_hours || 0}h</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const StatCard = ({ label, value, icon, color, highlight }) => {
  const colors = {
    blue: 'text-signal',
    emerald: 'text-emerald-400',
    amber: 'text-amber-400',
    red: 'text-red-400'
  };

  return (
    <div className={`p-5 rounded-2xl border bg-[var(--t-surface-raised)] transition-all ${
      highlight ? 'border-red-500/30 bg-signal/15' : 'border-border'
    }`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
        <span className={colors[color]}>{icon}</span>
      </div>
      <div className="text-3xl font-semibold text-white">{value}</div>
    </div>
  );
};

export default DeveloperPerformance;
