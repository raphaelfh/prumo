import {Toaster} from "@/components/ui/toaster";
import {Toaster as Sonner} from "@/components/ui/sonner";
import {TooltipProvider} from "@/components/ui/tooltip";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {BrowserRouter, Route, Routes} from "react-router-dom";
import {lazy, Suspense} from "react";
import {AuthProvider} from "./contexts/AuthContext";
import {ProjectProvider} from "./contexts/ProjectContext";
import {SidebarProvider} from "./contexts/SidebarContext";
import {ProtectedRoute} from "./components/ProtectedRoute";
import {ErrorBoundary} from "./components/ErrorBoundary";
import {ProjectLayout} from "./components/layout/AppLayout";
import {Loader2} from "lucide-react";

// Lazy loading de rotas para code splitting
const Auth = lazy(() => import("./pages/Auth"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const ProjectView = lazy(() => import("./pages/ProjectView"));
const AssessmentFullScreen = lazy(() => import("./pages/AssessmentFullScreen"));
const ExtractionFullScreen = lazy(() => import("./pages/ExtractionFullScreen"));
const AddArticle = lazy(() => import("./pages/AddArticle"));
const EditArticle = lazy(() => import("./pages/EditArticle"));
const UserSettings = lazy(() => import("./pages/UserSettings"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const NotFound = lazy(() => import("./pages/NotFound"));

// Componente de loading para Suspense
const PageLoader = () => (
  <div className="flex items-center justify-center min-h-screen">
    <Loader2 className="h-8 w-8 animate-spin text-primary" />
  </div>
);

// QueryClient configurado com opções otimizadas
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutos
      gcTime: 10 * 60 * 1000, // 10 minutos (antigo cacheTime)
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const App = () => {
  return (
    <ErrorBoundary context="Aplicação Principal">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
            <BrowserRouter
              future={{
                v7_startTransition: true,
                v7_relativeSplatPath: true,
              }}
            >
              <ErrorBoundary context="Autenticação">
                <AuthProvider>
                  <Suspense fallback={<PageLoader />}>
                    <Routes>
                  <Route path="/auth" element={<Auth />} />
                        <Route path="/auth/reset-password" element={<ResetPassword/>}/>
                  <Route
                    path="/"
                    element={
                      <ProtectedRoute>
                        <ErrorBoundary context="Dashboard">
                          <Dashboard />
                        </ErrorBoundary>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/projects/:projectId"
                    element={
                      <ProtectedRoute>
                        <ErrorBoundary context="Visualização de Projeto">
                          <ProjectProvider>
                            <SidebarProvider>
                              <ProjectLayout>
                                <ProjectView />
                              </ProjectLayout>
                            </SidebarProvider>
                          </ProjectProvider>
                        </ErrorBoundary>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/projects/:projectId/assessment/:articleId/:instrumentId"
                    element={
                      <ProtectedRoute>
                        <ErrorBoundary context="Avaliação Completa">
                          <AssessmentFullScreen />
                        </ErrorBoundary>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/projects/:projectId/extraction/:articleId"
                    element={
                      <ProtectedRoute>
                        <ErrorBoundary context="Extração de Dados">
                          <ExtractionFullScreen />
                        </ErrorBoundary>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/projects/:projectId/articles/add"
                    element={
                      <ProtectedRoute>
                        <ErrorBoundary context="Adicionar Artigo">
                          <ProjectProvider>
                            <AddArticle />
                          </ProjectProvider>
                        </ErrorBoundary>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/projects/:projectId/articles/:articleId/edit"
                    element={
                      <ProtectedRoute>
                        <ErrorBoundary context="Editar Artigo">
                          <ProjectProvider>
                            <EditArticle />
                          </ProjectProvider>
                        </ErrorBoundary>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/settings"
                    element={
                      <ProtectedRoute>
                        <ErrorBoundary context="Configurações do Usuário">
                          <UserSettings />
                        </ErrorBoundary>
                      </ProtectedRoute>
                    }
                  />
                  {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                  <Route path="*" element={<NotFound />} />
                    </Routes>
                  </Suspense>
              </AuthProvider>
            </ErrorBoundary>
          </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
};

export default App;
