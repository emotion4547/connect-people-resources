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
import PrivacyPolicy from "./pages/PrivacyPolicy";
import Terms from "./pages/Terms";
import Contact from "./pages/Contact";
import Install from "./pages/Install";

// HR Pages
import HRDashboard from "./pages/hr/HRDashboard";
import HRProfile from "./pages/hr/HRProfile";
import CreateRequest from "./pages/hr/CreateRequest";
import HRRequests from "./pages/hr/HRRequests";
import HRSupport from "./pages/hr/HRSupport";
import HRTemplates from "./pages/hr/HRTemplates";

// Worker Pages
import WorkerProfile from "./pages/worker/WorkerProfile";
import WorkerVacancies from "./pages/worker/WorkerVacancies";
import WorkerCalendar from "./pages/worker/WorkerCalendar";
import WorkerResponses from "./pages/worker/WorkerResponses";
import WorkerSupport from "./pages/worker/WorkerSupport";

// Admin Pages
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminProfile from "./pages/admin/AdminProfile";
import AdminRequests from "./pages/admin/AdminRequests";
import AdminWorkers from "./pages/admin/AdminWorkers";
import AdminSites from "./pages/admin/AdminSites";
import AdminUsers from "./pages/admin/AdminUsers";
import AdminReports from "./pages/admin/AdminReports";
import AdminMessages from "./pages/admin/AdminMessages";
import AdminSettings from "./pages/admin/AdminSettings";
import AdminContactMessages from "./pages/admin/AdminContactMessages";

import CookieConsent from "./components/CookieConsent";

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
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/install" element={<Install />} />


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
            <Route path="/hr/templates" element={
              <ProtectedRoute allowedRoles={['hr']}>
                <HRTemplates />
              </ProtectedRoute>
            } />
            <Route path="/hr/profile" element={
              <ProtectedRoute allowedRoles={['hr']}>
                <HRProfile />
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
            <Route path="/worker/calendar" element={
              <ProtectedRoute allowedRoles={['worker']}>
                <WorkerCalendar />
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
            <Route path="/admin/profile" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AdminProfile />
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
            <Route path="/admin/sites" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AdminSites />
              </ProtectedRoute>
            } />
            <Route path="/admin/users" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AdminUsers />
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
            <Route path="/admin/contact-messages" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AdminContactMessages />
              </ProtectedRoute>
            } />

            {/* Catch-all */}
            <Route path="*" element={<NotFound />} />
          </Routes>
            <CookieConsent />
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
  </QueryClientProvider>
);

export default App;
