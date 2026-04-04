const CITIES = ["Martlock", "Lymhurst", "Bridgewatch", "Caerleon", "Fort Sterling", "Thetford"];

async function fetchPrices() {
    const response = await fetch('https://path-to-albion-online-data-api/prices');
    const data = await response.json();
    return data;
}

export { CITIES, fetchPrices };