export function calculateProfit(buyPrice, bmPrice) {
  const profit = bmPrice - buyPrice;
  const profitPercent = buyPrice > 0 ? (profit / buyPrice) * 100 : 0;

  return { profit, profitPercent };
}