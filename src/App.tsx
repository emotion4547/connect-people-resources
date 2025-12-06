import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";

// Pages
import Index from "./pages/Index";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";

// HR Pages
import HRDashboard from "./pages/hr/HRDashboard";
import CreateRequest from "./pages/hr/CreateRequest";
import HRRequests from "./pages/hr/HRRequests";
import HRSupport from "./pages/hr/HRSupport";

// Worker Pages
import WorkerProfile from "./pages/worker/WorkerProfile";
import WorkerVacancies from "./pages/worker/WorkerVacancies";
import WorkerResponses from "./pages/worker/WorkerResponses";
import WorkerSupport from "./pages/worker/WorkerSupport";

// Admin Pages
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminRequests from "./pages/admin/AdminRequests";
import AdminWorkers from "./pages/admin/AdminWorkers";
import AdminReports from "./pages/admin/AdminReports";
import AdminMessages from "./pages/admin/AdminMessages";
import AdminSettings from "./pages/admin/AdminSettings";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            {/* Public routes */}
            <Route path="/" element={<Index />} />
            <Route path="/login" element={<Login />} />

            {/* HR routes */}
            <Route path="/hr/dashboard" element={
              <ProtectedRoute allowedRoles={['hr']}>
                <HRDashboard />
              </ProtectedRoute>
            } />
            <Route path="/hr/create-request" element={
              <ProtectedRoute allowedRoles={['hr']}>
                <CreateRequest />
              </ProtectedRoute>
            } />
            <Route path="/hr/requests" element={
              <ProtectedRoute allowedRoles={['hr']}>
                <HRRequests />
              </ProtectedRoute>
            } />
            <Route path="/hr/support" element={
              <ProtectedRoute allowedRoles={['hr']}>
                <HRSupport />
              </ProtectedRoute>
            } />

            {/* Worker routes */}
            <Route path="/worker/profile" element={
              <ProtectedRoute allowedRoles={['worker']}>
                <WorkerProfile />
              </ProtectedRoute>
            } />
            <Route path="/worker/vacancies" element={
              <ProtectedRoute allowedRoles={['worker']}>
                <WorkerVacancies />
              </ProtectedRoute>
            } />
            <Route path="/worker/responses" element={
              <ProtectedRoute allowedRoles={['worker']}>
                <WorkerResponses />
              </ProtectedRoute>
            } />
            <Route path="/worker/support" element={
              <ProtectedRoute allowedRoles={['worker']}>
                <WorkerSupport />
              </ProtectedRoute>
            } />

            {/* Admin routes */}
            <Route path="/admin/dashboard" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AdminDashboard />
              </ProtectedRoute>
            } />
            <Route path="/admin/requests" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AdminRequests />
              </ProtectedRoute>
            } />
            <Route path="/admin/workers" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AdminWorkers />
              </ProtectedRoute>
            } />
            <Route path="/admin/reports" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AdminReports />
              </ProtectedRoute>
            } />
            <Route path="/admin/messages" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AdminMessages />
              </ProtectedRoute>
            } />
            <Route path="/admin/settings" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AdminSettings />
              </ProtectedRoute>
            } />

            {/* Catch-all */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
