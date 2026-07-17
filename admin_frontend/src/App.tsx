import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import AdminLayout from './components/AdminLayout';
import Users from './pages/Users';
import VersionControl from './pages/VersionControl';
import Vouchers from './pages/Vouchers';
import Settings from './pages/Settings';
import AnalysisUsers from './pages/AnalysisUsers';
import AnalysisGames from './pages/AnalysisGames';
import AnalysisSocial from './pages/AnalysisSocial';
import PushNotifications from './pages/PushNotifications';
import Moderation from './pages/Moderation';
import EventCommands from './pages/EventCommands';
import AnalysisChat from './pages/AnalysisChat';
import TrafficAnalysis from './pages/TrafficAnalysis';
import TokenAnalysis from './pages/TokenAnalysis';
import AnalysisLedger from './pages/AnalysisLedger';
import ActivitySettings from './pages/ActivitySettings';
import AnalysisInvite from './pages/AnalysisInvite';

import { Navigate } from 'react-router-dom';

const ProtectedRoute: React.FC<{ children: React.ReactNode, requireSuper?: boolean }> = ({ children, requireSuper }) => {
  const token = localStorage.getItem('adminToken');
  const user = JSON.parse(localStorage.getItem('adminUser') || '{}');

  if (!token) return <Navigate to="/login" />;
  if (requireSuper && user.role !== 'super_admin') return <Navigate to="/" />;

  return <>{children}</>;
};

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<ProtectedRoute><AdminLayout /></ProtectedRoute>}>
          <Route index element={<Dashboard />} />
          <Route path="analysis/users" element={<AnalysisUsers />} />
          <Route path="analysis/games" element={<AnalysisGames />} />
          <Route path="analysis/social" element={<AnalysisSocial />} />
          <Route path="analysis/chat" element={<AnalysisChat />} />
          <Route path="analysis/traffic" element={<TrafficAnalysis />} />
          <Route path="analysis/token" element={<TokenAnalysis />} />
          <Route path="analysis/ledger" element={<AnalysisLedger />} />
          <Route path="analysis/invite" element={<AnalysisInvite />} />

          {/* Protected Routes for Super Admin only */}
          <Route path="users" element={<ProtectedRoute requireSuper><Users /></ProtectedRoute>} />
          <Route path="push" element={<ProtectedRoute><PushNotifications /></ProtectedRoute>} />
          <Route path="moderation" element={<ProtectedRoute requireSuper><Moderation /></ProtectedRoute>} />
          <Route path="versions" element={<ProtectedRoute requireSuper><VersionControl /></ProtectedRoute>} />
          <Route path="vouchers" element={<ProtectedRoute requireSuper><Vouchers /></ProtectedRoute>} />
          <Route path="activities" element={<ProtectedRoute requireSuper><ActivitySettings /></ProtectedRoute>} />
          <Route path="event-commands" element={<ProtectedRoute requireSuper><EventCommands /></ProtectedRoute>} />
          <Route path="settings" element={<ProtectedRoute requireSuper><Settings /></ProtectedRoute>} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
