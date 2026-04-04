import React, { useState } from 'react';
import './App.css';

const App = () => {
    const [tier, setTier] = useState('');
    const [profit, setProfit] = useState(0);
    const [results, setResults] = useState([]);

    const tiers = ['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4'];

    const calculateProfit = () => {
        // Dummy profit calculation logic
        const calculatedProfit = Math.random() * 100; // Sample logic
to
        setProfit(calculatedProfit);
        setResults([...results, { tier, profit: calculatedProfit }]);
    };

    const handleTierChange = (event) => {
        setTier(event.target.value);
    };

    return (
        <div className="App">
            <h1>Albion Flip Tool</h1>
            <label>
                Select Tier:
                <select value={tier} onChange={handleTierChange}>
                    <option value="">-- Select Tier --</option>
                    {tiers.map((tierOption) => (
                        <option key={tierOption} value={tierOption}>{tierOption}</option>
                    ))}
                </select>
            </label>
            <button onClick={calculateProfit}>Calculate Profit</button>
            <h2>Estimated Profit: ${profit.toFixed(2)}</h2>
            <h3>Results:</h3>
            <table>
                <thead>
                    <tr>
                        <th>Tier</th>
                        <th>Profit</th>
                    </tr>
                </thead>
                <tbody>
                    {results.map((result, index) => (
                        <tr key={index}>
                            <td>{result.tier}</td>
                            <td>${result.profit.toFixed(2)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

export default App;