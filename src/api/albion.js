const BASE_URL = "https://europe.albion-online-data.com/api/v2/stats/prices/";

export const fetchPrices = async (items, locations) => {
    const url = `${BASE_URL}${items}?locations=${locations}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error("API error");

    return await res.json();
};