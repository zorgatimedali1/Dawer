import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FunnelChart, TimeSeriesChart } from '@/components/analytics-charts';
import type { FunnelResult, TimeseriesPoint } from '@/services/analytics.service';

function buildSeries(days: number): TimeseriesPoint[] {
  return Array.from({ length: days }, (_, index) => ({
    day: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
    participations: index,
    rewardsClaimed: 0,
    couponsRedeemed: 0,
    total: index,
  }));
}

describe('TimeSeriesChart', () => {
  it('renders a point per day', () => {
    const { container } = render(<TimeSeriesChart data={buildSeries(7)} />);
    const paths = container.querySelectorAll('path');

    // one area band + one stroke per series
    expect(paths.length).toBe(6);
    expect(screen.getByRole('img', { name: /daily campaign activity/i })).toBeInTheDocument();
  });

  it('renders one area band per series even when every value is zero', () => {
    const { container } = render(<TimeSeriesChart data={buildSeries(30)} />);
    expect(container.querySelectorAll('path')).toHaveLength(6);

    for (const path of container.querySelectorAll('path')) {
      expect(path.getAttribute('d')).toMatch(/^M/);
    }
  });

  it('shows an empty state instead of a chart', () => {
    render(<TimeSeriesChart data={[]} />);
    expect(screen.getByText(/no activity in this window/i)).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('labels a single-day window without dividing by zero', () => {
    const { container } = render(
      <TimeSeriesChart data={[{ day: '2026-01-01', participations: 5, rewardsClaimed: 0, couponsRedeemed: 0, total: 5 }]} />,
    );
    expect(container.querySelectorAll('path').length).toBe(6);
  });

  it('does not warn about duplicate keys when the peak is tiny', () => {
    // niceMax(1) -> 1, so naive rounding yields duplicate ticks (0,0,1,1,1).
    const data: TimeseriesPoint[] = Array.from({ length: 30 }, (_, index) => ({
      day: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
      participations: index === 15 ? 1 : 0,
      rewardsClaimed: 0,
      couponsRedeemed: 0,
      total: index === 15 ? 1 : 0,
    }));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<TimeSeriesChart data={data} />);
    const duplicateKeyWarnings = errorSpy.mock.calls.filter((args) =>
      String(args[0]).includes('same key'),
    );
    expect(duplicateKeyWarnings).toHaveLength(0);
    errorSpy.mockRestore();
  });
});

describe('FunnelChart', () => {
  const result: FunnelResult = {
    stages: [
      { key: 'participations', label: 'Played', value: 100, rateFromPrevious: 100 },
      { key: 'rewardsClaimed', label: 'Reward earned', value: 40, rateFromPrevious: 40 },
      { key: 'couponsRedeemed', label: 'Coupon redeemed', value: 10, rateFromPrevious: 25 },
    ],
    conversion: {
      participations: 100,
      rewardsClaimed: 40,
      couponsRedeemed: 10,
      uniqueCustomers: 80,
      rewardRate: 40,
      redemptionRate: 25,
      overallRate: 10,
    },
  };

  it('renders every stage with its value', () => {
    render(<FunnelChart result={result} />);
    expect(screen.getByText('Played')).toBeInTheDocument();
    expect(screen.getByText('Reward earned')).toBeInTheDocument();
    expect(screen.getByText('Coupon redeemed')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    // stage rate and the summary rate both read 40%
    expect(screen.getAllByText('40%').length).toBeGreaterThanOrEqual(1);
  });

  it('shows the summary rates', () => {
    render(<FunnelChart result={result} />);
    expect(screen.getByText('Reward rate')).toBeInTheDocument();
    expect(screen.getByText('Redemption rate')).toBeInTheDocument();
    expect(screen.getByText('Unique customers')).toBeInTheDocument();
  });

  it('renders an empty funnel without throwing', () => {
    const empty: FunnelResult = {
      stages: [
        { key: 'participations', label: 'Played', value: 0, rateFromPrevious: 100 },
        { key: 'rewardsClaimed', label: 'Reward earned', value: 0, rateFromPrevious: 0 },
        { key: 'couponsRedeemed', label: 'Coupon redeemed', value: 0, rateFromPrevious: 0 },
      ],
      conversion: {
        participations: 0,
        rewardsClaimed: 0,
        couponsRedeemed: 0,
        uniqueCustomers: 0,
        rewardRate: 0,
        redemptionRate: 0,
        overallRate: 0,
      },
    };

    render(<FunnelChart result={empty} />);
    expect(screen.getByText('Played')).toBeInTheDocument();
    expect(screen.getByText('Reward rate')).toBeInTheDocument();
  });
});
