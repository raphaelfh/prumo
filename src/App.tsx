import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { ProjectProvider } from "./contexts/ProjectContext";
import { SidebarProvider } from "./contexts/SidebarContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ProjectLayout } from "./components/layout/AppLayout";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import ProjectView from "./pages/ProjectView";
import AssessmentFullScreen from "./pages/AssessmentFullScreen";
import AddArticle from "./pages/AddArticle";
import EditArticle from "./pages/EditArticle";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => {
  return (
    <ErrorBoundary context="Aplicação Principal">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <ErrorBoundary context="Autenticação">
              <AuthProvider>
                <Routes>
                  <Route path="/auth" element={<Auth />} />
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
                  {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </AuthProvider>
            </ErrorBoundary>
          </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
};

export default App;
