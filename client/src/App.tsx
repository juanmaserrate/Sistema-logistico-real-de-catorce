import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import DriverLogin from './pages/DriverLogin';
import DriverPortal from './pages/DriverPortal';
import AdminDashboard from './pages/AdminDashboard';
import ApiStatusBanner from './components/ApiStatusBanner';

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<AdminDashboard />} />
      <Route path="/admin" element={<AdminDashboard />} />
      <Route path="/login" element={<DriverLogin />} />
      <Route path="/portal" element={<DriverPortal />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  const isAppScope = typeof window !== 'undefined' && window.location.pathname.startsWith('/app');
  return (
    <BrowserRouter basename={isAppScope ? '/app' : '/'}>
      <ApiStatusBanner />
      <AppRoutes />
    </BrowserRouter>
  );
}

export default App;
