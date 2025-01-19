import logo from './logo.svg';
import './App.css';

function App() {
  return (
    <div className="App">
      <header className="App-header">
        {/* Rotating React Logo */}
        <img src={logo} className="App-logo" alt="logo" />

        {/* Main Title */}
        <h1 className="main-title">Fatins &amp; Dragons</h1>

        {/* Starring List */}
        <h2>Starring:</h2>
        <ul className="starring-list">
          <li>Nyx</li>
          <li>Bro</li>
          <li>Scasso</li>
          <li>Ruhma</li>
          <li>Aarci</li>
        </ul>

        {/* Development Status */}
        <p className="dev-status">
          Sviluppo webapp F&amp;D in corso...
        </p>
      </header>
    </div>
  );
}

export default App;
