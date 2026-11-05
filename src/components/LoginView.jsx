import { useState } from 'react';
import { authenticateUser } from '../utils/auth.js';

export default function LoginView({ onLogin }) {
  const [loginRole, setLoginRole] = useState('worker');
  const [punchingNumber, setPunchingNumber] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState({ text: '', type: 'error' });

  async function handleSubmit(event) {
    event.preventDefault();
    if (!punchingNumber.trim() || !password) {
      setMessage({ text: 'Enter your punching number and password.', type: 'error' });
      return;
    }

    try {
      const user = await authenticateUser(punchingNumber.trim(), password);
      if (user.role !== loginRole) {
        throw new Error(
          loginRole === 'admin'
            ? 'This account is not an administrator. Choose Worker sign in instead.'
            : 'This account is not a worker. Choose Admin sign in instead.',
        );
      }
      onLogin(user);
      setPassword('');
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : 'Could not verify your account.',
        type: 'error',
      });
    }
  }

  return (
    <section className="login-layout">
      <aside className="login-showcase" aria-label="Attendance tracker overview">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <path d="M16 3.5 26 7v7.6c0 6.4-4.1 11.6-10 14-5.9-2.4-10-7.6-10-14V7l10-3.5Z" />
              <path d="m11.5 15.7 3 3 6-6.2" />
            </svg>
          </span>
          <span>GeoAttend</span>
        </div>
        <div className="showcase-copy">
          <p className="showcase-kicker">SMART ATTENDANCE, SIMPLIFIED</p>
          <h2>Every workday, right on track.</h2>
          <p className="showcase-description">
            A clearer way to check in, stay on site, and keep your team in sync.
          </p>
          <div className="showcase-points">
            <div className="showcase-point">
              <span className="point-icon" aria-hidden="true">01</span>
              <span><strong>Location verified</strong><small>Check in inside your work zone</small></span>
            </div>
            <div className="showcase-point">
              <span className="point-icon" aria-hidden="true">02</span>
              <span><strong>Ready in seconds</strong><small>Simple sign-in for every shift</small></span>
            </div>
          </div>
        </div>
        <div className="showcase-footer">
          <span className="status-dot" aria-hidden="true" />
          Your team, right where it needs to be
        </div>
        <span className="showcase-orbit orbit-one" aria-hidden="true" />
        <span className="showcase-orbit orbit-two" aria-hidden="true" />
      </aside>

      <div className="login-form-panel">
        <div className="login-heading">
          <p className="eyebrow">WELCOME BACK</p>
          <h1>{loginRole === 'admin' ? 'Administrator sign in' : 'Worker sign in'}</h1>
          <p>Sign in with the account details provided by your administrator.</p>
        </div>
        <div className="login-role-switch" role="group" aria-label="Choose account type">
          <button
            type="button"
            className={loginRole === 'worker' ? 'active' : ''}
            aria-pressed={loginRole === 'worker'}
            onClick={() => {
              setLoginRole('worker');
              setMessage({ text: '', type: 'error' });
            }}
          >
            Worker sign in
          </button>
          <button
            type="button"
            className={loginRole === 'admin' ? 'active' : ''}
            aria-pressed={loginRole === 'admin'}
            onClick={() => {
              setLoginRole('admin');
              setMessage({ text: '', type: 'error' });
            }}
          >
            Admin sign in
          </button>
        </div>
        <form className="login-form" onSubmit={handleSubmit}>
          <label htmlFor="login-name">
            Punching number
          </label>
          <input
            id="login-name"
            type="text"
            inputMode="text"
            autoComplete="username"
            placeholder="Enter your punching number"
            value={punchingNumber}
            onChange={(event) => setPunchingNumber(event.target.value)}
          />

          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            type="password"
            placeholder="Enter your password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />

          <p className="login-hint">
            {loginRole === 'admin'
              ? 'Use the administrator punching number and password configured in the Workers sheet.'
              : 'Use the worker punching number and password provided by your administrator.'}
          </p>
          <p className={`admin-msg message-${message.type}`} role="status" aria-live="polite">
            {message.text}
          </p>
          <button type="submit">
            {loginRole === 'admin' ? 'Sign in as administrator' : 'Sign in as worker'}
            <span aria-hidden="true">→</span>
          </button>
        </form>
        <div className="login-privacy">
          <span aria-hidden="true">◇</span>
          <p>
            Attendance is stored in the shared Google Sheet. Use the private account details provided
            by your administrator.
          </p>
        </div>
      </div>
    </section>
  );
}
