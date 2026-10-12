export interface MarketUpdate {
  instrument: string;

  priceCents: number;
  tradeQuantity: number;

  bidCents: number;
  askCents: number;

  bidQuantity: number;
  askQuantity: number;
}
