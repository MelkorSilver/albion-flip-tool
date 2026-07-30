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

const HISTORY_BATCH_SIZE = 40;
const HISTORY_BATCH_DELAY = 150;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(url, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();

    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (res.ok) return res;

      if (res.status === 429 || res.status >= 500) {
        if (attempt === retries) return null;

        const delay =
          1000 * Math.pow(2, attempt) +
          Math.random() * 500;

        await sleep(delay);
        continue;
      }

      return null;
    } catch (err) {
      clearTimeout(timeout);

      if (attempt === retries) return null;

      const delay =
        1000 * Math.pow(2, attempt) +
        Math.random() * 500;

      await sleep(delay);
    }
  }

  return null;
}


async function runQueue(tasks, concurrency = 8, onProgress = () => {}) {
    const results = new Array(tasks.length);

    let nextIndex = 0;
    let completed = 0;

    async function worker() {
      while (true) {
        const current = nextIndex++;

        if (current >= tasks.length) return;

        try {
          results[current] = await tasks[current]();
        } catch {
          results[current] = null;
        }

        completed++;

        if (completed % 10 === 0 || completed === tasks.length) onProgress(completed, tasks.length);
      }
    }

    await Promise.all(
      Array.from({ length: concurrency }, worker)
    );

    return results;
  }


const fetchPrices = async (items, locations) => {
  const url = `${BASE_URL}/stats/prices/${items}?locations=${locations}`;
  const res = await fetchWithRetry(url);
  if (!res) throw new Error("API error");
  return await res.json();
};

const getAverageDays = (period) => {
    if (period === "24h") return 1;
    if (period === "4w") return 28;
    return 7;
};

const calculateMarketStats = (rows) => {

    if (!rows?.length) {
        return {
            averagePrice: null,
            averageVolume: null,
        };
    }

    let totalPrice = 0;
    let totalCount = 0;
    let totalVolume = 0;

    for (const row of rows) {

        const count = Number(row.item_count || 0);
        const price = Number(row.avg_price || 0);

        totalPrice += price * count;
        totalCount += count;
        totalVolume += count;

    }

    return {

        averagePrice:
            totalCount
                ? Math.round(totalPrice / totalCount)
                : null,

        averageVolume:
            Math.floor(totalVolume / rows.length),

    };

};

const fetchHistory = async (
  itemId,
  location,
  quality,
  period,
  cache
) => {
  const baseId =
    itemId.includes("@")
      ? itemId.split("@")[0]
      : itemId;

  const today = new Date();
  const endDate = today.toISOString().split("T")[0];

  const start = new Date();
  start.setDate(start.getDate() - getAverageDays(period));
  const startDate = start.toISOString().split("T")[0];

  const key = `${baseId}_${location}_${quality}_${startDate}_${endDate}`;

  const cached = cache.current.get(key);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  } else if (cached) {
    cache.current.delete(key);
  }

  const url =
`${BASE_URL}/stats/history/${baseId}?locations=${location}&qualities=${quality}&date=${startDate}&end_date=${endDate}&time-scale=24`;

  try {
    const res = await fetchWithRetry(url);
    if (!res) return null;

    const json = await res.json();

    const entry = json.find(
      x => Number(x.quality) === Number(quality)
    );

    if (!entry) return null;

    cache.current.set(key, {
      data: entry,
      expires: Date.now() + 5 * 60 * 1000,
    });

    return entry;

  } catch {
    return null;
  }
};


const processHistoryBatches = async ({
  uniqueRows,rowIndex,period,sellCity,historyCache,dataRef,setData,setProgress
})=>{
  for(let i=0;i<uniqueRows.length;i+=HISTORY_BATCH_SIZE){
    const batch=uniqueRows.slice(i,i+HISTORY_BATCH_SIZE);

    const tasks=batch.map(row=>async()=>{
      const history=await fetchHistory(row.item,sellCity,row.quality,period,historyCache);
      return {
        row,
        stats: history?.data?.length ? calculateMarketStats(history.data) : null
      };
    });

    const results=(await runQueue(tasks,6)).filter(Boolean);

    results.forEach(r=>{
      const idx=rowIndex.get(`${r.row.item}_${r.row.quality}`);
      if(idx===undefined) return;
      const target=dataRef.current[idx];

      target.averagePrice=r.stats?.averagePrice??null;
      target.averageDiff=target.averagePrice!=null
        ? ((target.buyPrice-target.averagePrice)/target.averagePrice)*100
        : null;

      target.volume=r.stats?.averageVolume??null;
      target.dailyProfit=target.volume!=null
        ? target.profit*target.volume
        : null;
    });

    if(((i/HISTORY_BATCH_SIZE)%8)===7||i+HISTORY_BATCH_SIZE>=uniqueRows.length){
      setData([...dataRef.current]);
    }

    setProgress(`Market Stats ${Math.min(i+batch.length,uniqueRows.length)} / ${uniqueRows.length}`);
    await sleep(HISTORY_BATCH_DELAY);
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

  const [averagePeriod, setAveragePeriod] = useState(() =>
    localStorage.getItem("averagePeriod") || "7d"
  );

const historyCache = useRef(new Map());
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
  const [itemsPerPage, setItemsPerPage] = useState(() => Number(localStorage.getItem("itemsPerPage") || 100));
  const [currentPage, setCurrentPage] = useState(1);
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

  const copyItemName = async (itemName) => {
    try {
      await navigator.clipboard.writeText(itemName);

      setCopiedItem(itemName);

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
    if (
      sortKey === "volume" ||
      sortKey === "averagePrice" ||
      sortKey === "averageDiff" ||
      sortKey === "dailyProfit"
    ) {
      const av = a[sortKey] == null ? -1 : a[sortKey];
      const bv = b[sortKey] == null ? -1 : b[sortKey];

      return mul * (av - bv);
    }
    return mul * (a[sortKey] - b[sortKey]);

  });
}, [filteredData, sortKey, sortDir]);

  useEffect(() => { localStorage.setItem("itemsPerPage", itemsPerPage); }, [itemsPerPage]);
  useEffect(() => { setCurrentPage(1); }, [searchText, qualityFilter, tierFilter, enchantFilter, sortKey, sortDir, itemsPerPage]);
  useEffect(() => {
    localStorage.setItem("averagePeriod", averagePeriod);
  }, [averagePeriod]);

  useEffect(()=>localStorage.setItem("buyCity",buyCity),[buyCity]);
  useEffect(()=>localStorage.setItem("sellCity",sellCity),[sellCity]);
  useEffect(()=>localStorage.setItem("buyType",buyType),[buyType]);
  useEffect(()=>localStorage.setItem("sellType",sellType),[sellType]);
  useEffect(()=>localStorage.setItem("minProfit",String(minProfit)),[minProfit]);
  useEffect(()=>localStorage.setItem("sortKey",sortKey),[sortKey]);
  useEffect(()=>localStorage.setItem("sortDir",sortDir),[sortDir]);
  useEffect(()=>localStorage.setItem("searchText",searchText),[searchText]);
  useEffect(()=>localStorage.setItem("qualityFilter",JSON.stringify(qualityFilter)),[qualityFilter]);
  useEffect(()=>localStorage.setItem("tierFilter",JSON.stringify(tierFilter)),[tierFilter]);
  useEffect(()=>localStorage.setItem("enchantFilter",JSON.stringify(enchantFilter)),[enchantFilter]);
  useEffect(()=>localStorage.setItem("boughtItems",JSON.stringify(boughtItems)),[boughtItems]);

  const totalPages = Math.max(1, Math.ceil(sortedData.length / itemsPerPage));
  const pageStart = (currentPage - 1) * itemsPerPage;
  const displayData = sortedData.slice(pageStart, pageStart + itemsPerPage);

  const SortIcon = ({ col }) => {
    if (sortKey !== col) return <span style={{ opacity: 0.3 }}> ↕</span>;
    return <span> {sortDir === "desc" ? "↓" : "↑"}</span>;
  };

  const getVolumeColor = (v) => {
    if (v >= 500) return "#16a34a";
    if (v >= 250) return "#22c55e";
    if (v >= 100) return "#84cc16";
    if (v >= 50) return "#eab308";
    if (v >= 20) return "#f97316";
    return "#ef4444";
  };

  const runScan = async () => {
    setLoading(true);
    setData([]);
    dataRef.current = [];
    setProgress("Eşyalar yükleniyor...");

    const items = generateAllItems();
    const batchSize = 300;
    const locations = `${buyCity},${sellCity}`;
    let results = [];
    const totalBatches = Math.ceil(items.length / batchSize);

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const currentBatch = Math.floor(i / batchSize) + 1;
      setProgress(`Fiyatlar taranıyor: ${currentBatch} / ${totalBatches}`);

      try {
        const json = await fetchPrices(batch.join(","), locations);
        const lookup = new Map();

        for (const row of json) {
          lookup.set(`${row.item_id}|${normalize(row.city)}|${row.quality}`, row);
        }

        batch.forEach((item) => {
          const enchant = item.includes("@") ? Number(item.split("@")[1]) : 0;

          for (let q = 1; q <= 5; q++) {
            const buyData = lookup.get(`${item}|${normalize(buyCity)}|${q}`);
            const sellData = lookup.get(`${item}|${normalize(sellCity)}|${q}`);

            if (!buyData || !sellData) continue;

            const buyPrice = buyData[buyType];
            const sellPrice = sellData[sellType];

            if (!buyPrice || !sellPrice) continue;

            const profit = sellPrice - buyPrice;
            const profitPercent = (profit / buyPrice) * 100;

            if (profitPercent < minProfit) continue;

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
              averagePrice: null,
              averageDiff: null,
              dailyProfit: null,
            });
          }
        });

      } catch (err) {
        console.error(`Batch ${currentBatch} error:`, err);
      }

      await sleep(25);
    }

    dataRef.current = results;
    setData([...results]);
    setProgress(`✅ ${results.length} fırsat bulundu! Hacim için "Load Market Stats" butonuna tıklayın.`);
    setLoading(false);
  };

  const runMarketStats = async () => {
    if (dataRef.current.length === 0) {
      alert("Önce 'Run Scan' butonuna tıklayın!");
      return;
    }
    setLoadingVolume(true);
    setProgress("Loading Market Stats...");
    const seen=new Map();
    for(const row of dataRef.current){
      const key=`${row.item}_${row.quality}`;
      if(!seen.has(key)) seen.set(key,row);
    }
    const uniqueRows=[...seen.values()];
    const rowIndex=new Map();
    dataRef.current.forEach((row,index)=>rowIndex.set(`${row.item}_${row.quality}`,index));
    const progressFn=(msg)=>{
      const m=msg.match(/(\d+)\s*\/\s*(\d+)/);
      if(m) setProgress(`Loading Market Stats...\n\n${m[1]} of ${m[2]} items processed`);
    };
    await processHistoryBatches({
      uniqueRows,
      rowIndex,
      period:averagePeriod,
      sellCity,
      historyCache,
      dataRef,
      setData,
      setProgress:progressFn
    });
    setLoadingVolume(false);
    setProgress("✅ Market stats loaded!");
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
              onClick={runMarketStats}
              disabled={loadingVolume || loading || data.length === 0}
              style={{
                marginLeft: "10px",
                backgroundColor: loadingVolume ? "#666" : "#3b82f6"
              }}
            >
              {loadingVolume ? "Loading Market Stats..." : "Load Market Stats"}
            </button>

            <select
              value={averagePeriod}
              onChange={(e) => setAveragePeriod(e.target.value)}
              style={{ marginLeft: "10px" }}
            >
              <option value="24h">24h</option>
              <option value="7d">7 Days</option>
              <option value="4w">4 Weeks</option>
            </select>

            

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

          <div style={{display:"flex",justifyContent:"flex-end",alignItems:"center",gap:"12px",marginBottom:"10px",color:"#fff"}}>
<span>Items/Page:</span>
<select value={itemsPerPage} onChange={(e)=>setItemsPerPage(Number(e.target.value))} style={{padding:"6px",background:"#1e293b",color:"#fff",border:"1px solid #334155",borderRadius:"6px"}}>
{[100,250,500,1000].map(n=><option key={n} value={n}>{n}</option>)}
</select>
<span>{sortedData.length===0?0:pageStart+1}-{Math.min(pageStart+itemsPerPage,sortedData.length)} / {sortedData.length}</span>
<button onClick={()=>setCurrentPage(1)} disabled={currentPage===1}>⏮</button>
<button onClick={()=>setCurrentPage(p=>Math.max(1,p-1))} disabled={currentPage===1}>◀</button>
<span>{currentPage}/{totalPages}</span>
<button onClick={()=>setCurrentPage(p=>Math.min(totalPages,p+1))} disabled={currentPage===totalPages}>▶</button>
<button onClick={()=>setCurrentPage(totalPages)} disabled={currentPage===totalPages}>⏭</button>
</div>

          {/* Table */}
          <div style={{ flex: 1, overflow: "auto" }}>
            <table style={{ width: "100%" }}>
              <thead style={{ position:"sticky", top:0, zIndex:100, background:"#0f172a" }}>
                <tr>
                  <th>Item</th>
                  <th onClick={() => handleSort("averagePrice")} style={{ cursor: "pointer" }}>
                    Avg Price <SortIcon col="averagePrice" />
                  </th>

                  <th onClick={() => handleSort("volume")} style={{ cursor: "pointer" }}>
                    Daily Volume <SortIcon col="volume" />
                  </th>
                  <th onClick={() => handleSort("dailyProfit")} style={{ cursor: "pointer" }}>
                    Profit × Volume <SortIcon col="dailyProfit" />
                  </th>

                  <th onClick={() => handleSort("averageDiff")} style={{ cursor: "pointer" }}>
                    Buy vs Avg % <SortIcon col="averageDiff" />
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
                                    <th>Action</th>
                </tr>
              </thead>

              <tbody>
                {displayData.map((row, i) => {
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
                                  onClick={() => copyItemName(row.name)}
                                  style={{
                                    cursor: "pointer",
                                    userSelect: "none",
                                  }}
                                >
                                  {row.name}

                                  {copiedItem === row.name && (
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
                        {row.averagePrice == null ? (
                          <span style={{ opacity: 0.4 }}>...</span>
                        ) : (
                          row.averagePrice.toLocaleString()
                        )}
                      </td>

                      <td>
                        {row.volume==null?<span style={{opacity:0.4}}>...</span>:<span style={{color:getVolumeColor(row.volume),fontWeight:"bold"}}>{row.volume.toFixed(0)}/d</span>}
                      </td>
                      <td>
                        {row.dailyProfit==null?<span style={{opacity:0.4}}>...</span>:<span style={{
color:row.dailyProfit>=100000000?"#16a34a":
row.dailyProfit>=50000000?"#22c55e":
row.dailyProfit>=20000000?"#84cc16":
row.dailyProfit>=10000000?"#eab308":
row.dailyProfit>=5000000?"#f97316":"#ef4444",
fontWeight:"bold"}}>{row.dailyProfit.toLocaleString()}</span>}
                      </td>

                      <td
                        style={{
                          color:
                            row.averageDiff == null
                              ? "#94a3b8"
                              : row.averageDiff <= -25
                              ? "#22c55e"
                              : row.averageDiff <= -15
                              ? "#4ade80"
                              : row.averageDiff <= -5
                              ? "#facc15"
                              : row.averageDiff <= 5
                              ? "#fb923c"
                              : row.averageDiff <= 15
                              ? "#f87171"
                              : "#ef4444",
                          fontWeight: "bold",
                        }}
                      >
                        {row.averageDiff == null ? (
                          <span style={{ opacity: 0.4 }}>...</span>
                        ) : (
                          `${row.averageDiff.toFixed(1)}%`
                        )}
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