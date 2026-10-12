import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

const root = ReactDOM.createRoot(document.getElementById('root'));
// Deliberately not wrapped in <React.StrictMode>. StrictMode double-invokes
// effects in development (mount -> unmount -> remount), which makes the Sigma
// SDK's element-data subscription subscribe, immediately unsubscribe, then
// re-subscribe. If the host has already started streaming by then it resumes at
// a non-zero offset, and the SDK's chunk accumulator discards any chunk whose
// offset is past what it has seen while still adopting that chunk's isComplete
// flag -- stranding the plugin at "complete, zero rows" permanently, with a
// blank map and no error. The same double-mount also tore down the Plotly div
// out from under a live plot.
root.render(<App />);

reportWebVitals();
