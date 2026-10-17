import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { OrgProvider } from "@/contexts/OrgContext";

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
const AdminRules = lazy(() => import("./pages/admin/AdminRules"));
const AdminOrganizations = lazy(() => import("./pages/admin/AdminOrganizations"));
const AdminStaff = lazy(() => import("./pages/admin/AdminStaff"));
const AdminPermissions = lazy(() => import("./pages/admin/AdminPermissions"));
const AdminDirectories = lazy(() => import("./pages/admin/AdminDirectories"));
const Workspace = lazy(() => import("./pages/Workspace"));
const CandidatesBoard = lazy(() => import("./pages/hiring/CandidatesBoard"));
const CandidateDetail = lazy(() => import("./pages/hiring/CandidateDetail"));
const HiringToday = lazy(() => import("./pages/hiring/HiringToday"));
const WorkersList = lazy(() => import("./pages/workers/WorkersList"));
const WorkerDetail = lazy(() => import("./pages/workers/WorkerDetail"));
const PlanningGrid = lazy(() => import("./pages/planning/PlanningGrid"));
const OrdersList = lazy(() => import("./pages/orders/OrdersList"));
const OrderDetail = lazy(() => import("./pages/orders/OrderDetail"));
const WorkerShifts = lazy(() => import("./pages/worker/WorkerShifts"));
const WorkerOpenShifts = lazy(() => import("./pages/worker/WorkerOpenShifts"));
const WorkerEarnings = lazy(() => import("./pages/worker/WorkerEarnings"));
const ClientToday = lazy(() => import("./pages/client/ClientToday"));
const ClientShifts = lazy(() => import("./pages/client/ClientShifts"));
const ClientOrder = lazy(() => import("./pages/client/ClientOrder"));
const ClientTimesheets = lazy(() => import("./pages/client/ClientTimesheets"));
const ClientTimesheetDetail = lazy(() => import("./pages/client/ClientTimesheetDetail"));
const Statements = lazy(() => import("./pages/accruals/Statements"));
const TimesheetsList = lazy(() => import("./pages/timesheets/TimesheetsList"));
const TimesheetDetail = lazy(() => import("./pages/timesheets/TimesheetDetail"));
const SitesList = lazy(() => import("./pages/sites/SitesList"));
const SiteDetail = lazy(() => import("./pages/sites/SiteDetail"));
const SiteQrPrint = lazy(() => import("./pages/sites/SiteQrPrint"));
const SiteTablet = lazy(() => import("./pages/sites/SiteTablet"));
const AdminPositions = lazy(() => import("./pages/admin/AdminPositions"));
const ClientsList = lazy(() => import("./pages/clients/ClientsList"));
const ClientDetail = lazy(() => import("./pages/clients/ClientDetail"));
const SetPassword = lazy(() => import("./pages/SetPassword"));
const Security = lazy(() => import("./pages/Security"));
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
        <OrgProvider>
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
            <Route path="/set-password" element={<SetPassword />} />
            <Route path="/security" element={<Security />} />
            <Route path="/clients" element={
              <ProtectedRoute allowedRoles={['admin', 'director', 'sales', 'site_manager', 'recruiter', 'accountant']}>
                <ClientsList />
              </ProtectedRoute>
            } />
            <Route path="/clients/:id" element={
              <ProtectedRoute allowedRoles={['admin', 'director', 'sales', 'site_manager', 'recruiter', 'accountant']}>
                <ClientDetail />
              </ProtectedRoute>
            } />
            <Route path="/candidates" element={
              <ProtectedRoute allowedRoles={['admin', 'director', 'sales', 'site_manager', 'recruiter', 'accountant']}>
                <CandidatesBoard />
              </ProtectedRoute>
            } />
            <Route path="/candidates/:id" element={
              <ProtectedRoute allowedRoles={['admin', 'director', 'sales', 'site_manager', 'recruiter', 'accountant']}>
                <CandidateDetail />
              </ProtectedRoute>
            } />
            <Route path="/hiring/today" element={
              <ProtectedRoute allowedRoles={['admin', 'director', 'sales', 'site_manager', 'recruiter', 'accountant']}>
                <HiringToday />
              </ProtectedRoute>
            } />
            <Route path="/workers" element={
              <ProtectedRoute allowedRoles={['admin', 'director', 'sales', 'site_manager', 'recruiter', 'accountant']}>
                <WorkersList />
              </ProtectedRoute>
            } />
            <Route path="/workers/:id" element={
              <ProtectedRoute allowedRoles={['admin', 'director', 'sales', 'site_manager', 'recruiter', 'accountant']}>
                <WorkerDetail />
              </ProtectedRoute>
            } />
            <Route path="/planning" element={
              <ProtectedRoute allowedRoles={['admin', 'director', 'sales', 'site_manager', 'recruiter', 'accountant']}>
                <PlanningGrid />
              </ProtectedRoute>
            } />
            <Route path="/orders" element={
              <ProtectedRoute allowedRoles={['admin', 'director', 'sales', 'site_manager', 'recruiter', 'accountant']}>
                <OrdersList />
              </ProtectedRoute>
            } />
            <Route path="/orders/:id" element={
              <ProtectedRoute allowedRoles={['admin', 'director', 'sales', 'site_manager', 'recruiter', 'accountant']}>
                <OrderDetail />
              </ProtectedRoute>
            } />
            <Route path="/timesheets" element={
              <ProtectedRoute allowedRoles={['admin', 'director', 'sales', 'site_manager', 'recruiter', 'accountant']}>
                <TimesheetsList />
              </ProtectedRoute>
            } />
            <Route path="/timesheets/:id" element={
              <ProtectedRoute allowedRoles={['admin', 'director', 'sales', 'site_manager', 'recruiter', 'accountant']}>
                <TimesheetDetail />
              </ProtectedRoute>
            } />
            <Route path="/worker/my-shifts" element={
              <ProtectedRoute allowedRoles={['worker']}>
                <WorkerShifts />
              </ProtectedRoute>
            } />
            <Route path="/worker/open-shifts" element={
              <ProtectedRoute allowedRoles={['worker']}>
                <WorkerOpenShifts />
              </ProtectedRoute>
            } />
            <Route path="/worker/earnings" element={
              <ProtectedRoute allowedRoles={['worker']}>
                <WorkerEarnings />
              </ProtectedRoute>
            } />
            <Route path="/client/today" element={
              <ProtectedRoute allowedRoles={['hr', 'client_admin', 'client_manager']}>
                <ClientToday />
              </ProtectedRoute>
            } />
            <Route path="/client/shifts" element={
              <ProtectedRoute allowedRoles={['hr', 'client_admin', 'client_manager']}>
                <ClientShifts />
              </ProtectedRoute>
            } />
            <Route path="/client/order" element={
              <ProtectedRoute allowedRoles={['hr', 'client_admin', 'client_manager']}>
                <ClientOrder />
              </ProtectedRoute>
            } />
            <Route path="/client/timesheets" element={
              <ProtectedRoute allowedRoles={['hr', 'client_admin', 'client_manager']}>
                <ClientTimesheets />
              </ProtectedRoute>
            } />
            <Route path="/client/timesheets/:id" element={
              <ProtectedRoute allowedRoles={['hr', 'client_admin', 'client_manager']}>
                <ClientTimesheetDetail />
              </ProtectedRoute>
            } />
            <Route path="/accruals" element={
              <ProtectedRoute allowedRoles={['admin', 'director', 'sales', 'site_manager', 'accountant']}>
                <Statements />
              </ProtectedRoute>
            } />
            <Route path="/sites" element={
              <ProtectedRoute allowedRoles={['admin', 'director', 'sales', 'site_manager', 'recruiter', 'accountant']}>
                <SitesList />
              </ProtectedRoute>
            } />
            <Route path="/sites/:id" element={
              <ProtectedRoute allowedRoles={['admin', 'director', 'sales', 'site_manager', 'recruiter', 'accountant']}>
                <SiteDetail />
              </ProtectedRoute>
            } />
            <Route path="/sites/:id/qr-print" element={
              <ProtectedRoute allowedRoles={['admin', 'director', 'sales', 'site_manager', 'recruiter', 'accountant']}>
                <SiteQrPrint />
              </ProtectedRoute>
            } />
            <Route path="/sites/:id/tablet" element={
              <ProtectedRoute allowedRoles={['admin', 'director', 'sales', 'site_manager', 'recruiter', 'accountant']}>
                <SiteTablet />
              </ProtectedRoute>
            } />
            <Route path="/admin/positions" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AdminPositions />
              </ProtectedRoute>
            } />
            <Route path="/workspace" element={
              <ProtectedRoute allowedRoles={['director', 'sales', 'site_manager', 'recruiter', 'accountant', 'client_admin', 'client_manager']}>
                <Workspace />
              </ProtectedRoute>
            } />
            <Route path="/admin/organizations" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AdminOrganizations />
              </ProtectedRoute>
            } />
            <Route path="/admin/staff" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AdminStaff />
              </ProtectedRoute>
            } />
            <Route path="/admin/permissions" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AdminPermissions />
              </ProtectedRoute>
            } />
            <Route path="/admin/directories" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AdminDirectories />
              </ProtectedRoute>
            } />
            <Route path="/admin/rules" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AdminRules />
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
        </OrgProvider>
      </AuthProvider>
  </QueryClientProvider>
);

export default App;
