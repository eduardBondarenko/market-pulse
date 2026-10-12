export interface MarketMetrics {
  instrument: string;

  lastPriceCents: number | null;

  volume: number;
  totalPriceQuantity: number;

  bidCents: number | null;
  askCents: number | null;

  bidQuantity: number | null;
  askQuantity: number | null;
}
