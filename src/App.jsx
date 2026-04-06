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

const BASE_URL = "[europe.albion-online-data.com](https://europe.albion-online-data.com/api/v2)";

const fetchPrices = async (items, locations) => {
  const url = `${BASE_URL}/stats/prices/${items}?locations=${locations}&qualities=1,2,3,4,5`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("API error");
  return await res.json();
};

const fetchHistory = async (itemId, location) => {
  const baseId = itemId.includes("@") ? itemId.split("@")[0] : itemId;
  const url = `${BASE_URL}/stats/history/${baseId}?locations=${location}&time-scale=24`;
  try {
    const res = await fetch(url);
    if (!res.ok) return {};
    const data = await res.json();
    
    // Quality bazında günlük satış miktarlarını topla
    const volumeByQuality = {};
    data.forEach(entry => {
      const q = Number(entry.quality);
      if (entry.data && entry.data.length > 0) {
        // Son 24 saatteki toplam satış
        const totalCount = entry.data.reduce((sum, d) => sum + (d.item_count || 0), 0);
        volumeByQuality[q] = totalCount;
      }
    });
    return volumeByQuality;
  } catch {
    return {};
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
  const [sellCity, setSellCity] = useState("Black Market");
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

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const currentBatch = Math.floor(i / batchSize) + 1;
      setProgress(`Fiyatlar taranıyor: ${currentBatch} / ${totalBatches}`);

      try {
        const json = await fetchPrices(batch.join(","), locations);

        batch.forEach((item) => {
          const itemData = json.filter((x) => x.item_id === item);
          const enchant = item.includes("@") ? Number(item.split("@")[1]) : 0;

          // Tüm quality'leri kontrol et
          [1, 2, 3, 4, 5].forEach((q) => {
            const buyData = itemData.find(
              (x) => normalize(x.city) === normalize(buyCity) && Number(x.quality) === q
            );
            const sellData = itemData.find(
              (x) => normalize(x.city) === normalize(sellCity) && Number(x.quality) === q
            );

            if (!buyData || !sellData) return;

            const buyPrice = buyData[buyType];
            const sellPrice = sellData[sellType];

            if (!buyPrice || !sellPrice || buyPrice === 0 || sellPrice === 0) return;

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
              buyPrice, sellPrice, profit, profitPercent,
              quality: q, enchant,
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
    setProgress(`${results.length} fırsat bulundu. Günlük satış miktarları yükleniyor...`);

    // Volume'ları çek - her item için bir kez
    const itemsToFetch = [...new Set(results.map(r => r.item))];
    
    for (let i = 0; i < itemsToFetch.length; i++) {
      const item = itemsToFetch[i];
      setProgress(`Günlük satışlar: ${i + 1} / ${itemsToFetch.length}`);
      
      const volumeByQuality = await fetchHistory(item, sellCity);

      dataRef.current = dataRef.current.map(r => {
        if (r.item === item) {
          return { ...r, volume: volumeByQuality[r.quality] ?? 0 };
        }
        return r;
      });
      setData([...dataRef.current]);

      await new Promise(r => setTimeout(r, 50));
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
              Günlük Satış <SortIcon col="volume" />
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
                {row.volume === null
                  ? <span style={{ opacity: 0.4 }}>...</span>
                  : row.volume === 0
                    ? <span style={{ color: "#94a3b8" }}>0</span>
                    : <span style={{ color: row.volume > 50 ? "#4ade80" : row.volume > 10 ? "#facc15" : "#94a3b8" }}>
                        {row.volume.toLocaleString()}
                      </span>
                }
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
