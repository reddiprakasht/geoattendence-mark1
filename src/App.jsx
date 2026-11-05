import { useState } from 'react';
import AdminDashboard from './components/AdminDashboard.jsx';
import LoginView from './components/LoginView.jsx';
import WorkerDashboard from './components/WorkerDashboard.jsx';
import { saveCurrentUser } from './utils/storage.js';

export default function App() {
  const [user, setUser] = useState(null);

  function handleLogin(nextUser) {
    saveCurrentUser(nextUser);
    setUser(nextUser);
  }

  function handleLogout() {
    saveCurrentUser(null);
    setUser(null);
  }

  return (
    <main
      className={`card app-shell ${
        user?.role === 'admin' ? 'admin-card' : user?.role === 'worker' ? 'worker-card' : 'login-app'
      }`}
    >
      {user?.role === 'admin' ? (
        <AdminDashboard user={user} onLogout={handleLogout} />
      ) : user?.role === 'worker' ? (
        <WorkerDashboard user={user} onLogout={handleLogout} />
      ) : (
        <LoginView onLogin={handleLogin} />
      )}
    </main>
  );
}
