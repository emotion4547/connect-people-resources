import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";

import { ProtectedRoute } from "@/components/ProtectedRoute";

// Pages
import Index from "./pages/Index";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const Terms = lazy(() => import("./pages/Terms"));
const Contact = lazy(() => import("./pages/Contact"));
const Install = lazy(() => import("./pages/Install"));

// HR Pages
const HRDashboard = lazy(() => import("./pages/hr/HRDashboard"));
const HRProfile = lazy(() => import("./pages/hr/HRProfile"));
const CreateRequest = lazy(() => import("./pages/hr/CreateRequest"));
const HRRequests = lazy(() => import("./pages/hr/HRRequests"));
const HRSupport = lazy(() => import("./pages/hr/HRSupport"));
const HRTemplates = lazy(() => import("./pages/hr/HRTemplates"));

// Worker Pages
const WorkerDashboard = lazy(() => import("./pages/worker/WorkerDashboard"));
const WorkerProfile = lazy(() => import("./pages/worker/WorkerProfile"));
const WorkerVacancies = lazy(() => import("./pages/worker/WorkerVacancies"));
const WorkerCalendar = lazy(() => import("./pages/worker/WorkerCalendar"));
const WorkerResponses = lazy(() => import("./pages/worker/WorkerResponses"));
const WorkerSupport = lazy(() => import("./pages/worker/WorkerSupport"));

// Admin Pages
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));
const AdminProfile = lazy(() => import("./pages/admin/AdminProfile"));
const AdminRequests = lazy(() => import("./pages/admin/AdminRequests"));
const AdminWorkers = lazy(() => import("./pages/admin/AdminWorkers"));
const AdminSites = lazy(() => import("./pages/admin/AdminSites"));
const AdminUsers = lazy(() => import("./pages/admin/AdminUsers"));
const AdminReports = lazy(() => import("./pages/admin/AdminReports"));
const AdminMessages = lazy(() => import("./pages/admin/AdminMessages"));
const AdminSettings = lazy(() => import("./pages/admin/AdminSettings"));
const AdminContactMessages = lazy(() => import("./pages/admin/AdminContactMessages"));

import CookieConsent from "./components/CookieConsent";
import ErrorBoundary from "./components/ErrorBoundary";

const queryClient = new QueryClient();

const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
        <BrowserRouter>
          <ErrorBoundary>
          <Suspense fallback={<PageLoader />}>
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
            <Route path="/worker/dashboard" element={
              <ProtectedRoute allowedRoles={['worker']}>
                <WorkerDashboard />
              </ProtectedRoute>
            } />
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
          </Suspense>
            <CookieConsent />
          </ErrorBoundary>
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
  </QueryClientProvider>
);

export default App;
