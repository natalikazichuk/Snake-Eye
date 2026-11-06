/**
 * Snake Eye — what every number on the stock page means, shown on hover.
 *
 * Keyed by the exact label the page prints, so a label and its explanation
 * cannot drift apart silently: tests/glossary.test.mjs checks that every score
 * item has an entry.
 */

const SMA = 'Simple moving average: the mean closing price over the last N sessions.';

export const GLOSSARY = {
  /* ------------------------------------------------------------ score */
  'Snake Score':
    'One 0–100 number for how well the stock fits the scanner\'s setup: technical 40%, momentum 25%, volume 20%, ' +
    'fundamental 15%. It measures fit to the criteria, not where the price will go.',
  Technical: 'Trend structure: where the price sits against its moving averages, how they are stacked, and how strong the trend is.',
  Momentum: 'Whether the move is speeding up or fading, read from MACD, the Awesome Oscillator and RSI.',
  Volume: 'Whether traders are actually participating: today\'s volume against normal, and how liquid the stock is.',
  Fundamental: 'The business behind the ticker: growth, profitability, valuation and leverage from annual filings.',

  'Price > SMA20': `Short-term trend. Price above its 20-day average means the last month leans up. ${SMA}`,
  'Price > SMA50': `Medium-term trend: price above its 50-day (about 10 weeks) average. ${SMA}`,
  'Price > SMA200': `Long-term trend: price above its 200-day (about 10 months) average — the line most traders watch. ${SMA}`,
  'SMA20 > SMA50': 'The short average above the medium one: the recent trend is stronger than the older one.',
  'SMA50 > SMA200': 'The 50-day above the 200-day. Crossing up is called a "golden cross", crossing down a "death cross".',
  'ADX trend strength':
    'Average Directional Index, 0–100: how strong the trend is, not which way. Below 20 is a range, above 25 a trend, above 40 a strong one.',
  'Upper half of Bollinger range':
    'Price in the upper part of its Bollinger Bands (%B above 0.5): it has been closing near the top of its recent range.',

  'MACD above signal':
    'MACD (the 12-day EMA minus the 26-day EMA) above its 9-day signal line: short-term momentum is beating the longer trend.',
  'MACD histogram rising': 'The gap between MACD and its signal line is widening upward: momentum is building, not fading.',
  'Awesome Oscillator > 0': 'The 5-bar average of the midpoint price is above the 34-bar one: buyers have the upper hand.',
  'Awesome Oscillator rising': 'The oscillator bar is higher than the one before: momentum is improving.',
  'RSI in the healthy band':
    'Relative Strength Index between 45 and 65 earns full credit: strong enough to trend, not yet stretched. Above 70 is overbought, below 30 oversold.',

  'Relative volume': 'Today\'s volume divided by the 20-day average. 1.0x is a normal day; 2x means twice the usual trading.',
  'Average volume (liquidity)':
    'Shares traded per day on average over 20 sessions. Under about 100K is thin — wide spreads and hard exits; 5M+ is fully liquid.',
  'Volume vs 50-day average': 'Today\'s volume against the 50-day average: a surge on a move gives it conviction.',

  'Revenue growth': 'Change in annual revenue against the year before, from the latest annual filing.',
  'Positive EPS': 'Earnings per share above zero: the company made a profit in its last fiscal year.',
  'EPS growth': 'Change in earnings per share against the year before.',
  'Valuation (P/E)':
    'Price divided by earnings per share: how many years of current profit the price pays for. Lower is cheaper; it means little for loss makers.',
  'Return on equity': 'Net income divided by shareholders\' equity: how much profit the company makes on the owners\' capital. Above 15% is strong.',
  'Debt / equity': 'Total liabilities against shareholders\' equity. Above 2 is heavily leveraged; under 0.5 is conservative.',

  /* ------------------------------------------------------- indicators */
  'RSI (14)': 'Relative Strength Index over 14 sessions, 0–100. Above 70 is overbought, below 30 oversold, 45–65 a healthy trend.',
  MACD: 'Moving Average Convergence Divergence: the 12-day EMA minus the 26-day EMA. Positive means the short trend is above the long one.',
  'Awesome Osc.': 'Awesome Oscillator: 5-bar minus 34-bar average of the midpoint price. Above zero is bullish momentum, below is bearish.',
  'ADX (14)': 'Average Directional Index: trend strength, 0–100, regardless of direction. Above 25 is a trend.',
  'ATR (14)': 'Average True Range: how far the price typically moves in a day, in dollars and as a percent of price. A volatility gauge and a common stop distance.',
  'Rel. volume': 'Today\'s volume divided by the 20-day average. Above 1.5x is unusual interest.',
  'MACD signal': 'A 9-day EMA of the MACD line. MACD crossing above it is a classic buy signal, crossing below a sell signal.',
  'MACD histogram': 'MACD minus its signal line. Above zero and growing means momentum is accelerating.',
  '+DI / -DI': 'Directional indicators behind ADX. +DI above -DI: up-moves dominate; -DI above +DI: down-moves dominate.',
  'Stochastic %K / %D':
    'Where the close sits in the last 14 sessions\' high–low range, 0–100 (%D is its 3-day average). Above 80 overbought, below 20 oversold.',
  'Bollinger upper': 'The 20-day average plus two standard deviations. Price above it is statistically stretched.',
  'Bollinger middle': 'The 20-day simple moving average the bands are built around.',
  'Bollinger lower': 'The 20-day average minus two standard deviations. Price below it is statistically washed out.',
  'Bollinger %B': 'Where the price sits between the bands: 0 = lower band, 1 = upper band, above 1 = outside the top.',

  'SMA 20': `20-day simple moving average — the short-term trend. ${SMA}`,
  'SMA 50': `50-day simple moving average — the medium-term trend. ${SMA}`,
  'SMA 200': `200-day simple moving average — the long-term trend. ${SMA}`,
  'EMA 20': '20-day exponential moving average: like the SMA but weights recent days more, so it turns sooner.',
  'EMA 50': '50-day exponential moving average.',
  'EMA 200': '200-day exponential moving average.',

  'Average volume (20d)': 'Mean daily share volume over the last 20 sessions.',
  'Average volume (50d)': 'Mean daily share volume over the last 50 sessions.',
  '52-week high': 'The highest price of the last year (252 sessions).',
  '52-week low': 'The lowest price of the last year.',
  '% of 52-week high': 'Current price as a share of the 52-week high. Near 100% the stock is at its highs; under 70% it is well off them.',

  'Market cap': 'Share price times shares outstanding: what the market values the whole company at.',
  'Revenue (TTM)': 'Total sales in the last reported fiscal year.',
  EPS: 'Earnings per share: net income divided by shares outstanding.',
  'P/E': 'Price-to-earnings: the price divided by EPS. Lower is cheaper; it is undefined when earnings are negative.',
  'P/S': 'Price-to-sales: market cap divided by annual revenue. Useful when there are no earnings yet.',
  ROE: 'Return on equity: net income divided by shareholders\' equity.',
  'Gross margin': 'Revenue minus the cost of goods sold, as a percent of revenue.',
  'Operating margin': 'Operating income as a percent of revenue: what is left after running the business, before interest and tax.',
  'Current ratio': 'Current assets divided by current liabilities. Under 1 can mean short-term cash pressure.',

  /* ----------------------------------------------------------- charts */
  Price: 'Daily closing price with its 20-, 50- and 200-day moving averages.',
  'RSI chart': 'RSI over time. The dashed lines mark 70 (overbought) and 30 (oversold).',
  'MACD chart': 'MACD line, its signal line, and the histogram of the gap between them.',
  'AO chart': 'Awesome Oscillator bars: green when higher than the bar before, red when lower.',
};

/** The explanation for a label, or null when there is none. */
export function explain(label) {
  return GLOSSARY[label] || null;
}
