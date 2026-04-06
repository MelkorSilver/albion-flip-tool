import { useState, useRef } from "react";
import { generateAllItems, ITEM_NAMES } from "./data/items";
import "./App.css";

const CITIES = [
  "Lymhurst",
  "Bridgewatch",
  "Fort Sterling",
  "Martlock",
  "Thetford",
  "Caerleon",
  "Black Market"
];

const BASE_URL = "https://europe.albion-online-data.com/api/v2";

const fetchPrices = async (items, locations) => {
  const url = `${BASE_URL}/stats/prices/${items}?locations=${locations}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("API error");
  return await res.json();
};

const fetchWeeklyAverageVolume = async (itemId, location, quality) => {
  const today = new Date();
  const endDate = today.toISOString().split("T")[0];

  const pastDate = new Date();
  pastDate.setDate(pastDate.getDate() - 7);
  const startDate = pastDate.toISOString().split("T")[0];

  const baseId = itemId.includes("@") ? itemId.split("@")[0] : itemId;

  const url = `${BASE_URL}/stats/history/${baseId}?locations=${location}&date=${endDate}&end_date=${startDate}&time-scale=24`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json();

    const entry = data.find(x => Number(x.quality) === Number(quality));
    if (!entry || !entry.data || !entry.data.length) return null;

    const total = entry.data.reduce((sum, d) => sum + (d.item_count || 0), 0);

    const avgDaily = total / 7;

    return Math.floor(avgDaily);

  } catch (err) {
    console.error(err);
    return null;
  }
};

const normalize = (c) => c.replace(/\s/g, "").toLowerCase();

const hoursAgo = (dateStr) => {
  if (!dateStr || dateStr.startsWith("0001")) return "?";
  const diff = (new Date() - new Date(dateStr)) / 1000 / 3600;
  if (diff < 1) return "0h";
  return `${Math.floor(diff)}h`;
};

const QUALITY_NAMES = {
  1: "Normal",
  2: "Good",
  3: "Outstanding",
  4: "Excellent",
  5: "Masterpiece"
};

const getItemName = (itemId) => {
  const baseId = itemId.includes("@") ? itemId.split("@")[0] : itemId;
  return ITEM_NAMES[baseId] || ITEM_NAMES[itemId] || itemId;
};

export default function App() {
  const [buyCity, setBuyCity] = useState("Lymhurst");
  const [sellCity, setSellCity] = useState("BlackMarket");
  const [buyType, setBuyType] = useState("sell_price_min");
  const [sellType, setSellType] = useState("buy_price_max");
  const [minProfit, setMinProfit] = useState(0);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [sortKey, setSortKey] = useState("profitPercent");
  const [sortDir, setSortDir] = useState("desc");
  const dataRef = useRef([]);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(d => d === "desc" ? "asc" : "desc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sortedData = [...data].sort((a, b) => {
    const mul = sortDir === "desc" ? -1 : 1;
    if (sortKey === "volume") {
      const av = a.volume === null ? -1 : a.volume;
      const bv = b.volume === null ? -1 : b.volume;
      return mul * (av - bv);
    }
    return mul * (a[sortKey] - b[sortKey]);
  });

  const SortIcon = ({ col }) => {
    if (sortKey !== col) return <span style={{ opacity: 0.3 }}> ↕</span>;
    return <span> {sortDir === "desc" ? "↓" : "↑"}</span>;
  };

  // ✅ volume renk sistemi
  const getVolumeColor = (v) => {
    if (v > 200) return "#4ade80";   // high
    if (v > 50) return "#facc15";    // medium
    return "#f87171";                // low
  };

  const runScan = async () => {
    setLoading(true);
    setData([]);
    dataRef.current = [];
    setProgress("Eşyalar yükleniyor...");

    const items = generateAllItems();
    const batchSize = 100;
    const locations = `${buyCity},${sellCity}`;
    let results = [];
    const totalBatches = Math.ceil(items.length / batchSize);

    // 1. Fiyat tarama
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const currentBatch = Math.floor(i / batchSize) + 1;
      setProgress(`Fiyatlar taranıyor: ${currentBatch} / ${totalBatches}`);

      try {
        const json = await fetchPrices(batch.join(","), locations);

        batch.forEach((item) => {
          const itemData = json.filter((x) => x.item_id === item);
          const enchant = item.includes("@") ? Number(item.split("@")[1]) : 0;

          [1, 2, 3, 4, 5].forEach((q) => {
            const buyData = itemData.find((x) => normalize(x.city) === normalize(buyCity) && Number(x.quality) === q);
            const sellData = itemData.find((x) => normalize(x.city) === normalize(sellCity) && Number(x.quality) === q);

            if (!buyData || !sellData) return;

            const buyPrice = buyData[buyType];
            const sellPrice = sellData[sellType];

            if (!buyPrice || !sellPrice) return;

            const profit = sellPrice - buyPrice;
            const profitPercent = (profit / buyPrice) * 100;

            if (profit < minProfit) return;

            const buyDate = buyType === "sell_price_min"
              ? buyData.sell_price_min_date
              : buyData.buy_price_max_date;

            const sellDate = sellType === "buy_price_max"
              ? sellData.buy_price_max_date
              : sellData.sell_price_min_date;

            results.push({
              item,
              name: getItemName(item),
              buyPrice,
              sellPrice,
              profit,
              profitPercent,
              quality: q,
              enchant,
              buyAge: hoursAgo(buyDate),
              sellAge: hoursAgo(sellDate),
              volume: null,
            });
          });
        });

      } catch (err) {
        console.error(`Batch ${currentBatch} error:`, err);
      }

      await new Promise(r => setTimeout(r, 100));
    }

    dataRef.current = results;
    setData([...results]);
    setProgress(`${results.length} fırsat bulundu. Günlük hacimler yükleniyor...`);

    // 2. Volume
    const seen = new Set();

    for (let i = 0; i < dataRef.current.length; i++) {
      const row = dataRef.current[i];
      const key = `${row.item}_${row.quality}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const count = await fetchWeeklyAverageVolume(row.item, sellCity, row.quality);

      dataRef.current = dataRef.current.map(r =>
        r.item === row.item && r.quality === row.quality
          ? { ...r, volume: count }
          : r
      );

      setData([...dataRef.current]);
      await new Promise(r => setTimeout(r, 80));
    }

    setLoading(false);
    setProgress(`Tamamlandı! ${results.length} fırsat bulundu.`);
  };

  return (
    <div className="container">
      <h1>Albion Arbitrage Tool</h1>

      <div className="controls">
        <div>
          <label>Buy City</label>
          <select value={buyCity} onChange={(e) => setBuyCity(e.target.value)}>
            {CITIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>

        <div>
          <label>Buy Price Type</label>
          <select value={buyType} onChange={(e) => setBuyType(e.target.value)}>
            <option value="sell_price_min">Sell Min</option>
            <option value="buy_price_max">Buy Max</option>
          </select>
        </div>

        <div>
          <label>Sell City</label>
          <select value={sellCity} onChange={(e) => setSellCity(e.target.value)}>
            {CITIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>

        <div>
          <label>Sell Price Type</label>
          <select value={sellType} onChange={(e) => setSellType(e.target.value)}>
            <option value="buy_price_max">Buy Max</option>
            <option value="sell_price_min">Sell Min</option>
          </select>
        </div>

        <div>
          <label>Min Profit</label>
          <input
            type="number"
            value={minProfit}
            onChange={(e) => setMinProfit(Number(e.target.value))}
          />
        </div>

        <button onClick={runScan} disabled={loading}>
          {loading ? "Taranıyor..." : "Run Scan"}
        </button>
      </div>

      {progress && (
        <div style={{ marginBottom: "10px", color: "#94a3b8" }}>{progress}</div>
      )}

      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th onClick={() => handleSort("buyPrice")} style={{ cursor: "pointer" }}>
              Buy <SortIcon col="buyPrice" />
            </th>
            <th onClick={() => handleSort("sellPrice")} style={{ cursor: "pointer" }}>
              Sell <SortIcon col="sellPrice" />
            </th>
            <th onClick={() => handleSort("profit")} style={{ cursor: "pointer" }}>
              Profit <SortIcon col="profit" />
            </th>
            <th onClick={() => handleSort("profitPercent")} style={{ cursor: "pointer" }}>
              Profit % <SortIcon col="profitPercent" />
            </th>
            <th onClick={() => handleSort("volume")} style={{ cursor: "pointer" }}>
              Günlük Hacim <SortIcon col="volume" />
            </th>
          </tr>
        </thead>

        <tbody>
          {sortedData.map((row, i) => (
            <tr key={i}>
              <td>
                <div>{row.name}</div>
                <small style={{ color: "#64748b" }}>
                  {QUALITY_NAMES[row.quality]} | +{row.enchant}
                </small>
              </td>

              <td>
                {row.buyPrice.toLocaleString()}
                <span style={{ color: "#64748b", fontSize: "11px", marginLeft: "4px" }}>
                  {row.buyAge}
                </span>
              </td>

              <td>
                {row.sellPrice.toLocaleString()}
                <span style={{ color: "#64748b", fontSize: "11px", marginLeft: "4px" }}>
                  {row.sellAge}
                </span>
              </td>

              <td style={{ color: row.profit > 0 ? "#4ade80" : "#f87171" }}>
                {row.profit.toLocaleString()}
              </td>

              <td style={{ color: row.profit > 0 ? "#4ade80" : "#f87171" }}>
                {row.profitPercent.toFixed(2)}%
              </td>

              <td>
                {row.volume === null ? (
                  <span style={{ opacity: 0.4 }}>...</span>
                ) : (
                  <span style={{ color: getVolumeColor(row.volume) }}>
                    {row.volume.toFixed(0)}/d
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}