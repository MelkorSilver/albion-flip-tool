import { useState, useRef, useEffect, useMemo } from "react";
import { generateAllItems, ITEM_NAMES } from "./data/items";
import "./App.css";

const CITIES = [
  "Lymhurst", "Bridgewatch", "FortSterling", "Martlock", "Thetford", "Caerleon", "Brecilien", "BlackMarket"
];

const CITY_LABELS = {
  Lymhurst: "Lymhurst", Bridgewatch: "Bridgewatch", FortSterling: "Fort Sterling", Martlock: "Martlock", Thetford: "Thetford", Caerleon: "Caerleon", Brecilien: "Brecilien", BlackMarket: "Black Market"
};

const TIER_COLORS = { 2: "#ffffff", 3: "#00c54a", 4: "#4a90d9", 5: "#b040e0", 6: "#e8a020", 7: "#e03030", 8: "#f0c030" };

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

const getTierLabel = (itemId) => {
  const m = itemId.match(/^T(\d)/);
  if (!m) return null;
  const t = parseInt(m[1]);
  const e = itemId.includes("@") ? parseInt(itemId.split("@")[1]) : 0;
  return { label: e > 0 ? `T${t}.${e}` : `T${t}`, color: TIER_COLORS[t] || "#fff" };
};



function BoughtItemsPanel({ boughtItems, toggleBought, QUALITY_NAMES }) {
  return (
    <div style={{width:"360px",background:"#111827",borderLeft:"1px solid #334155",display:"flex",flexDirection:"column"}}>
      <div style={{padding:"16px",borderBottom:"1px solid #334155"}}>
        <h2 style={{margin:0,color:"#fff"}}>ALINDI ({boughtItems.length})</h2>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"12px"}}>
        {boughtItems.length===0 ? (
          <div style={{color:"#94a3b8",textAlign:"center",marginTop:"30px"}}>Henüz işaretlenmiş eşya yok.</div>
        ) : boughtItems.map(item=>{
          const t=item.item?.match(/^T(\d)/)?.[1];
          const lbl=t?`T${t}${item.enchant?'.'+item.enchant:''}`:'';
          const colors={2:"#fff",3:"#00c54a",4:"#4a90d9",5:"#b040e0",6:"#e8a020",7:"#e03030",8:"#f0c030"};
          return (
            <div key={item.key} style={{display:"flex",marginBottom:"12px",background:"#0f172a",border:"1px solid #334155",borderRadius:"8px",overflow:"hidden"}}>
              <div style={{width:"5px",background:"#06b6d4"}}/>
              <div style={{padding:"10px",flex:1}}>
                <div style={{display:"flex",justifyContent:"space-between"}}>
                  <span style={{color:colors[t]||"#fff",fontWeight:"bold"}}>{lbl}</span>
                  <button onClick={()=>toggleBought(item)} style={{background:"#dc2626",border:"none",color:"#fff",borderRadius:"4px"}}>✕</button>
                </div>
                <div style={{color:"#fff",fontWeight:"bold",marginTop:"4px"}}>{item.name}</div>
                <div style={{color:"#94a3b8",fontSize:"12px"}}>{QUALITY_NAMES[item.quality]} | +{item.enchant}</div>
                <div style={{marginTop:"8px",fontSize:"13px"}}>
                  <div style={{color:"#22c55e"}}>Buy: {Number(item.buyPrice||0).toLocaleString()}</div>
                  <div style={{color:"#60a5fa"}}>Sell: {Number(item.sellPrice||0).toLocaleString()}</div>
                  <div style={{color:"#facc15"}}>Profit: {Number(item.profit||0).toLocaleString()}</div>
                </div>
              </div>
            </div>);
        })}
      </div>
    </div>);
}

export default function App() {
  const [buyCity, setBuyCity] = useState(() =>
  localStorage.getItem("buyCity") || "Lymhurst"
);

const [sellCity, setSellCity] = useState(() =>
  localStorage.getItem("sellCity") || "BlackMarket"
);

const [buyType, setBuyType] = useState(() =>
  localStorage.getItem("buyType") || "sell_price_min"
);

const [sellType, setSellType] = useState(() =>
  localStorage.getItem("sellType") || "buy_price_max"
);

const [minProfit, setMinProfit] = useState(() => {
  const saved = localStorage.getItem("minProfit");
  return saved === null ? 10 : Number(saved);
});
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingVolume, setLoadingVolume] = useState(false);
  const [progress, setProgress] = useState("");
  const [sortKey, setSortKey] = useState(() =>
  localStorage.getItem("sortKey") || "profitPercent"
);
  const [sortDir, setSortDir] = useState(() =>
  localStorage.getItem("sortDir") || "desc"
);
  const [qualityFilter, setQualityFilter] = useState(() =>
  JSON.parse(localStorage.getItem("qualityFilter") || "[1,2,3,4,5]")
);
  const [tierFilter, setTierFilter] = useState(() =>
  JSON.parse(localStorage.getItem("tierFilter") || "[2,3,4,5,6,7,8]")
);
  const [searchText, setSearchText] = useState(() =>
  localStorage.getItem("searchText") || ""
);
  const [enchantFilter, setEnchantFilter] = useState(() =>
  JSON.parse(localStorage.getItem("enchantFilter") || "[0,1,2,3,4]")
);
  const filteredData = useMemo(() => {
  return data.filter((row) => {
  const tier = Number(row.item.match(/T(\d)/)?.[1]);

  const matchesSearch =
    !searchText ||
    row.name.toLowerCase().includes(searchText.toLowerCase()) ||
    row.item.toLowerCase().includes(searchText.toLowerCase());

  return (
    qualityFilter.includes(row.quality) &&
    tierFilter.includes(tier) &&
    enchantFilter.includes(row.enchant) &&
    matchesSearch
  );

  });
}, [data, qualityFilter, tierFilter, enchantFilter, searchText]);
  const [boughtItems, setBoughtItems] = useState(() => {
  try {
    return JSON.parse(localStorage.getItem("boughtItems") || "[]");
  } catch {
    return [];
  }
});
  const [copiedItem, setCopiedItem] = useState(null);
  const boughtSet = useMemo(() => new Set(boughtItems.map(x=>x.key)), [boughtItems]);
  const dataRef = useRef([]);



  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(d => d === "desc" ? "asc" : "desc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const toggleQualityFilter = (q) => {
    setQualityFilter(prev =>
      prev.includes(q)
        ? prev.filter(x => x !== q)
        : [...prev, q].sort()
    );
  };
  const toggleTierFilter = (t) => {
    setTierFilter(prev =>
      prev.includes(t)
        ? prev.filter(x => x !== t)
        : [...prev, t].sort((a, b) => a - b)
    );
  };
  const toggleEnchantFilter = (enchant) => {
  setEnchantFilter((prev) =>
    prev.includes(enchant)
      ? prev.filter((e) => e !== enchant)
      : [...prev, enchant].sort((a, b) => a - b)
  );
  };
  const getRowKey = (row) =>
    `${row.item}_${row.quality}_${row.enchant}`;

  const toggleBought = (row) => {
    const key = getRowKey(row);

    setBoughtItems(prev => {
      if (prev.some(x => x.key === key)) {
        return prev.filter(x => x.key !== key);
      }

      return [
        ...prev,
        {
          ...row,
          key,
        },
      ];
    });
  };

  const copyItemId = async (itemId) => {
    try {
      await navigator.clipboard.writeText(itemId);

      setCopiedItem(itemId);

      setTimeout(() => {
        setCopiedItem(null);
      }, 1200);

    } catch (err) {
      console.error(err);
    }
  };

  const sortedData = useMemo(() => {
  return [...filteredData].sort((a, b) => {
    const mul = sortDir === "desc" ? -1 : 1;
    if (sortKey === "volume") {
      const av = a.volume === null ? -1 : a.volume;
      const bv = b.volume === null ? -1 : b.volume;
      return mul * (av - bv);
    }
    return mul * (a[sortKey] - b[sortKey]);

  });
}, [filteredData, sortKey, sortDir]);

  const SortIcon = ({ col }) => {
    if (sortKey !== col) return <span style={{ opacity: 0.3 }}> ↕</span>;
    return <span> {sortDir === "desc" ? "↓" : "↑"}</span>;
  };

  const getVolumeColor = (v) => {
    if (v > 200) return "#4ade80";
    if (v > 50) return "#facc15";
    return "#f87171";
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

          [1, 2, 3, 4, 5].forEach((q) => {
            const buyData = itemData.find((x) => normalize(x.city) === normalize(buyCity) && Number(x.quality) === q);
            const sellData = itemData.find((x) => normalize(x.city) === normalize(sellCity) && Number(x.quality) === q);

            if (!buyData || !sellData) return;

            const buyPrice = buyData[buyType];
            const sellPrice = sellData[sellType];
            const estimatedPrice = buyData.estimated_market_value || 0;

            if (!buyPrice || !sellPrice) return;

            const profit = sellPrice - buyPrice;
            const profitPercent = (profit / buyPrice) * 100;

            if (profitPercent < minProfit) return;

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
              estimatedPrice,
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
    setProgress(`✅ ${results.length} fırsat bulundu! Hacim için "Load Daily Volume" butonuna tıklayın.`);
    setLoading(false);
  };

  const runVolume = async () => {
    if (dataRef.current.length === 0) {
      alert("Önce 'Run Scan' butonuna tıklayın!");
      return;
    }

    setLoadingVolume(true);
    setProgress("Günlük hacimler yükleniyor...");

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
      setProgress(`Hacim yükleniyor: ${i + 1} / ${dataRef.current.length}`);
      await new Promise(r => setTimeout(r, 80));
    }

    setLoadingVolume(false);
    setProgress(`✅ Hacim verileri yüklendi!`);
  };

  return (
    <div style={{ display: "flex", height: "100vh", backgroundColor: "#0f172a" }}>
      {/* Main Content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div className="container" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <h1>Albion Arbitrage Tool</h1>

          {/* Controls */}
          <div className="controls">
            <div>
              <label>Buy City</label>
              <select value={buyCity} onChange={(e) => setBuyCity(e.target.value)}>
                {CITIES.map((c) => <option key={c} value={c}>{CITY_LABELS[c]}</option>)}
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
                {CITIES.map((c) => <option key={c} value={c}>{CITY_LABELS[c]}</option>)}
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
              <label>Min Profit %</label>
              <input
                type="number"
                value={minProfit}
                onChange={(e) => setMinProfit(Number(e.target.value))}
              />
            </div>

            <button onClick={runScan} disabled={loading || loadingVolume}>
              {loading ? "Taranıyor..." : "Run Scan"}
            </button>

            <button
              onClick={runVolume}
              disabled={loadingVolume || loading || data.length === 0}
              style={{ marginLeft: "10px", backgroundColor: loadingVolume ? "#666" : "#3b82f6" }}
            >
              {loadingVolume ? "Hacim Yükleniyor..." : "Load Daily Volume"}
            
</button>

<div style={{ marginBottom: "15px" }}>
            <input
              type="text"
              placeholder="🔍 Search Item..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              style={{
                width: "300px",
                padding: "10px",
                borderRadius: "6px",
                border: "1px solid #334155",
                background: "#1e293b",
                color: "white",
                fontSize: "14px",
              }}
            />
          </div>
          </div>

          {/* Quality Filter */}
          <div style={{ marginBottom: "10px", display: "flex", gap: "8px" }}>
            {[1, 2, 3, 4, 5].map((q) => (
              <button
                key={q}
                onClick={() => toggleQualityFilter(q)}
                style={{
                  padding: "8px 16px",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  backgroundColor: qualityFilter.includes(q) ? "#3b82f6" : "#475569",
                  color: "#fff",
                  fontSize: "12px",
                  fontWeight: qualityFilter.includes(q) ? "bold" : "normal",
                  opacity: qualityFilter.includes(q) ? 1 : 0.5,
                }}
              >
                {QUALITY_NAMES[q]}
              </button>
            ))}
          </div>

          <div style={{ marginBottom: "10px", display: "flex", gap: "8px" }}>
            {[2, 3, 4, 5, 6, 7, 8].map((t) => (
              <button
                key={t}
                onClick={() => toggleTierFilter(t)}
                style={{
                  padding: "8px 16px",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  backgroundColor: tierFilter.includes(t) ? "#8b5cf6" : "#475569",
                  color: "#fff",
                  fontSize: "12px",
                  fontWeight: tierFilter.includes(t) ? "bold" : "normal",
                  opacity: tierFilter.includes(t) ? 1 : 0.5,
                }}
              >
                T{t}
              </button>
            ))}
          </div>
                    <div style={{ marginBottom: "10px", display: "flex", gap: "8px" }}>
            {[0,1,2,3,4].map((enchant) => (
              <button
                key={enchant}
                onClick={() => toggleEnchantFilter(enchant)}
                style={{
                  padding: "8px 16px",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  backgroundColor: enchantFilter.includes(enchant) ? "#cbd5e1" : "#334155",
                  color: enchantFilter.includes(enchant) ? "#0f172a" : "#94a3b8",
                  fontSize: "12px",
                  fontWeight: enchantFilter.includes(enchant) ? "bold" : "normal",
                  opacity: enchantFilter.includes(enchant) ? 1 : 0.7,
                }}
              >
                .{enchant}
              </button>
            ))}
          </div>
                              {progress && (
            <div style={{ marginBottom: "10px", color: "#94a3b8" }}>{progress}</div>
          )}

          {/* Table */}
          <div style={{ flex: 1, overflow: "auto" }}>
            <table style={{ width: "100%" }}>
              <thead style={{ position:"sticky", top:0, zIndex:100, background:"#0f172a" }}>
                <tr>
                  <th>Item</th>
                  <th onClick={() => handleSort("estimatedPrice")} style={{ cursor: "pointer" }}>
                    Est. Price <SortIcon col="estimatedPrice" />
                  </th>
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
                  <th>Action</th>
                </tr>
              </thead>

              <tbody>
                {sortedData.map((row, i) => {
                  const isBought = boughtSet.has(getRowKey(row));
                  return (
                    <tr key={i}>
                      <td>
                        {(() => {
                          const tier = getTierLabel(row.item);

                          return (
                            <>
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "8px",
                                  fontWeight: "bold",
                                }}
                              >
                                {tier && (
                                  <span
                                    style={{
                                      color: tier.color,
                                      minWidth: "46px",
                                      fontWeight: "bold",
                                    }}
                                  >
                                    {tier.label}
                                  </span>
                                )}

                                <span
                                  onClick={() => copyItemId(row.item)}
                                  style={{
                                    cursor: "pointer",
                                    userSelect: "none",
                                  }}
                                >
                                  {row.name}

                                  {copiedItem === row.item && (
                                    <span
                                      style={{
                                        marginLeft: "8px",
                                        color: "#22c55e",
                                        fontSize: "11px",
                                      }}
                                    >
                                      ✓ Copied
                                    </span>
                                  )}
                                </span>
                              </div>

                              <small style={{ color: "#64748b" }}>
                                {QUALITY_NAMES[row.quality]} | +{row.enchant}
                              </small>
                            </>
                          );
                        })()}
                      </td>

                      <td>
                        {row.estimatedPrice.toLocaleString()}
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

                      <td style={{ color: row.profit >= 100000 ? "#22c55e" : row.profit >= 50000 ? "#4ade80" : row.profit >= 20000 ? "#facc15" : "#fb923c", fontWeight: "bold" }}>
                        {row.profit.toLocaleString()}
                      </td>

                      <td style={{ color: row.profitPercent >= 40 ? "#16a34a" : row.profitPercent >= 20 ? "#22c55e" : row.profitPercent >= 10 ? "#eab308" : row.profitPercent >= 5 ? "#f97316" : "#ef4444", fontWeight: "bold" }}>
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

                      <td>
                        <button
                          onClick={() => toggleBought(row)}
                          style={{
                            padding: "6px 12px",
                            border: "none",
                            borderRadius: "4px",
                            cursor: "pointer",
                            backgroundColor: isBought ? "#06b6d4" : "#64748b",
                            color: "#fff",
                            fontSize: "12px",
                            fontWeight: "bold",
                          }}
                        >
                          {isBought ? "ALINDI" : "AL"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Side Panel - Bought Items */}
      <BoughtItemsPanel
        boughtItems={boughtItems}
        toggleBought={toggleBought}
        QUALITY_NAMES={QUALITY_NAMES}
      />
    </div>
  );
}